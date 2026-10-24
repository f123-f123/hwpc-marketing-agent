/**
 * 资料库（导购用）：把知识库整理成“有哪些型号、每款有哪些资料”。
 *
 * 只整理不改写：参数取事实原文（带限制条件与审核状态），价格原样登记，文档只读索引里登记过的文件。
 * 待审核的事实照常列出并标注，导购能看到“资料里有，但不能直接引用”。
 */
import {
  FACT_CATEGORY_LABEL,
  FactCategorySchema,
  type CatalogDetail,
  type CatalogEntry,
  type CatalogFact,
  type CatalogFigure,
  type CatalogOverview,
  type CatalogPrice,
  type CatalogSearchHit,
  type DataService,
  type FactRecord,
  type ImageRecord,
  type KnowledgeLibrary,
  type LibraryDoc,
  type LibraryDocContent,
  type LibrarySection,
  type MaterialPack,
  type PriceRecord,
  type ProductBrief,
} from "@hwpc/contracts";
import { pickPrice } from "@hwpc/agent";
import { MarketingError } from "./service.js";

interface Built {
  entry: CatalogEntry;
  pack: MaterialPack;
  prices: PriceRecord[];
  brief?: ProductBrief;
  images: ImageRecord[];
  docs: LibraryDoc[];
}

const DOC_ORDER: LibrarySection[] = ["selling", "lookup", "role_script"];
const CATEGORY_ORDER = FactCategorySchema.options;

/** 取第一条匹配的事实：优先已审核；只有待审核的也列出，但标注 pending。 */
function figure(facts: FactRecord[], label: string, match: (f: FactRecord) => boolean, join = 1): CatalogFigure | undefined {
  const hits = facts.filter(match);
  const verified = hits.filter((f) => f.reviewStatus === "verified");
  const pool = verified.length ? verified : hits;
  if (!pool.length) return undefined;
  // “HUAWEI MateBook Pro S 标准屏版：798 g” → “标准屏版：798 g”：卡片上已有型号名，只留版本与数值。
  const value = [...new Set(pool.map((f) => f.value.trim().replace(/^HUAWEI\s+MateBook\s.*?\s(?=\S*版[：:])/, "")))].slice(0, join).join(" / ");
  return { label, value: value.length > 48 ? `${value.slice(0, 47)}…` : value, pending: !verified.length };
}

/** 字段名的最后一段：“尺寸与重量·长度”只算“长度”，不能因为前缀里有“重量”就当成重量。 */
const field = (f: FactRecord) => (f.field.split("·").at(-1) ?? f.field).replace(/\s/g, "");

export function figuresOf(facts: FactRecord[]): CatalogFigure[] {
  return [
    figure(facts, "系统", (f) => f.category === "os", 2),
    figure(facts, "屏幕", (f) => f.category === "display" && /尺寸/.test(field(f))),
    figure(facts, "处理器", (f) => f.category === "processor", 2),
    figure(facts, "内存", (f) => f.category === "memory_storage" && /内存/.test(field(f))),
    figure(facts, "存储", (f) => f.category === "memory_storage" && /存储|硬盘/.test(field(f))),
    figure(facts, "重量", (f) => f.category === "portability" && /重量/.test(field(f)) && /\d\s*(kg|g)\b/i.test(f.value)),
    figure(facts, "电池", (f) => f.category === "battery" && /容量/.test(field(f))),
  ].filter((x): x is CatalogFigure => Boolean(x));
}

export function priceOf(records: PriceRecord[]): CatalogPrice | undefined {
  const view = pickPrice(records);
  if (view) {
    const r = view.record;
    return { amount: view.from, priceType: r.priceType, variant: r.variant, checkedAt: r.checkedAt.slice(0, 10), offShelf: view.offShelf, ...(view.note ? { note: view.note } : {}) };
  }
  const r = records[0];
  if (!r) return undefined;
  return { priceType: r.priceType, variant: r.variant, checkedAt: r.checkedAt.slice(0, 10), offShelf: /下架|无当前公开商城价/.test(`${r.priceType}${r.stock}`), note: "资料里没有可引用的公开金额" };
}

