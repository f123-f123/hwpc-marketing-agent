import type { DataService, ImageRecord, MaterialPack, ProductIdentity, SourceRef } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";
import { parseFacts, searchResult, stableId } from "./local.js";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";
const array = (v: unknown): Obj[] => Array.isArray(v) ? v.map(object) : [];
const norm = (s: string) => s.toLocaleLowerCase().replace(/[\s（）()·\-—_]/g, "");

interface Item { mediaId: string; title: string; highlight: string }

export function createImaDataService(config: { clientId?: string; apiKey?: string; kbName: string }, local: DataService): DataService {
  let kb: { id: string; checkedAt: number } | undefined;
  const modelId = (model: string) => `ima-${Buffer.from(model, "utf8").toString("base64url")}`;
  const modelFromId = (id: string) => {
    if (!id.startsWith("ima-")) return "";
    try { return Buffer.from(id.slice(4), "base64url").toString("utf8"); } catch { return ""; }
  };
  const configured = Boolean(config.clientId && config.apiKey);
  const call = async (method: string, body: Obj, signal?: AbortSignal): Promise<Obj> => {
    if (!configured) throw new DataServiceError("not_configured", "未配置 ima Client ID 或 API Key", "ima");
    let response: Response;
    try {
      response = await fetch(`https://ima.qq.com/openapi/wiki/v1/${method}`, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8", "ima-openapi-clientid": config.clientId!, "ima-openapi-apikey": config.apiKey! },
        body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(15000),
      });
    } catch (e) { throw new DataServiceError("upstream_error", e instanceof Error ? e.message : "ima 请求失败", "ima"); }
    if (!response.ok) throw new DataServiceError(response.status === 401 || response.status === 403 ? "unauthorized" : "upstream_error", `ima HTTP ${response.status}`, "ima");
    const raw = object(await response.json());
    if (raw.code !== 0) throw new DataServiceError(/权限|认证|鉴权|登录/.test(str(raw.msg)) ? "unauthorized" : "upstream_error", `ima: ${str(raw.msg) || "业务请求失败"}`, "ima");
    return object(raw.data);
  };
  const locate = async (signal?: AbortSignal) => {
    if (kb && Date.now() - kb.checkedAt < 60_000) return kb.id;
    const data = await call("search_knowledge_base", { query: config.kbName, cursor: "", limit: 20 }, signal);
    const match = array(data.info_list).find(v => str(v.name) === config.kbName && str(v.id));
    if (!match) throw new DataServiceError("kb_not_found", `ima 账号下未找到指定知识库「${config.kbName}」`, "ima");
    kb = { id: str(match.id), checkedAt: Date.now() };
    return kb.id;
  };
  const itemsFrom = (data: Obj): Item[] => array(data.info_list ?? data.knowledge_list).flatMap(v => {
    const mediaId = str(v.media_id), title = str(v.title);
    return mediaId && title ? [{ mediaId, title, highlight: str(v.highlight_content) }] : [];
  });
  const pages = async (method: "search_knowledge" | "get_knowledge_list", body: Obj, signal?: AbortSignal, max = 4) => {
    let cursor = "";
    const found: Item[] = [];
    for (let i = 0; i < max; i++) {
      const data = await call(method, { ...body, cursor }, signal);
      found.push(...itemsFrom(data));
      if (data.is_end === true || !str(data.next_cursor) || str(data.next_cursor) === cursor) break;
      cursor = str(data.next_cursor);
    }
    return found;
  };
  const search = async (query: string, signal?: AbortSignal) => {
    const id = await locate(signal);
    const hits = await pages("search_knowledge", { query, knowledge_base_id: id }, signal);
    if (hits.length) return hits;
    // 搜索索引为空时按游标浏览目录；只把目录名当作目录，不猜测文件内容。
    const queue: { id?: string; matching: boolean }[] = [{ matching: false }];
    const visited = new Set<string>();
    const found: Item[] = [];
    while (queue.length && visited.size < 40) {
      const current = queue.shift()!;
      const folderId = current.id;
      const key = folderId ?? id;
      if (visited.has(key)) continue;
      visited.add(key);
      let entries: Item[];
      try { entries = await pages("get_knowledge_list", { knowledge_base_id: id, ...(folderId ? { folder_id: folderId } : {}), limit: 50 }, signal, 10); }
      catch (e) { if (!folderId) throw e; else continue; }
      for (const entry of entries) {
        const matching = current.matching || norm(entry.title).includes(norm(query));
        if (matching) found.push(entry);
        if (!/\.[a-z0-9]{1,8}$/i.test(entry.title)) queue.push({ id: entry.mediaId, matching });
      }
    }
    return found;
  };
  const media = async (mediaId: string, signal?: AbortSignal) => {
    const info = await call("get_media_info", { media_id: mediaId }, signal);
    const urlInfo = object(info.url_info), url = str(urlInfo.url);
    if (!url) throw new DataServiceError("invalid_data", "ima 原文没有可读取的 URL；需在 ima 客户端核验", "ima");
    const headers = Object.fromEntries(Object.entries(object(urlInfo.headers)).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    let response: Response;
    try { response = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(15000) }); }
    catch { throw new DataServiceError("upstream_error", "ima 原文下载失败", "ima"); }
    if (!response.ok) throw new DataServiceError("upstream_error", `ima 原文 HTTP ${response.status}`, "ima");
    return response;
  };
  const modelFrom = (text: string) => text.match(/^#\s+(.+?)\s+-\s+产品事实/m)?.[1]?.trim();
  const productFor = async (query: string, signal?: AbortSignal) => {
    const localCandidates = (await local.searchProducts(query, signal).catch(() => ({ candidates: [] as ProductIdentity[] }))).candidates;
    const lookup = localCandidates.length === 1 ? localCandidates[0]!.model : query;
    const hits = await search(lookup, signal);
    const sourceHits = hits.filter(h => /产品事实\.md$/.test(h.title) || norm(h.title).includes(norm(lookup)));
    const candidates: ProductIdentity[] = [];
    for (const hit of sourceHits.slice(0, 8)) {
      if (!/\.md$/.test(hit.title)) continue;
      const text = await (await media(hit.mediaId, signal)).text();
      const model = modelFrom(text);
      if (!model || !norm(model).includes(norm(lookup))) continue;
      const productId = modelId(model);
      candidates.push({ productId, category: "pc", family: model, model, aliases: [], configurations: [], origin: "ima" });
    }
    return { candidates, hits };
  };
  return {
    async getStatus(signal) {
      if (!configured) return [{ origin: "ima", state: "not_configured", enabled: false, message: "未设置完整 ima 凭证", knowledgeBase: { name: config.kbName, found: false } }];
      try {
        await locate(signal);
        return [{ origin: "ima", state: "connected", enabled: true, message: "指定共享知识库可见；内容与图片需逐项核验", knowledgeBase: { name: config.kbName, found: true },
          account: { clientIdMasked: `${config.clientId!.slice(0, 4)}***(${config.clientId!.length})` }, lastCheckedAt: new Date().toISOString() }];
      } catch (e) {
        return [{ origin: "ima", state: "error", enabled: true, message: e instanceof Error ? e.message : "ima 检查失败", knowledgeBase: { name: config.kbName, found: false }, lastCheckedAt: new Date().toISOString() }];
      }
    },
    async searchProducts(query, signal) {
      const { candidates } = await productFor(query, signal);
      return searchResult(query, candidates);
    },
    async getMaterialPack(request) {
      const product = request.product;
      const model = modelFromId(product.productId);
      if (!model) throw new DataServiceError("not_found", "ima 资料包需要先检索并选定型号", "ima");
      const hits = await search(model, request.signal);
      let factHit: Item | undefined;
      let markdown = "";
      for (const hit of hits.filter(h => /产品事实\.md$/.test(h.title)).slice(0, 12)) {
        const content = await (await media(hit.mediaId, request.signal)).text();
        if (modelFrom(content) === model) { factHit = hit; markdown = content; break; }
      }
      if (!factHit) throw new DataServiceError("not_found", `ima 中未检索到 ${model} 产品事实原文`, "ima");
      const imaProduct: ProductIdentity = { productId: product.productId, category: "pc", family: model, model, aliases: [], configurations: [], origin: "ima" };
      const source: SourceRef = { origin: "ima", title: `${model} 产品事实`, locator: factHit.mediaId };
      const facts = parseFacts(markdown, imaProduct, source);
      const images: ImageRecord[] = [];
      for (const hit of hits.filter(h => /\.(jpg|jpeg|png|webp)$/i.test(h.title)).slice(0, request.maxImages ?? 8)) {
        if (!norm(hit.title).includes(norm(model))) continue;
        images.push({ imageId: stableId("image", hit.mediaId), productId: imaProduct.productId, configurationIds: [], role: "other", description: hit.title,
          source: { origin: "ima", title: hit.title, locator: hit.mediaId }, access: { kind: "ima_media", mediaId: hit.mediaId } });
      }
      return { packId: stableId("pack", `${request.taskId}:${factHit.mediaId}`), taskId: request.taskId, products: [imaProduct], facts, images,
        conflicts: [], gaps: [...(images.length ? [] : ["ima 未返回可核验的同型号图片"]), "具体销售配置、价格、软件兼容性需单独核验"],
        origins: ["ima"], isMock: false, createdAt: new Date().toISOString() } satisfies MaterialPack;
    },
    async readImage(image, signal) {
      if (image.source.origin !== "ima" || image.access.kind !== "ima_media") throw new DataServiceError("invalid_data", "ima 图片来源不匹配", "ima");
      const response = await media(image.access.mediaId, signal);
      const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (!mimeType.startsWith("image/")) throw new DataServiceError("invalid_data", "ima 媒体原文不是图片", "ima");
      return { mimeType, bytes: new Uint8Array(await response.arrayBuffer()) };
    },
  };
}
