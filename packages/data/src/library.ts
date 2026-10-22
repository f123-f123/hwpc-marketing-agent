/**
 * 本地知识库整库检索（KnowledgeLibrary 的 local 实现）。
 *
 * 索引范围（只读，启动后首次调用时建立，常驻内存）：
 *   P1 型号检索卡 / 卖点与限制 / 官方公开价格快照，P2 按型号角色话术，P7 常见问题，P8 客户场景，P6 多屏协同；
 *   图片：各型号图片索引、商城款式图片索引、P6 商城电脑专区素材索引。
 * 检索是确定性的关键词打分（中文二元组 + 英文词，BM25），不调用模型，不联网。
 * 返回的摘录都是资料原文；文档归属哪个型号按目录判断，不靠猜。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DataServiceError,
  LIBRARY_SCENE_PRODUCT_ID,
  type ImageRecord,
  type ImageRole,
  type KnowledgeLibrary,
  type LibraryHit,
  type LibrarySection,
  type LibraryStatus,
  type PriceRecord,
  type ProductBrief,
  type SourceRef,
} from "@hwpc/contracts";
import { csvRows, defaultLocalRoot, normalized, stableId } from "./local.js";
import { scanLocalModels } from "./local/scanner.js";
import type { LocalProductModel } from "./types.js";

/* ------------------------------ 分词与打分 ------------------------------ */

const CJK = /[㐀-鿿]/;

/** 中文按二元组、英文数字按词切分；单字中文词也保留，便于“轻”“薄”这类短词命中。 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9.]+|[㐀-鿿]+/g)) {
    const run = m[0];
    if (!CJK.test(run[0]!)) {
      const w = run.replace(/^\.+|\.+$/g, "");
      if (w.length >= 1) out.push(w);
      continue;
    }
    if (run.length === 1) out.push(run);
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 查询词里没有信息量的部分。 */
const STOP = new Set(["我们", "你们", "什么", "怎么", "可以", "一个", "这个", "那个", "需要", "就是", "还是", "如果", "因为", "所以", "主要", "比较", "电脑", "笔记", "记本", "华为"]);

interface Chunk {
  chunkId: string;
  title: string;
  heading?: string;
  section: LibrarySection;
  text: string;
  productIds: string[];
  source: SourceRef;
  tf: Map<string, number>;
  len: number;
}

/* ------------------------------ 文档切块 ------------------------------ */

const strip = (md: string) =>
  md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");

/** 按二、三级标题切块；过长的块按段落再切，单块不超过 limit 字。 */
export function chunkMarkdown(md: string, limit = 900): { title: string; heading?: string; text: string }[] {
  const clean = strip(md);
  const title = clean.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
  const out: { title: string; heading?: string; text: string }[] = [];
  let heading: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (body.replace(/\s/g, "").length < 24) return;
    let cur = "";
    for (const para of body.split(/\n{2,}/)) {
      if (cur && cur.length + para.length > limit) {
        out.push({ title, heading, text: cur.trim() });
        cur = "";
      }
      cur += (cur ? "\n\n" : "") + para.slice(0, limit * 2);
    }
    if (cur.trim()) out.push({ title, heading, text: cur.trim() });
  };
  for (const line of clean.split("\n")) {
    const h = line.match(/^(#{2,4})\s+(.+)$/);
    if (h) {
      flush();
      heading = h[2]!.trim();
      continue;
    }
    if (/^#\s/.test(line)) continue;
    buf.push(line);
  }
  flush();
  return out;
}

/** 出处列表、元数据、版本记录这类块对回答没有帮助，不进索引。 */
const NOISE_HEADING = /来源|引用|参考链接|官方链接|元数据|更新记录|版本记录|变更记录|文件信息|审核记录/;
export function isNoiseChunk(heading: string | undefined, text: string): boolean {
  if (heading && NOISE_HEADING.test(heading)) return true;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const links = lines.filter((l) => /https?:\/\/|\]\(|\.md\b/.test(l)).length;
  return lines.length > 0 && links / lines.length > 0.4;
}

/** 在块里挑与查询最相关的几行做摘录（原文，不改写）。 */
function excerptOf(text: string, qTokens: Set<string>, max = 360): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !/^\|?\s*-{3,}/.test(l));
  const scored = lines.map((l, i) => ({ l, i, s: tokenize(l).filter((t) => qTokens.has(t)).length }));
  const best = [...scored].sort((a, b) => b.s - a.s || a.i - b.i);
  if (!best.length) return text.slice(0, max);
  const pick = new Set<number>();
  let size = 0;
  for (const b of best) {
    if (size >= max * 0.6 && b.s === 0) break;
    if (size + b.l.length > max && pick.size) break;
    pick.add(b.i);
    size += b.l.length;
    if (size >= max) break;
  }
  const joined = [...pick].sort((a, b) => a - b).map((i) => lines[i]!).join(" ");
  return joined.length > max ? `${joined.slice(0, max - 1)}…` : joined;
}

