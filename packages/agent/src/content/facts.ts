/**
 * 事实占位符：模型只写 {{F3}}，程序按资料原文逐字填入。
 * 这样参数、数值和量词从结构上不可能被模型改写或编造；写作温度可以放高，事实不受影响。
 */
import type { Article, ArticleBlock, FactRecord, ImageRecord } from "@hwpc/contracts";
import { TOPICS } from "../lexicon.js";

export interface FactAlias {
  alias: string;
  fact: FactRecord;
}

export interface ImageAlias {
  alias: string;
  image: ImageRecord;
}

const MAX_FACTS = 16;

/** 对顾客有意义、适合写进推文的字段。 */
const INTERESTING = /重量|厚度|续航|电池·容量|屏幕·(?:尺寸|类型|分辨率|色域|亮度)|刷新|处理器|内存|存储|接口|星闪|WLAN|指纹|摄像头|扬声器|触控/;
/** 写进推文没有吸引力的字段（仍可用，只是排在后面）。 */
const DULL = /长度|宽度|高度|屏占比|对比度|可视角度|麦克风|操作系统/;

/**
 * 资料层解析残留的识别：表头、空值、网页按钮文字等被误当成参数值的条目。
 * 这些问题的根源在 packages/data 的表格解析，这里只是推文侧的防线，不替代修复解析。
 */
const JUNK_VALUE = /^(?:CPU|GPU|材料|刷新率|色准|星闪|继续访问|取消|标准版|柔光版|电源键)[:：]?$/;
const JUNK_TEXT = /即将离开|跳转至第三方|无法控制|继续访问/;

function plausible(f: FactRecord): boolean {
  const v = f.value.trim();
  if (v.length < 2 || /[:：]$/.test(v) || JUNK_VALUE.test(v) || JUNK_TEXT.test(v)) return false;
  if (/包装清单/.test(f.field)) return false;
  // 笔记本尺寸的合理性：厚度不会超过 40 mm，长、宽不会小于 100 mm（防止表格列错位）。
  const mm = /^(\d+(?:\.\d+)?)\s*mm$/.exec(v);
  if (mm) {
    const n = Number(mm[1]);
    if (/厚度/.test(f.field) && n > 40) return false;
    if (/长度|宽度/.test(f.field) && n < 100) return false;
  }
  return true;
}

/**
 * 挑出本次写作可用的事实：只要已审核、不含价格、看起来不是解析残留的；
 * 与主题/角度相关的类别、对顾客有意义的字段排在前面。不同角度挑出的事实不同，写出来的重点也就不同。
 */
