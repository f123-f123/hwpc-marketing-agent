/**
 * ima 共享知识库资料源。字段以 ima-skills 1.1.10 官方接口文档为准，并兼容赛题手册的实测返回：
 * - search_knowledge_base：文档为 id / name，实测为 kb_id / kb_name，两者都接受；
 * - get_knowledge_list / search_knowledge：文件为 media_id / title，文件夹为 folder_id / name；根目录 folder_id 等于知识库 ID；
 * - 型号资料在 P1-产品参数库 的型号目录下。事实原文按标题“# 型号 - 产品事实”识别（实测文件名为 article.md），
 *   图片取型号目录 images 子目录中、登记在 图片索引.csv 里的文件（图片文件名不含型号，不能按文件名判断归属）。
 *
 * 共享知识库每个账号的调用次数有限：知识库定位、目录与下载内容都在进程内缓存；每个进程有调用上限，
 * 用完后停止请求 ima（auto 模式随之回到本地资料），状态中显示已用次数。
 */
import type { DataService, ImageRecord, MaterialPack, ProductIdentity, SourceRef } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";
import { imageIndexRows, imageRole, parseFacts, searchResult, stableId } from "./local.js";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";
const array = (v: unknown): Obj[] => Array.isArray(v) ? v.map(object) : [];
const norm = (s: string) => s.toLocaleLowerCase().replace(/[\s（）()·\-—_]/g, "");
const hasExt = (title: string) => /\.[a-z0-9]{1,8}$/i.test(title);

interface FileItem { mediaId: string; title: string; parentId?: string }
interface FolderItem { folderId: string; name: string }
interface Listing { files: FileItem[]; folders: FolderItem[]; path: string[] }
interface FactDoc { mediaId: string; title: string; model: string; markdown: string }

const FACT_HEADING = /^#\s+(.+?)\s+-\s+产品事实/m;
/** 型号事实只从 P1 取；待审核、历史归档不作为现行事实。 */
const SKIP_FOLDER = /^(90|99)-/;
/** 共享库内容在比赛期间少有变化，目录与下载内容缓存 30 分钟。 */
const CACHE_TTL = 30 * 60_000;
const MEDIA_CACHE_MAX = 300;
export const DEFAULT_IMA_CALL_BUDGET = 300;

export interface ImaConfig {
  clientId?: string;
  apiKey?: string;
  kbName: string;
  /** 本进程最多调用 ima OpenAPI 的次数（不含下载原文链接）。 */
  callBudget?: number;
}