/* ------------------------------ 图片索引 ------------------------------ */

function roleOf(desc: string): ImageRole {
  if (/场景|办公|会议|创作|学习|出行|影音|协作|桌面体验/.test(desc)) return "scene";
  if (/接口|侧面/.test(desc)) return "ports";
  if (/配色|颜色|色$/.test(desc)) return "color";
  if (/主视觉|外观|正面|开合|A面|产品展示|创拍/.test(desc)) return "hero";
  return "detail";
}

function readImageIndex(csvPath: string, root: string, productId: string, title: string): ImageRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(csvPath, "utf8");
  } catch {
    return [];
  }
  const rows = csvRows(text);
  const head = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, "").trim());
  const col = (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i >= 0 && row[i]?.trim()) return row[i]!.trim();
    }
    return "";
  };
  const dir = path.dirname(csvPath);
  const locator = path.relative(root, csvPath).replaceAll("\\", "/");
  return rows.flatMap((row): ImageRecord[] => {
    const file = col(row, "文件名");
    if (!file || /[\\/]/.test(file)) return [];
    const local = [path.join(dir, file), path.join(dir, "images", file)].find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (!local) return [];
    const description = col(row, "官网图片说明", "画面说明") || file.replace(/\.[a-z]+$/i, "");
    const official = col(row, "原始图片URL");
    const page = col(row, "来源页面", "页面来源", "商品页URL");
    const source: SourceRef = { origin: "local", title, locator, ...(page.startsWith("https://") ? { officialUrl: page } : official.startsWith("https://") ? { officialUrl: official } : {}) };
    const captured = col(row, "抓取日期");
    if (captured) source.capturedAt = captured;
    const ext = path.extname(file).toLowerCase();
    return [
      {
        imageId: stableId("kbimg", `${locator}:${file}`),
        productId,
        configurationIds: [],
        role: roleOf(`${description} ${file}`),
        description,
        usageNote: col(row, "建议用途", "使用提示") || undefined,
        source,
        access: { kind: "local_file", path: local },
        mimeType: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg",
        width: Number(col(row, "宽度")) || undefined,
        height: Number(col(row, "高度")) || undefined,
      },
    ];
  });
}

/* ------------------------------ 价格 ------------------------------ */

const baseName = (s: string) => normalized(s.replace(/[（(][^）)]*[）)]/g, ""));

function readPrices(csvPath: string, root: string, models: LocalProductModel[]): PriceRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(csvPath, "utf8");
  } catch {
    return [];
  }
  const rows = csvRows(text);
  const head = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, "").trim());
  const col = (row: string[], name: string) => row[head.indexOf(name)]?.trim() ?? "";
  const byName = new Map(models.map((m) => [baseName(m.displayName), m.productId]));
  const locator = path.relative(root, csvPath).replaceAll("\\", "/");
  return rows.flatMap((row): PriceRecord[] => {
    const name = col(row, "规范产品名称");
    const productId = byName.get(baseName(name));
    if (!productId) return [];
    const num = (v: string) => (Number(v) > 0 ? Number(v) : undefined);
    const url = col(row, "官方URL");
    return [
      {
        recordId: col(row, "记录ID") || stableId("price", row.join("|")),
        productId,
        productName: name,
        variant: col(row, "精确款式"),
        priceType: col(row, "价格类型"),
        amount: num(col(row, "页面金额（元）")),
        listAmount: num(col(row, "参考或划线金额（元）")),
        conditions: col(row, "条件摘要"),
        stock: col(row, "库存状态"),
        checkedAt: col(row, "核验时间"),
        status: col(row, "核验状态"),
        source: { origin: "local", title: `${col(row, "来源标题") || name}（官方公开价格快照）`, locator, ...(url.startsWith("https://") ? { officialUrl: url } : {}), capturedAt: col(row, "核验时间") || undefined },
      },
    ];
  });
}

/* ------------------------------ 型号检索卡：适用人群与限制 ------------------------------ */