const ROLE_SCORE: Record<string, number> = { hero: 4, color: 3, scene: 2, other: 1, ports: 0, detail: 0 };
const fileOf = (im: ImageRecord) => (im.access.kind === "local_file" ? im.access.path.split(/[\\/]/).at(-1) ?? "" : "");

/** 卡片封面：要“看得出是哪台机器”——外观主视觉、配色图优先，避开处理器、键盘、接口这类细节图。 */
export function coverOf(images: ImageRecord[]): ImageRecord | undefined {
  const score = (im: ImageRecord) => {
    const text = `${im.description} ${fileOf(im)}`;
    return (ROLE_SCORE[im.role] ?? 1) + (/外观|主视觉|KV|整机|配色/i.test(text) ? 2 : 0) - (/处理器|芯片|性能|键盘|接口|触控板/.test(text) ? 3 : 0) + ((im.width ?? 0) >= 700 ? 1 : 0);
  };
  const area = (im: ImageRecord) => (im.width ?? 0) * (im.height ?? 0);
  return [...images].sort((a, b) => score(b) - score(a) || area(b) - area(a))[0];
}

export function gapsOf(b: Pick<Built, "pack" | "prices" | "brief" | "images">, pendingFacts: number): string[] {
  const out: string[] = [];
  if (!b.prices.length) out.push("资料里没有官方公开价格：报价以门店当日为准，推文不写价格。");
  else if (!b.prices.some((p) => p.amount)) out.push("有价格记录但没有公开金额：只能说明价格状态，不能报具体数字。");
  if (pendingFacts) out.push(`有 ${pendingFacts} 条参数待审核（原文标签可能错位），已标注；引用前请对照官网，推文不会引用。`);
  if (!b.brief) out.push("没有型号检索卡：适用 / 不适用人群需要导购自己判断。");
  if (!b.images.length) out.push("没有登记的产品图片。");
  for (const c of b.pack.conflicts) out.push(`资料冲突：${c.description}`);
  for (const g of b.pack.gaps) out.push(g);
  return out;
}

/**
 * 同一字段、同一取值、同一审核状态的事实合并成一行，限定条件取并集。
 * 知识库按版本（如 13 代酷睿版 / 12 代版）各登记一份，取值相同时合并后不丢信息，只少重复。
 */
export function mergeFacts(facts: FactRecord[]): CatalogFact[] {
  const out = new Map<string, CatalogFact>();
  for (const f of facts) {
    const key = `${f.field}|${f.value.trim()}|${f.reviewStatus}`;
    const had = out.get(key);
    if (had) had.qualifiers = [...new Set([...had.qualifiers, ...f.qualifiers])];
    else out.set(key, { factId: f.factId, field: f.field, value: f.value.trim(), qualifiers: [...f.qualifiers], reviewStatus: f.reviewStatus, source: f.source });
  }
  return [...out.values()];
}

export class CatalogService {
  private cache?: { at: number; built: Promise<Map<string, Built>> };

  constructor(private deps: { data: DataService; library?: KnowledgeLibrary; ttlMs?: number }) {}

  /** 知识库是静态资料：整理一次缓存一段时间；失败不缓存。 */
  private all(): Promise<Map<string, Built>> {
    const ttl = this.deps.ttlMs ?? 10 * 60_000;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.built;
    const built = this.build();
    this.cache = { at: Date.now(), built };
    built.catch(() => {
      if (this.cache?.built === built) this.cache = undefined;
    });
    return built;
  }

