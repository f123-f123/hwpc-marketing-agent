import { z } from "zod";
import { DataOriginSchema, IdSchema, SourceRefSchema } from "./common.js";
import type { ImageRecord } from "./material.js";
import type { ConnectionState, ImageContent } from "./services.js";

/**
 * 知识库检索（资料层，Agent A 实现）。
 *
 * DataService 只给“某个型号的事实与图片”；选购沟通还需要整库检索：
 * 型号检索卡（适用 / 不适用任务）、卖点与限制、官方公开价格、常见问题、客户场景卡、营销图片素材。
 * 检索结果一律是资料原文摘录，带出处；调用方只能引用，不能当作新事实改写。
 */

export const LibrarySectionSchema = z.enum([
  "lookup", // P1 型号检索卡
  "selling", // P1 卖点与限制
  "role_script", // P2 按型号角色话术
  "price", // P1 官方公开价格
  "faq", // P7 常见问题与支持
  "scenario", // P8 客户场景
  "marketing", // P6 营销素材
  "other",
]);
export type LibrarySection = z.infer<typeof LibrarySectionSchema>;

export const LIBRARY_SECTION_LABEL: Record<LibrarySection, string> = {
  lookup: "型号检索卡",
  selling: "卖点与限制",
  role_script: "型号话术",
  price: "官方公开价格",
  faq: "常见问题",
  scenario: "客户场景",
  marketing: "营销素材",
  other: "资料",
};

export const LibraryHitSchema = z.object({
  chunkId: IdSchema,
  /** 文档标题（一级标题或文件名）。 */
  title: z.string().min(1),
  /** 命中的小节标题。 */
  heading: z.string().optional(),
  section: LibrarySectionSchema,
  /** 资料原文摘录，不改写。 */
  excerpt: z.string().max(600),
  /** 文档关联的型号（按目录归属判断）；通用资料为空。 */
  productIds: z.array(IdSchema).default([]),
  score: z.number(),
  source: SourceRefSchema,
});
export type LibraryHit = z.infer<typeof LibraryHitSchema>;

export interface LibrarySearchOptions {
  sections?: LibrarySection[];
  /** 只要与这些型号相关的资料（通用资料仍可返回，除非 productOnly）。 */
  productIds?: string[];
  productOnly?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

/** 官方公开价格记录（原样登记，不推算）。 */
export const PriceRecordSchema = z.object({
  recordId: IdSchema,
  productId: IdSchema,
  productName: z.string(),
  /** 精确款式，如“16GB/512GB/圆键盘/原野绿”。 */
  variant: z.string(),
  /** 价格类型原文：官方商城页面价 / 官网参考起价 / 预估到手价 / 已下架…… */
  priceType: z.string(),
  amount: z.number().positive().optional(),
  listAmount: z.number().positive().optional(),
  conditions: z.string(),
  stock: z.string(),
  checkedAt: z.string(),
  status: z.string(),
  source: SourceRefSchema,
});
export type PriceRecord = z.infer<typeof PriceRecordSchema>;

/** 型号检索卡里的“适用 / 不适用 / 待核验”，选型时直接引用。 */
export const ProductBriefSchema = z.object({
  productId: IdSchema,
  positioning: z.string().optional(),
  fits: z.array(z.string()).default([]),
  notFits: z.array(z.string()).default([]),
  toVerify: z.array(z.string()).default([]),
  limits: z.array(z.string()).default([]),
  source: SourceRefSchema,
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

export interface LibraryStatus {
  origin: z.infer<typeof DataOriginSchema>;
  state: ConnectionState;
  message: string;
  documents: number;
  chunks: number;
  images: number;
  prices: number;
}

/** 知识库里的一份文档（一个 Markdown 文件），供资料库浏览。 */
export const LibraryDocSchema = z.object({
  docId: IdSchema,
  section: LibrarySectionSchema,
  title: z.string().min(1),
  /** 文档里的小节标题，按出现顺序。 */
  headings: z.array(z.string()).default([]),
  productIds: z.array(IdSchema).default([]),
  source: SourceRefSchema,
});
export type LibraryDoc = z.infer<typeof LibraryDocSchema>;

/** 文档全文（按小节，原文不改写；已去掉注释与出处列表等噪声）。 */
export const LibraryDocContentSchema = LibraryDocSchema.extend({
  parts: z.array(z.object({ heading: z.string().optional(), text: z.string() })),
});
export type LibraryDocContent = z.infer<typeof LibraryDocContentSchema>;

export interface LibraryDocQuery {
  /** 只要这个型号的文档（卖点与限制、检索卡、型号话术）。 */
  productId?: string;
  sections?: LibrarySection[];
}

export interface LibraryImageQuery {
  productId?: string;
  /** 画面关键词，如“移动办公”“会议”“外观”。 */
  query?: string;
  /** 只要场景/营销图（不绑定型号）。 */
  scenesOnly?: boolean;
  limit?: number;
}

export interface KnowledgeLibrary {
  status(signal?: AbortSignal): Promise<LibraryStatus>;
  search(query: string, opts?: LibrarySearchOptions): Promise<LibraryHit[]>;
  prices(productId: string): Promise<PriceRecord[]>;
  brief(productId: string): Promise<ProductBrief | undefined>;
  /** 知识库里登记过的图片（型号图、商城款式图、营销场景图），按相关度排序。 */
  images(query: LibraryImageQuery): Promise<ImageRecord[]>;
  /** 只读取索引里登记过的图片。 */
  readImage(imageId: string, signal?: AbortSignal): Promise<ImageContent & { image: ImageRecord }>;
  /** 索引里登记过的文档清单（按型号或资料类别过滤）。 */
  documents(query?: LibraryDocQuery): Promise<LibraryDoc[]>;
  /** 读取一份已索引文档的全文；不在索引里的返回 undefined。 */
  document(docId: string): Promise<LibraryDocContent | undefined>;
}

/** 场景/营销图不绑定型号时使用的 productId。 */
export const LIBRARY_SCENE_PRODUCT_ID = "kb-scene";