export function createImaDataService(config: ImaConfig, local: DataService): DataService {
  let kb: { id: string; checkedAt: number } | undefined;
  let calls = 0;
  const budget = config.callBudget ?? DEFAULT_IMA_CALL_BUDGET;
  const listings = new Map<string, { at: number; value: Listing }>();
  const downloads = new Map<string, { at: number; mimeType: string; bytes: Uint8Array }>();
  let catalogCache: { at: number; value: ProductIdentity[] } | undefined;
  const encodeId = (model: string, folderId: string, path: string[]) => `ima-${Buffer.from(JSON.stringify({ m: model, f: folderId, p: path }), "utf8").toString("base64url")}`;
  const decodeId = (id: string): { model: string; folderId: string; path: string[] } | undefined => {
    if (!id.startsWith("ima-")) return undefined;
    try {
      const v = object(JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8")));
      return str(v.m) && str(v.f) ? { model: str(v.m), folderId: str(v.f), path: Array.isArray(v.p) ? v.p.filter((x): x is string => typeof x === "string") : [] } : undefined;
    } catch { return undefined; }
  };
  const configured = Boolean(config.clientId && config.apiKey);

  const call = async (method: string, body: Obj, signal?: AbortSignal): Promise<Obj> => {
    if (!configured) throw new DataServiceError("not_configured", "未配置 ima Client ID 或 API Key", "ima");
    if (calls >= budget) throw new DataServiceError("upstream_error", `本次运行的 ima 调用已达上限（${budget} 次，可用 IMA_CALL_BUDGET 调整）`, "ima");
    calls++;
    let response: Response;
    try {
      response = await fetch(`https://ima.qq.com/openapi/wiki/v1/${method}`, {
        method: "POST", headers: { "content-type": "application/json; charset=utf-8", "ima-openapi-clientid": config.clientId!, "ima-openapi-apikey": config.apiKey! },
        body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(15000),
      });
    } catch (e) { throw new DataServiceError("upstream_error", e instanceof Error ? e.message : "ima 请求失败", "ima"); }
    if (!response.ok) throw new DataServiceError(response.status === 401 || response.status === 403 ? "unauthorized" : "upstream_error", `ima HTTP ${response.status}`, "ima");
    const raw = object(await response.json());
    if (raw.code !== 0) throw new DataServiceError(raw.code === 110030 || /权限|认证|鉴权|登录/.test(str(raw.msg)) ? "unauthorized" : "upstream_error", `ima: ${str(raw.msg) || "业务请求失败"}`, "ima");
    return object(raw.data);
  };

  /** A. 按名称找到指定共享知识库。知识库 ID 只在程序内部使用。 */
  const locate = async (signal?: AbortSignal) => {
    if (kb && Date.now() - kb.checkedAt < CACHE_TTL) return kb.id;
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const data = await call("search_knowledge_base", { query: config.kbName, cursor, limit: 20 }, signal);
      const match = array(data.info_list).find(v => (str(v.kb_name) || str(v.name)) === config.kbName && (str(v.kb_id) || str(v.id)));
      if (match) {
        kb = { id: str(match.kb_id) || str(match.id), checkedAt: Date.now() };
        return kb.id;
      }
      if (data.is_end !== false || !str(data.next_cursor) || str(data.next_cursor) === cursor) break;
      cursor = str(data.next_cursor);
    }
    throw new DataServiceError("kb_not_found", `ima 账号下未找到指定知识库「${config.kbName}」`, "ima");
  };

  /** 一条返回记录是文件还是文件夹。实测文件夹以 media_id + title + media_type 99 返回（文档写 folder_id / name），两种都接受。 */
  const classify = (v: Obj): { file?: FileItem; folder?: FolderItem } => {
    const folderId = str(v.folder_id), mediaId = str(v.media_id), title = str(v.title) || str(v.name);
    if (folderId && !mediaId) return { folder: { folderId, name: title } };
    if (!mediaId || !title) return {};
    if (v.media_type === 99 || !hasExt(title)) return { folder: { folderId: mediaId, name: title } };
    return { file: { mediaId, title, parentId: str(v.parent_folder_id) || undefined } };
  };

  /** C. 浏览一个目录（省略 folderId 即根目录），按游标翻页。 */
  const list = async (kbId: string, folderId?: string, signal?: AbortSignal): Promise<Listing> => {
    const key = folderId ?? kbId;
    const hit = listings.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
    const value: Listing = { files: [], folders: [], path: [] };
    let cursor = "";
    for (let page = 0; page < 10; page++) {
      const data = await call("get_knowledge_list", { knowledge_base_id: kbId, ...(folderId && folderId !== kbId ? { folder_id: folderId } : {}), cursor, limit: 50 }, signal);
      for (const v of array(data.knowledge_list)) {
        const c = classify(v);
        if (c.file) value.files.push(c.file);
        if (c.folder) value.folders.push(c.folder);
      }
      if (!value.path.length) value.path = array(data.current_path).filter(f => str(f.folder_id) !== kbId).map(f => str(f.name)).filter(Boolean);
      if (data.is_end !== false || !str(data.next_cursor) || str(data.next_cursor) === cursor) break;
      cursor = str(data.next_cursor);
    }
    listings.set(key, { at: Date.now(), value });
    return value;
  };

  /** D. 读取原文或图片的访问链接并下载；内容按 media_id 缓存（链接可能带时效，缓存内容而不是链接）。 */
  const download = async (mediaId: string, signal?: AbortSignal) => {
    const hit = downloads.get(mediaId);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit;
    const response = await media(mediaId, signal);
    const value = { at: Date.now(), mimeType: response.headers.get("content-type")?.split(";")[0] ?? "", bytes: new Uint8Array(await response.arrayBuffer()) };
    if (downloads.size >= MEDIA_CACHE_MAX) downloads.delete(downloads.keys().next().value!);
    downloads.set(mediaId, value);
    return value;
  };
  const text = async (mediaId: string, signal?: AbortSignal) => new TextDecoder("utf-8").decode((await download(mediaId, signal)).bytes);

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

  /** 在型号目录里找事实原文：按标题识别，文件名可以是 article.md 或 产品事实.md。 */
  const factDoc = async (files: FileItem[], signal?: AbortSignal): Promise<FactDoc | undefined> => {
    const rank = (t: string) => (/产品事实/.test(t) ? 0 : /^article\.md$/i.test(t) ? 1 : 2);
    const docs = files.filter(f => /\.md$/i.test(f.title) && !/卖点|限制|来源/.test(f.title)).sort((a, b) => rank(a.title) - rank(b.title)).slice(0, 4);
    for (const doc of docs) {
      const markdown = await text(doc.mediaId, signal);
      const model = markdown.match(FACT_HEADING)?.[1]?.trim();
      if (model) return { mediaId: doc.mediaId, title: doc.title, model, markdown };
    }
    return undefined;
  };

  /** 名称与检索词互相包含即视为候选目录；包含得越多越靠前。 */
  const nameScore = (name: string, query: string) => {
    const n = norm(name), q = norm(query);
    if (!n || !q || /^\d+$/.test(n)) return 0;
    return q.includes(n) || n.includes(q) ? Math.min(n.length, q.length) : 0;
  };

  /** 按目录查找型号目录：根目录 → P1-产品参数库 → 分组 → 型号目录。没有 P1 时从根目录找。 */
  /** 找到 P1-产品参数库。实测根目录下先有一层与知识库同名的包装文件夹，最多向下找三层。 */
  const findP1 = async (kbId: string, signal?: AbortSignal): Promise<{ folder: FolderItem; path: string[] } | undefined> => {
    let level: { folder?: FolderItem; path: string[] }[] = [{ path: [] }];
    for (let depth = 0; depth < 3 && level.length; depth++) {
      const next: { folder: FolderItem; path: string[] }[] = [];
      for (const node of level.slice(0, 4)) {
        const listing = await list(kbId, node.folder?.folderId, signal);
        const p1 = listing.folders.find(f => /^P1|产品参数库/.test(f.name));
        if (p1) return { folder: p1, path: [...node.path, p1.name] };
        // 已经到了 P2…P8 这一层却没有 P1，不再往板块里面找
        if (listing.folders.some(f => /^P\d/.test(f.name))) continue;
        next.push(...listing.folders.filter(f => !SKIP_FOLDER.test(f.name)).map(f => ({ folder: f, path: [...node.path, f.name] })));
      }
      level = next;
    }
    return undefined;
  };

  const browseFolders = async (kbId: string, query: string, signal?: AbortSignal) => {
    const p1 = await findP1(kbId, signal);
    const start = p1 ? [p1] : (await list(kbId, undefined, signal)).folders.map(f => ({ folder: f, path: [f.name] }));
    const queue: { folder: FolderItem; path: string[]; depth: number }[] = start
      .filter(s => !SKIP_FOLDER.test(s.folder.name)).map(s => ({ ...s, depth: 0 }));
    const found: { folderId: string; path: string[]; score: number }[] = [];
    let visited = 0;
    while (queue.length && visited < 40) {
      const { folder, path, depth } = queue.shift()!;
      const score = nameScore(folder.name, query);
      if (score) { found.push({ folderId: folder.folderId, path, score }); continue; }
      if (depth >= 2) continue;
      visited++;
      const sub = await list(kbId, folder.folderId, signal);
      for (const f of sub.folders) if (!SKIP_FOLDER.test(f.name)) queue.push({ folder: f, path: [...path, f.name], depth: depth + 1 });
    }
    return found.sort((a, b) => b.score - a.score);
  };

  interface Located { model: string; folderId: string; path: string[]; doc: FactDoc }

  /** 读取一个目录里的事实原文，并核对标题中的型号。 */
  const open = async (kbId: string, folderId: string, knownPath: string[] | undefined, accept: (model: string) => boolean, signal?: AbortSignal): Promise<Located | undefined> => {
    const listing = await list(kbId, folderId, signal);
    const doc = await factDoc(listing.files, signal);
    if (!doc || !accept(doc.model)) return undefined;
    return { model: doc.model, folderId, path: knownPath ?? listing.path, doc };
  };

  /** B → C：先用 search_knowledge 按型号检索；没有可核验的命中时按目录浏览。 */
  const findProducts = async (query: string, exact: boolean, signal?: AbortSignal): Promise<Located[]> => {
    const kbId = await locate(signal);
    const accept = (model: string) => (exact ? norm(model) === norm(query) : norm(model).includes(norm(query)));
    const out: Located[] = [];
    const seen = new Set<string>();
    const add = (l: Located | undefined) => { if (l && !seen.has(l.model)) { seen.add(l.model); out.push(l); } };

    let cursor = "";
    const hits: FileItem[] = [];
    for (let page = 0; page < 3; page++) {
      const data = await call("search_knowledge", { query, knowledge_base_id: kbId, cursor }, signal);
      for (const v of array(data.info_list)) { const c = classify(v); if (c.file) hits.push(c.file); }
      if (data.is_end !== false || !str(data.next_cursor) || str(data.next_cursor) === cursor) break;
      cursor = str(data.next_cursor);
    }
    const parents = [...new Set(hits.filter(h => /\.md$/i.test(h.title) && h.parentId).map(h => h.parentId!))].slice(0, 6);
    for (const parent of parents) add(await open(kbId, parent, undefined, accept, signal).catch(() => undefined));
    if (out.length) return out;

    for (const f of (await browseFolders(kbId, query, signal)).slice(0, 6)) add(await open(kbId, f.folderId, f.path, accept, signal).catch(() => undefined));
    return out;
  };

  /** 列出 P1 各分组下的型号目录（与本地一致，只取鸿蒙电脑与 MateBook Windows 两组），不逐个下载原文。
   *  型号名先借用本地同名目录的正式型号；生成资料包时再以原文标题为准。 */
  const catalog = async (signal?: AbortSignal): Promise<ProductIdentity[]> => {
    if (catalogCache && Date.now() - catalogCache.at < CACHE_TTL) return catalogCache.value;
    const kbId = await locate(signal);
    const p1 = await findP1(kbId, signal);
    if (!p1) return [];
    const groups = (await list(kbId, p1.folder.folderId, signal)).folders;
    const chosen = groups.filter(g => /鸿蒙电脑|MateBook-Windows/i.test(g.name));
    const localModels = (await local.searchProducts("", signal).catch(() => ({ candidates: [] as ProductIdentity[] }))).candidates;
    const out: ProductIdentity[] = [];
    for (const g of chosen.length ? chosen : groups.filter(x => !/^0?0-|索引|检索卡|价格/.test(x.name))) {
      for (const f of (await list(kbId, g.folderId, signal)).folders) {
        const known = localModels.find(m => norm(m.family) === norm(f.name) || m.aliases.some(a => norm(a) === norm(f.name)));
        out.push(identity({ model: known?.model ?? f.name, folderId: f.folderId, path: [...p1.path, g.name, f.name] }));
      }
    }
    catalogCache = { at: Date.now(), value: out };
    return out;
  };

  const identity = (l: { model: string; folderId: string; path: string[] }): ProductIdentity =>
    ({ productId: encodeId(l.model, l.folderId, l.path), category: "pc", family: l.model, model: l.model, aliases: [], configurations: [], origin: "ima" });

  return {
    async getStatus(signal) {
      if (!configured) return [{ origin: "ima", state: "not_configured", enabled: false, message: "未设置完整 ima 凭证", knowledgeBase: { name: config.kbName, found: false } }];
      try {
        await locate(signal);
        return [{ origin: "ima", state: "connected", enabled: true, message: `指定共享知识库可见；本次运行已调用 ima ${calls}/${budget} 次`, knowledgeBase: { name: config.kbName, found: true },
          account: { clientIdMasked: `${config.clientId!.slice(0, 4)}***(${config.clientId!.length})` }, lastCheckedAt: new Date().toISOString() }];
      } catch (e) {
        return [{ origin: "ima", state: "error", enabled: true, message: `${e instanceof Error ? e.message : "ima 检查失败"}（本次运行已调用 ${calls}/${budget} 次）`, knowledgeBase: { name: config.kbName, found: false }, lastCheckedAt: new Date().toISOString() }];
      }
    },
    async searchProducts(query, signal) {
      if (!query.trim()) return searchResult(query, await catalog(signal));
      // 本地目录能唯一确定型号时用准确型号名检索，并要求 ima 原文标题与之完全一致
      const localCandidates = (await local.searchProducts(query, signal).catch(() => ({ candidates: [] as ProductIdentity[] }))).candidates;
      const exact = localCandidates.length === 1;
      const lookup = exact ? localCandidates[0]!.model : query;
      return searchResult(query, (await findProducts(lookup, exact, signal)).map(identity));
    },
    async getMaterialPack(request) {
      const ref = decodeId(request.product.productId);
      if (!ref) throw new DataServiceError("not_found", "ima 资料包需要先检索并选定型号", "ima");
      const kbId = await locate(request.signal);
      // 目录列出的型号名可能只是目录名，原文标题包含它即可；资料以原文标题中的正式型号为准，productId 保持任务中的值
      const located = await open(kbId, ref.folderId, ref.path.length ? ref.path : undefined, m => m === ref.model || norm(m).includes(norm(ref.model)), request.signal);
      if (!located) throw new DataServiceError("not_found", `ima 中未检索到 ${ref.model} 产品事实原文`, "ima");
      const product = { ...identity(located), productId: request.product.productId };
      const dir = located.path.join("/");
      const at = (title: string) => (dir ? `${dir}/${title}` : title);
      const facts = parseFacts(located.doc.markdown, product, { origin: "ima", title: `${located.model} 产品事实`, locator: at(located.doc.title) });

      const listing = await list(kbId, located.folderId, request.signal);
      const images: ImageRecord[] = [];
      const indexFile = listing.files.find(f => /^图片索引\.csv$/.test(f.title));
      const imageFolder = listing.folders.find(f => /^images$/i.test(f.name));
      if (indexFile && imageFolder) {
        const rows = imageIndexRows(await text(indexFile.mediaId, request.signal), located.model);
        const uploaded = new Map((await list(kbId, imageFolder.folderId, request.signal)).files.map(f => [f.title, f.mediaId]));
        for (const row of rows) {
          const mediaId = uploaded.get(row.file);
          if (!mediaId) continue;
          const source: SourceRef = { origin: "ima", title: `${located.model} 图片索引`, locator: at(indexFile.title), ...(row.officialUrl ? { officialUrl: row.officialUrl } : {}) };
          images.push({ imageId: stableId("image", mediaId), productId: product.productId, configurationIds: [], role: imageRole(row.file),
            description: row.description, usageNote: row.usageNote, source, access: { kind: "ima_media", mediaId },
            mimeType: /\.png$/i.test(row.file) ? "image/png" : "image/jpeg", width: row.width, height: row.height });
        }
      }
      const available = images.slice(0, request.maxImages ?? 12);
      return { packId: stableId("pack", `${request.taskId}:${located.doc.mediaId}`), taskId: request.taskId, products: [product], facts, images: available,
        conflicts: [], gaps: [...(facts.length ? [] : ["产品事实为空"]), ...(available.length ? [] : ["ima 未返回登记在图片索引中的同型号图片"]), "具体销售配置、当前价格及软件兼容性需另行核验"],
        origins: ["ima"], isMock: false, createdAt: new Date().toISOString() } satisfies MaterialPack;
    },
    async readImage(image, signal) {
      if (image.source.origin !== "ima" || image.access.kind !== "ima_media") throw new DataServiceError("invalid_data", "ima 图片来源不匹配", "ima");
      const got = await download(image.access.mediaId, signal);
      const mimeType = got.mimeType.startsWith("image/") ? got.mimeType : image.mimeType ?? got.mimeType;
      if (!mimeType.startsWith("image/")) throw new DataServiceError("invalid_data", "ima 媒体原文不是图片", "ima");
      return { mimeType, bytes: got.bytes };
    },
  };
}