  private async build(): Promise<Map<string, Built>> {
    const { data, library } = this.deps;
    const products = (await data.searchProducts("")).candidates;
    const out = new Map<string, Built>();
    await Promise.all(
      products.map(async (product) => {
        const pack = await data.getMaterialPack({ taskId: "catalog", product: { productId: product.productId }, maxImages: 0 });
        const [prices, brief, images, docs] = await Promise.all([
          library?.prices(product.productId).catch(() => []) ?? [],
          library?.brief(product.productId).catch(() => undefined),
          library?.images({ productId: product.productId, limit: 500 }).catch(() => []) ?? [],
          library?.documents({ productId: product.productId }).catch(() => []) ?? [],
        ]);
        const hero = coverOf(images);
        const facts = pack.facts.filter((f) => f.productId === product.productId);
        const pendingFacts = facts.filter((f) => f.reviewStatus === "pending_review").length;
        const sortedDocs = [...docs].sort((a, b) => DOC_ORDER.indexOf(a.section) - DOC_ORDER.indexOf(b.section));
        const price = priceOf(prices);
        const entry: CatalogEntry = {
          productId: product.productId,
          model: product.model,
          family: product.family,
          os: [...new Set(facts.filter((f) => f.category === "os").map((f) => f.value.trim()))],
          ...(brief?.positioning ? { positioning: brief.positioning } : {}),
          ...(hero ? { heroImageId: hero.imageId } : {}),
          figures: figuresOf(facts),
          ...(price ? { price } : {}),
          coverage: { facts: facts.length - pendingFacts, pendingFacts, prices: prices.length, images: images.length, docs: docs.length, hasBrief: Boolean(brief) },
          origin: pack.origins[0] ?? "local",
          isMock: pack.isMock,
        };
        out.set(product.productId, { entry, pack: { ...pack, facts }, prices, ...(brief ? { brief } : {}), images, docs: sortedDocs });
      }),
    );
    // 按产品线排序，同系列放在一起。
    return new Map([...out.entries()].sort((a, b) => a[1].entry.model.localeCompare(b[1].entry.model, "zh-CN")));
  }

  async overview(): Promise<CatalogOverview> {
    const all = await this.all();
    const entries = [...all.values()].map((b) => b.entry);
    const { library } = this.deps;
    let lib: CatalogOverview["library"];
    if (library) {
      const st = await library.status();
      if (st.state === "connected") {
        lib = { documents: st.documents, images: st.images, prices: st.prices, general: await library.documents({ sections: ["faq", "scenario", "marketing"] }) };
      }
    }
    return { entries, ...(lib ? { library: lib } : {}), origin: entries[0]?.origin ?? "local", isMock: entries.some((e) => e.isMock) };
  }

  async product(productId: string): Promise<CatalogDetail> {
    const b = (await this.all()).get(productId);
    if (!b) throw new MarketingError("not_found", "资料库里没有这个型号");
    const groups = CATEGORY_ORDER.map((category) => ({
      category,
      label: FACT_CATEGORY_LABEL[category],
      facts: mergeFacts(b.pack.facts.filter((f) => f.category === category)),
    })).filter((g) => g.facts.length > 0);
    return {
      entry: b.entry,
      groups,
      prices: b.prices,
      ...(b.brief ? { brief: b.brief } : {}),
      images: b.images.map((im) => ({ imageId: im.imageId, description: im.description, role: im.role })),
      docs: b.docs,
      gaps: gapsOf(b, b.entry.coverage.pendingFacts),
    };
  }

  /** 全库全文检索（关键词打分，不调用模型）：顾客原话里的软件名、功能名也能搜到对应原文。 */
  async search(query: string): Promise<CatalogSearchHit[]> {
    const { library } = this.deps;
    if (!library || !query.trim()) return [];
    const byLocator = new Map((await library.documents()).map((d) => [d.source.locator, d]));
    const out: CatalogSearchHit[] = [];
    for (const h of await library.search(query.slice(0, 100), { limit: 12 })) {
      const doc = byLocator.get(h.source.locator);
      if (!doc) continue;
      out.push({ docId: doc.docId, title: doc.title, section: doc.section, ...(h.heading ? { heading: h.heading } : {}), excerpt: h.excerpt, productIds: doc.productIds });
    }
    return out;
  }

  async doc(docId: string): Promise<LibraryDocContent> {
    const doc = await this.deps.library?.document(docId);
    if (!doc) throw new MarketingError("not_found", "资料库里没有这份文档");
    return doc;
  }
}
