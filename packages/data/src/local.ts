import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DataService, FactCategory, FactRecord, ImageRecord, MaterialPack, ProductIdentity, SourceRef } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";

export const stableId = (prefix: string, value: string) => `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
const normalized = (v: string) => v.toLocaleLowerCase().replace(/[\s（）()·\-—_]/g, "");
export const defaultLocalRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../local-data/华为PC全板块深度知识库_v7");
const categoryFor = (heading: string): FactCategory => {
  if (/系统/.test(heading)) return "os";
  if (/处理器|性能/.test(heading)) return "processor";
  if (/存储|内存/.test(heading)) return "memory_storage";
  if (/屏幕|显示/.test(heading)) return "display";
  if (/电池|续航|充电/.test(heading)) return "battery";
  if (/尺寸|重量|外观/.test(heading)) return "portability";
  if (/接口|连接|无线/.test(heading)) return "ports";
  if (/音频|摄像|麦克风/.test(heading)) return "audio_camera";
  if (/协同|生态/.test(heading)) return "ecosystem";
  return "other";
};

export function parseFacts(markdown: string, product: ProductIdentity, source: SourceRef): FactRecord[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let section = "";
  let field = "";
  let n = 0;
  const facts: FactRecord[] = [];
  const capturedAt = markdown.match(/抓取日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const officialUrl = markdown.match(/https:\/\/consumer\.huawei\.com\/[^\s)]+/)?.[0];
  const actualSource = { ...source, ...(capturedAt ? { capturedAt } : {}), ...(officialUrl ? { officialUrl } : {}) };
  const commonQualifier = /配置可能因销售版本而异/.test(markdown) ? ["具体参数因销售版本而异，以实际销售版本为准"] : [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) { section = line.slice(3); field = ""; continue; }
    if (!section || section === "来源" || !line || line.startsWith("#") || line.startsWith("|")) continue;
    if (line.startsWith("*") || line.startsWith(">")) {
      if (facts.length && line.startsWith("*")) {
        facts[facts.length - 1]!.qualifiers.push(line.slice(1).trim());
        if (/仅.{1,20}版/.test(line)) facts[facts.length - 1]!.reviewStatus = "pending_review";
      }
      continue;
    }
    if (/^[-•]\s/.test(line)) {
      const value = line.replace(/^[-•]\s*/, "");
      facts.push({ factId: stableId("fact", `${source.locator}:${n++}`), productId: product.productId, configurationIds: [], category: categoryFor(section), field: section, value, qualifiers: [...commonQualifier], source: actualSource, reviewStatus: /仅.{1,20}版/.test(value) ? "pending_review" : "verified" });
      continue;
    }
    if (/^(尺寸|类型|宽度|长度|深度|高度|厚度|重量|屏占比|屏幕比例|分辨率|亮度|色域|对比度|可视角度|触摸屏|WLAN|蓝牙|接口|摄像头|麦克风|扬声器|电池容量|额定容量|容量|处理器|内存|存储|颜色|操作系统)$/.test(line)) {
      field = line;
      continue;
    }
    if (/^https?:/.test(line)) continue;
    facts.push({ factId: stableId("fact", `${source.locator}:${n++}`), productId: product.productId, configurationIds: [], category: categoryFor(section), field: field ? `${section}·${field}` : section, value: line, qualifiers: [...commonQualifier], source: actualSource, reviewStatus: /仅.{1,20}版/.test(line) ? "pending_review" : "verified" });
  }
  return facts;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
    else if (c === "," && !quote) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quote) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseImages(csv: string, product: ProductIdentity, sourcePath: string, root: string): ImageRecord[] {
  const rows = csvRows(csv);
  const head = rows.shift() ?? [];
  if (head[0]) head[0] = head[0].replace(/^\uFEFF/, "");
  const col = (row: string[], name: string) => row[head.indexOf(name)]?.trim() ?? "";
  return rows.flatMap(row => {
    const file = col(row, "文件名");
    const model = col(row, "产品型号");
    if (!file || normalized(model) !== normalized(product.model)) return [];
    const localPath = path.join(path.dirname(sourcePath), "images", file);
    const src: SourceRef = { origin: "local", title: `${product.model} 图片索引`, locator: path.relative(root, sourcePath).replaceAll("\\", "/") };
    const url = col(row, "原始图片URL") || col(row, "来源页面");
    if (url.startsWith("https://")) src.officialUrl = url;
    return [{
      imageId: stableId("image", `${src.locator}:${file}`), productId: product.productId, configurationIds: [],
      role: /主视觉/.test(file) ? "hero" as const : /接口/.test(file) ? "ports" as const : /场景/.test(file) ? "scene" as const : "detail" as const,
      description: col(row, "官网图片说明") || file, usageNote: col(row, "建议用途") || undefined,
      source: src, access: { kind: "local_file" as const, path: localPath },
      mimeType: /\.png$/i.test(file) ? "image/png" : "image/jpeg",
      width: Number(col(row, "宽度")) || undefined, height: Number(col(row, "高度")) || undefined,
    }];
  });
}

export function searchResult(query: string, products: ProductIdentity[]) {
  const q = normalized(query);
  const candidates = products.filter(p => normalized(p.model).includes(q) || p.aliases.some(a => normalized(a).includes(q)));
  return { query, candidates, ambiguous: candidates.length > 1 || (candidates.length === 1 && candidates[0]!.configurations.length > 1),
    ...(candidates.length > 1 ? { disambiguation: { question: "请选择准确型号", options: candidates.map(p => ({ productId: p.productId, label: p.model })) } } : {}) };
}

export function createLocalDataService(rootDir?: string): DataService {
  const root = rootDir ? path.resolve(rootDir) : "";
  let cache: { products: ProductIdentity[]; files: Map<string, string> } | undefined;
  const catalog = async () => {
    if (cache) return cache;
    if (!root) throw new DataServiceError("not_configured", "未设置 LOCAL_KB_DIR", "local");
    const p1 = path.join(root, "P1-产品参数库");
    const files = new Map<string, string>();
    const products: ProductIdentity[] = [];
    for (const group of ["01-鸿蒙电脑", "02-MateBook-Windows"]) {
      let entries;
      try { entries = await readdir(path.join(p1, group), { withFileTypes: true }); }
      catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const factPath = path.join(p1, group, entry.name, "产品事实.md");
        let content;
        try { content = await readFile(factPath, "utf8"); } catch { continue; }
        const model = content.match(/^#\s+(.+?)\s+-\s+产品事实/m)?.[1]?.trim() ?? entry.name;
        const productId = stableId("local", `${group}:${model}`);
        products.push({ productId, category: "pc", family: entry.name, model, aliases: [entry.name], configurations: [], origin: "local" });
        files.set(productId, factPath);
      }
    }
    if (!products.length) throw new DataServiceError("invalid_data", "LOCAL_KB_DIR 中没有可读取的产品事实", "local");
    cache = { products, files };
    return cache;
  };
  return {
    async getStatus() {
      if (!root) return [{ origin: "local", state: "not_configured", enabled: false, message: "未设置 LOCAL_KB_DIR", local: { rootConfigured: false } }];
      try { const c = await catalog(); return [{ origin: "local", state: "connected", enabled: true, message: "本地产品资料可读", local: { rootConfigured: true, productCount: c.products.length }, lastCheckedAt: new Date().toISOString() }]; }
      catch (e) { return [{ origin: "local", state: "error", enabled: true, message: e instanceof Error ? e.message : "本地资料不可读", local: { rootConfigured: true }, lastCheckedAt: new Date().toISOString() }]; }
    },
    async searchProducts(query) { return searchResult(query, (await catalog()).products); },
    async getMaterialPack(request) {
      const c = await catalog();
      const product = c.products.find(p => p.productId === request.product.productId);
      const file = c.files.get(request.product.productId);
      if (!product || !file) throw new DataServiceError("not_found", "未找到该本地型号", "local");
      const src: SourceRef = { origin: "local", title: `${product.model} 产品事实`, locator: path.relative(root, file).replaceAll("\\", "/") };
      const facts = parseFacts(await readFile(file, "utf8"), product, src);
      const index = path.join(path.dirname(file), "图片索引.csv");
      let images: ImageRecord[] = [];
      try { images = parseImages(await readFile(index, "utf8"), product, index, root); } catch { /* image index absent */ }
      const available: ImageRecord[] = [];
      for (const image of images) {
        if (image.access.kind === "local_file") { try { if ((await stat(image.access.path)).isFile()) available.push(image); } catch { /* missing file */ } }
      }
      return { packId: stableId("pack", `${request.taskId}:${product.productId}`), taskId: request.taskId,
        products: [product], facts, images: available.slice(0, request.maxImages ?? 12), conflicts: [],
        gaps: [...(facts.length ? [] : ["产品事实为空"]), ...(available.length ? [] : ["未找到可用的型号图片"]), "具体销售配置、当前价格及软件兼容性需另行核验"],
        origins: ["local"], isMock: false, createdAt: new Date().toISOString() } satisfies MaterialPack;
    },
    async readImage(image) {
      if (image.source.origin !== "local" || image.access.kind !== "local_file") throw new DataServiceError("invalid_data", "图片来源与访问方式不匹配", "local");
      const target = path.resolve(image.access.path);
      if (!root || !target.startsWith(root + path.sep)) throw new DataServiceError("invalid_data", "图片路径不在知识库目录内", "local");
      return { mimeType: image.mimeType ?? "application/octet-stream", bytes: await readFile(target) };
    },
  };
}
