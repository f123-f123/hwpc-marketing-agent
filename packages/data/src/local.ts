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

/**
 * 官网规格表被抓成“字段名一行、值一行”的纯文本。只有在这张表里的行才当字段名，
 * 其余短行（“华为分享”“锂聚合物”）都是取值；漏掉字段名会让后面的值串到上一个字段。
 */
const FIELD_LABELS = new Set(["尺寸", "类型", "宽度", "长度", "深度", "高度", "厚度", "重量", "屏占比", "屏幕比例", "分辨率", "刷新率", "亮度", "峰值亮度", "色域", "色准", "色深", "对比度", "可视角度", "触摸屏",
  "WLAN", "蓝牙", "星闪", "NFC", "接口", "摄像头", "麦克风", "扬声器", "材料", "电池容量", "额定容量", "容量", "处理器", "CPU", "GPU", "NPU", "集成显卡", "独立显卡", "内存", "存储", "颜色", "操作系统", "电源键"]);
/** 页尾外链弹窗（“即将离开…/继续访问/取消”）：出现后到本段结束都是网页残留。 */
const PAGE_RESIDUE = /即将离开\s*consumer\.huawei\.com|跳转至第三方页面/;
/** 版本小标题。“标准版：”只管到本字段结束；“HUAWEI … 版”“Windows 版”管到下一个同类小标题或本段结束。 */
const FIELD_VARIANT = /^(.{1,40}?版)\s*[：:]$/;
const BLOCK_VARIANT = /^(HUAWEI\s.+版|(?:Windows|Linux)(?:\s*V\d+)?\s*版)$/;
const ONLY_VARIANT = /仅.{1,20}版/;
const PLANE = new Set(["长度", "宽度", "深度"]);
const THICK = new Set(["厚度", "高度"]);

/** 笔记本长、宽、深不会小于 100 mm，厚、高不会超过 40 mm；违背说明原文标签与数值错位，整组不能当已核实事实。 */
function flagMisalignedDimensions(facts: FactRecord[]) {
  const groups = new Map<string, FactRecord[]>();
  for (const f of facts) {
    const [section, label] = f.field.split("·");
    if (label && (PLANE.has(label) || THICK.has(label))) groups.set(section!, [...(groups.get(section!) ?? []), f]);
  }
  for (const group of groups.values()) {
    const wrong = group.some(f => {
      const label = f.field.split("·")[1]!;
      return [...f.value.matchAll(/(\d+(?:\.\d+)?)\s*mm/g)].some(m => THICK.has(label) ? Number(m[1]) > 40 : Number(m[1]) < 100);
    });
    if (!wrong) continue;
    for (const f of group) { f.reviewStatus = "pending_review"; f.qualifiers.push("原文尺寸标签与数值疑似错位，需人工核对后使用"); }
  }
}

export function parseFacts(markdown: string, product: ProductIdentity, source: SourceRef): FactRecord[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let section = "";
  let field = "";
  let blockVariant = "";
  /** 版本小标题下紧跟的是字段名（整张子表属于该版本）还是直接取值（只管这几行，遇到字段名即结束）。 */
  let blockHolds = "" as "" | "labels" | "values"; // push() 里会改成 "values"，不让 TS 按初值收窄
  let fieldVariant = "";
  let residue = false;
  /** 当前字段 / 版本下第一条事实的下标：脚注作用于这一组取值。 */
  let group = 0;
  let n = 0;
  const facts: FactRecord[] = [];
  const capturedAt = markdown.match(/抓取日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const officialUrl = markdown.match(/https:\/\/consumer\.huawei\.com\/[^\s)]+/)?.[0];
  const actualSource = { ...source, ...(capturedAt ? { capturedAt } : {}), ...(officialUrl ? { officialUrl } : {}) };
  const commonQualifier = /配置可能因销售版本而异/.test(markdown) ? ["具体参数因销售版本而异，以实际销售版本为准"] : [];
  const push = (fieldName: string, value: string) => {
    if (blockVariant && !blockHolds) blockHolds = "values";
    const scope = [blockVariant, fieldVariant].filter(Boolean).map(v => `仅 ${v}`);
    facts.push({ factId: stableId("fact", `${source.locator}:${n++}`), productId: product.productId, configurationIds: [], category: categoryFor(section), field: fieldName, value, qualifiers: [...commonQualifier, ...scope], source: actualSource, reviewStatus: ONLY_VARIANT.test(value) ? "pending_review" : "verified" });
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) { section = line.slice(3); field = blockVariant = fieldVariant = blockHolds = ""; residue = false; group = facts.length; continue; }
    if (residue || PAGE_RESIDUE.test(line)) { residue = true; continue; }
    if (!section || section === "来源" || !line || line.startsWith("#") || line.startsWith("|")) continue;
    if (line.startsWith("*") || line.startsWith(">")) {
      if (facts.length && line.startsWith("*")) {
        const targets = facts.length > group ? facts.slice(group) : facts.slice(-1);
        for (const f of targets) {
          f.qualifiers.push(line.slice(1).trim());
          if (ONLY_VARIANT.test(line)) f.reviewStatus = "pending_review";
        }
      }
      continue;
    }
    if (/^[-•]\s/.test(line)) { push(section, line.replace(/^[-•]\s*/, "")); continue; }
    if (FIELD_LABELS.has(line)) {
      if (blockVariant && !blockHolds) blockHolds = "labels";
      else if (blockHolds === "values") blockVariant = blockHolds = "";
      field = line; fieldVariant = ""; group = facts.length; continue;
    }
    if (!/系统/.test(section)) {
      const fv = FIELD_VARIANT.exec(line)?.[1];
      if (fv) { fieldVariant = fv.trim(); group = facts.length; continue; }
      if (BLOCK_VARIANT.test(line)) { blockVariant = line; blockHolds = fieldVariant = ""; group = facts.length; continue; }
    }
    if (/^https?:/.test(line)) continue;
    push(field ? `${section}·${field}` : section, line);
  }
  flagMisalignedDimensions(facts);
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