export function selectFacts(facts: FactRecord[], topicIds: string[]): FactAlias[] {
  const wanted = new Set(TOPICS.filter((t) => topicIds.includes(t.id)).flatMap((t) => t.categories as string[]));
  const usable = facts.filter((f) => f.reviewStatus === "verified" && f.category !== "price" && plausible(f));
  const score = (f: FactRecord) => (wanted.has(f.category) ? 2 : 0) + (INTERESTING.test(f.field) ? 1 : 0) - (DULL.test(f.field) ? 2 : 0);
  const seen = new Set<string>();
  const ranked = [...usable]
    .sort((a, b) => score(b) - score(a))
    .filter((f) => {
      const key = `${f.productId}|${f.field}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FACTS);
  return ranked.map((fact, i) => ({ alias: `F${i + 1}`, fact }));
}

export function aliasImages(images: ImageRecord[], max: number): ImageAlias[] {
  const order: Record<string, number> = { scene: 0, hero: 1, detail: 2, color: 3, ports: 4, other: 5 };
  return [...images]
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9))
    .slice(0, max)
    .map((image, i) => ({ alias: `I${i + 1}`, image }));
}

/** 兼容模型常见的几种占位写法：{{F3}}、{{ F3 }}、{F3}、【F3】。 */
const PLACEHOLDER_RE = /\{\{\s*(F\d+)\s*\}\}|\{(F\d+)\}|【(F\d+)】/g;

const sentencesOf = (t: string) => t.split(/(?<=[。！!？?；;\n])/).filter((x) => x.trim());

export interface FillResult {
  text: string;
  factIds: string[];
  /** 引用了不存在的占位符的句子（已删除）。 */
  dropped: string[];
}

/** 段落填充：替换占位符；引用未知编号的整句删除；所用事实的限制条件在段末统一注明一次。 */
export function fillParagraph(text: string, facts: Map<string, FactRecord>): FillResult {
  const factIds: string[] = [];
  const dropped: string[] = [];
  const kept: string[] = [];
  for (const sen of sentencesOf(text)) {
    let unknown = false;
    const filled = sen.replace(PLACEHOLDER_RE, (_m, a?: string, b?: string, c?: string) => {
      const alias = (a ?? b ?? c)!;
      const f = facts.get(alias);
      if (!f) {
        unknown = true;
        return "";
      }
      if (!factIds.includes(f.factId)) factIds.push(f.factId);
      return f.value;
    });
    if (unknown) dropped.push(sen.trim());
    else kept.push(filled);
  }
  const used = factIds.map((id) => [...facts.values()].find((f) => f.factId === id)!);
  const qualifiers = [...new Set(used.flatMap((f) => f.qualifiers))];
  let out = kept.join("").trim();
  // 列表式段落（每行一条）把限制条件单独放一行；普通段落接在句末。
  if (qualifiers.length) out += out.includes("\n") ? `\n（${qualifiers.join("；")}）` : `（${qualifiers.join("；")}）`;
  return { text: out, factIds, dropped };
}

/** 标题、导语、行动引导不绑定事实：出现占位符就去掉，不让参数进入这些位置。 */
export function stripPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_RE, "").replace(/\s{2,}/g, " ").trim();
}

export interface RawBlock {
  type: "paragraph" | "image";
  heading?: string;
  text?: string;
  image?: string;
  caption?: string;
}

export interface RawArticle {
  title: string;
  lead?: string;
  blocks: RawBlock[];
  callToAction: string;
  tags: string[];
}

/** 把模型的占位稿变成可核验的 Article。返回被删除的句子，供核验报告说明。 */
export function materialize(raw: RawArticle, platform: Article["platform"], facts: FactAlias[], images: ImageAlias[]): { article: Article; dropped: string[] } {
  const factMap = new Map(facts.map((f) => [f.alias, f.fact]));
  const imageMap = new Map(images.map((i) => [i.alias, i.image]));
  const dropped: string[] = [];
  const blocks: ArticleBlock[] = [];
  const usedImages = new Set<string>();
  for (const b of raw.blocks) {
    if (b.type === "image") {
      const img = b.image ? imageMap.get(b.image.trim()) : undefined;
      if (!img || usedImages.has(img.imageId)) continue;
      usedImages.add(img.imageId);
      blocks.push({ type: "image", imageId: img.imageId, caption: stripPlaceholders(b.caption ?? "") || img.description, placementReason: "模型按平台图文节奏安排" });
      continue;
    }
    if (!b.text?.trim()) continue;
    const r = fillParagraph(b.text, factMap);
    dropped.push(...r.dropped);
    if (!r.text) continue;
    blocks.push({ type: "paragraph", ...(b.heading ? { heading: stripPlaceholders(b.heading) } : {}), text: r.text, factIds: r.factIds });
  }
  return {
    article: {
      platform,
      title: stripPlaceholders(raw.title),
      ...(raw.lead ? { lead: stripPlaceholders(raw.lead) } : {}),
      blocks,
      callToAction: stripPlaceholders(raw.callToAction),
      tags: raw.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).slice(0, 10),
    },
    dropped,
  };
}

/** 型号简称：去掉品牌前缀；超长时去掉括号说明，再按空格截断，不截在单词中间。 */
export function shortModel(model: string, max: number): string {
  let s = model.replace(/^HUAWEI\s+/i, "").trim();
  if ([...s].length <= max) return s;
  s = s.replace(/[（(][^）)]*[）)]/g, "").trim();
  if ([...s].length <= max) return s;
  const words = s.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if ([...next].length > max) break;
    out = next;
  }
  return out || [...s].slice(0, max).join("");
}