export function parseBrief(md: string, productId: string, source: SourceRef): ProductBrief {
  const clean = strip(md).split(/\n## 字段解读/)[0]!;
  const section = (re: RegExp) => {
    const m = clean.split(/\n(?=##\s)/).find((s) => re.test(s.split("\n")[0] ?? ""));
    if (!m) return [] as string[];
    return m
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);
  };
  const conclusion = clean.split(/\n(?=##\s)/).find((s) => /^##\s*检索结论/.test(s));
  const positioning = conclusion?.split("\n").slice(1).map((l) => l.trim()).filter(Boolean)[0];
  return {
    productId,
    ...(positioning ? { positioning } : {}),
    fits: section(/^##\s*适用任务/),
    notFits: section(/^##\s*不适用/),
    toVerify: section(/^##\s*待核验/),
    limits: section(/^##\s*限定条件/),
    source,
  };
}

/* ------------------------------ 服务 ------------------------------ */

interface Index {
  chunks: Chunk[];
  df: Map<string, number>;
  avgLen: number;
  docs: number;
  prices: PriceRecord[];
  briefs: Map<string, ProductBrief>;
  images: ImageRecord[];
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function createLocalLibrary(rootDir?: string): KnowledgeLibrary {
  const root = path.resolve(rootDir ?? defaultLocalRoot());
  let index: Index | undefined;

  const build = (): Index => {
    if (index) return index;
    const p1 = path.join(root, "P1-产品参数库");
    const models = scanLocalModels({ rootDir: root, p1Dir: p1, p7Dir: path.join(root, "P7-常见问题库") });
    if (!models.length) throw new DataServiceError("not_configured", `知识库目录不可读或没有型号：${root}`, "local");
    const byDir = new Map(models.map((m) => [m.dirName, m.productId]));

    const files: { file: string; section: LibrarySection; productIds: string[] }[] = [];
    for (const m of models) files.push({ file: m.sellPointPath, section: "selling", productIds: [m.productId] });
    for (const [dirName, productId] of byDir) {
      for (const f of walk(path.join(p1, "06-型号检索卡", dirName))) files.push({ file: f, section: "lookup", productIds: [productId] });
      for (const f of walk(path.join(root, "P2-卖点话术库", "07-按型号角色", dirName))) files.push({ file: f, section: "role_script", productIds: [productId] });
    }
    for (const f of walk(path.join(root, "P7-常见问题库"))) files.push({ file: f, section: "faq", productIds: [] });
    for (const f of walk(path.join(root, "P8-客户场景库"))) files.push({ file: f, section: "scenario", productIds: [] });
    for (const f of walk(path.join(root, "P6-营销素材库", "05-多屏协同"))) files.push({ file: f, section: "marketing", productIds: [] });

    const chunks: Chunk[] = [];
    const df = new Map<string, number>();
    let docs = 0;
    for (const { file, section, productIds } of files) {
      let md: string;
      try {
        md = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      docs++;
      const locator = path.relative(root, file).replaceAll("\\", "/");
      const parts = chunkMarkdown(md);
      parts.forEach((part, i) => {
        if (isNoiseChunk(part.heading, part.text)) return;
        const title = part.title || path.basename(file, ".md");
        // 标题与小节名计两次，命中标题的块更靠前。
        const toks = tokenize(`${title} ${part.heading ?? ""} ${title} ${part.heading ?? ""} ${part.text}`);
        const tf = new Map<string, number>();
        for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
        for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
        chunks.push({
          chunkId: stableId("chunk", `${locator}#${i}`),
          title,
          ...(part.heading ? { heading: part.heading } : {}),
          section,
          text: part.text,
          productIds,
          source: { origin: "local", title, locator },
          tf,
          len: toks.length,
        });
      });
    }

    const briefs = new Map<string, ProductBrief>();
    for (const [dirName, productId] of byDir) {
      const file = path.join(p1, "06-型号检索卡", dirName, "06-适用人群与限制卡.md");
      try {
        const md = fs.readFileSync(file, "utf8");
        const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `${dirName} 适用人群与限制`;
        briefs.set(productId, parseBrief(md, productId, { origin: "local", title, locator: path.relative(root, file).replaceAll("\\", "/") }));
      } catch {
        /* 没有检索卡的型号不提供简介 */
      }
    }

    const images: ImageRecord[] = [];
    for (const m of models) {
      const dir = path.dirname(m.factPath);
      images.push(...readImageIndex(path.join(dir, "图片索引.csv"), root, m.productId, `${m.displayName} 图片索引`));
      images.push(...readImageIndex(path.join(dir, "商城款式图片", "图片索引.csv"), root, m.productId, `${m.displayName} 商城款式图片`));
    }
    images.push(...readImageIndex(path.join(root, "P6-营销素材库", "04-图片", "02-华为商城电脑专区素材", "图片索引.csv"), root, LIBRARY_SCENE_PRODUCT_ID, "华为商城电脑专区素材"));

    const prices = readPrices(path.join(p1, "08-官方公开价格快照", "官方价格快照.csv"), root, models);
    index = { chunks, df, avgLen: chunks.reduce((s, c) => s + c.len, 0) / Math.max(1, chunks.length), docs, prices, briefs, images };
    return index;
  };

  const ensure = () => {
    try {
      return build();
    } catch (e) {
      if (e instanceof DataServiceError) throw e;
      throw new DataServiceError("invalid_data", `知识库索引失败：${e instanceof Error ? e.message : String(e)}`, "local");
    }
  };

  return {
    async status(): Promise<LibraryStatus> {
      try {
        const ix = ensure();
        return { origin: "local", state: "connected", message: `已索引 ${ix.docs} 份文档、${ix.images.length} 张图片、${ix.prices.length} 条官方价格`, documents: ix.docs, chunks: ix.chunks.length, images: ix.images.length, prices: ix.prices.length };
      } catch (e) {
        return { origin: "local", state: "error", message: e instanceof Error ? e.message : "知识库不可读", documents: 0, chunks: 0, images: 0, prices: 0 };
      }
    },

    async search(query, opts = {}): Promise<LibraryHit[]> {
      const ix = ensure();
      const qTokens = [...new Set(tokenize(query).filter((t) => !STOP.has(t)))];
      if (!qTokens.length) return [];
      const qSet = new Set(qTokens);
      const want = opts.productIds?.length ? new Set(opts.productIds) : undefined;
      const N = ix.chunks.length;
      const scored: { c: Chunk; s: number }[] = [];
      for (const c of ix.chunks) {
        if (opts.sections && !opts.sections.includes(c.section)) continue;
        if (want) {
          const bound = c.productIds.length > 0;
          const mine = c.productIds.some((p) => want.has(p));
          if (bound && !mine) continue;
          if (opts.productOnly && !mine) continue;
        }
        let s = 0;
        for (const t of qTokens) {
          const f = c.tf.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - (ix.df.get(t) ?? 0) + 0.5) / ((ix.df.get(t) ?? 0) + 0.5));
          s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * c.len) / ix.avgLen));
        }
        if (s <= 0) continue;
        if (want && c.productIds.some((p) => want.has(p))) s *= 1.5;
        scored.push({ c, s });
      }
      scored.sort((a, b) => b.s - a.s);
      // 同一文档最多取两块，避免一份长文档占满结果。
      const perDoc = new Map<string, number>();
      const out: LibraryHit[] = [];
      for (const { c, s } of scored) {
        const n = perDoc.get(c.source.locator) ?? 0;
        if (n >= 2) continue;
        perDoc.set(c.source.locator, n + 1);
        out.push({ chunkId: c.chunkId, title: c.title, ...(c.heading ? { heading: c.heading } : {}), section: c.section, excerpt: excerptOf(c.text, qSet), productIds: c.productIds, score: Math.round(s * 100) / 100, source: c.source });
        if (out.length >= (opts.limit ?? 5)) break;
      }
      return out;
    },

    async prices(productId) {
      return ensure().prices.filter((p) => p.productId === productId);
    },

    async brief(productId) {
      return ensure().briefs.get(productId);
    },

    async images(q) {
      const ix = ensure();
      const qTokens = new Set(tokenize(q.query ?? "").filter((t) => !STOP.has(t)));
      const pool = ix.images.filter((im) => (q.scenesOnly ? im.productId === LIBRARY_SCENE_PRODUCT_ID : q.productId ? im.productId === q.productId : true));
      const score = (im: ImageRecord) => {
        const hit = tokenize(`${im.description} ${path.basename(im.access.kind === "local_file" ? im.access.path : "")}`).filter((t) => qTokens.has(t)).length;
        const big = (im.width ?? 0) >= 900 ? 2 : 0;
        return hit * 3 + big;
      };
      return pool
        .map((im, i) => ({ im, s: score(im), i }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, q.limit ?? 6)
        .map((x) => x.im);
    },

    async readImage(imageId) {
      const image = ensure().images.find((i) => i.imageId === imageId);
      if (!image || image.access.kind !== "local_file") throw new DataServiceError("not_found", "知识库里没有这张图片", "local");
      const target = path.resolve(image.access.path);
      if (!target.startsWith(root + path.sep)) throw new DataServiceError("invalid_data", "图片路径不在知识库目录内", "local");
      return { image, mimeType: image.mimeType ?? "application/octet-stream", bytes: fs.readFileSync(target) };
    },
  };
}
