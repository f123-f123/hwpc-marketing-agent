import { z } from "zod";
import { DataOriginSchema, IdSchema, SourceRefSchema } from "./common.js";
import { LibraryDocSchema, PriceRecordSchema, ProductBriefSchema } from "./library.js";
import { FactCategorySchema, ImageRoleSchema } from "./material.js";

/**
 * 资料库（导购用）：知识库里有哪些型号、每款有哪些资料。
 *
 * 只做整理与展示，不改写原文：参数取事实原文（带限制条件与审核状态），价格原样登记（价格类型、款式、核验日期），
 * 待审核的事实照常列出但明确标注“不能直接引用”。
 */

export const FACT_CATEGORY_LABEL: Record<z.infer<typeof FactCategorySchema>, string> = {
  os: "系统",
  processor: "处理器",
  memory_storage: "内存与存储",
  display: "屏幕",
  battery: "电池与续航",
  portability: "尺寸与重量",
  ports: "接口与无线",
  audio_camera: "音频与摄像头",
  ecosystem: "多设备协同",
  selling_point: "卖点",
  limitation: "限制与注意",
  price: "价格",
  other: "其他",
};

/** 总览卡片上的一个关键参数（事实原文）。 */
export const CatalogFigureSchema = z.object({
  label: z.string(),
  value: z.string(),
  /** 来自待审核事实：只供了解，不能直接引用。 */
  pending: z.boolean().default(false),
});
export type CatalogFigure = z.infer<typeof CatalogFigureSchema>;

/** 总览用的价格摘要：最低公开金额与它的口径。 */
export const CatalogPriceSchema = z.object({
  amount: z.number().positive().optional(),
  priceType: z.string(),
  variant: z.string(),
  checkedAt: z.string(),
  /** 当前商城已下架 / 无公开商城价。 */
  offShelf: z.boolean(),
  /** 不是商城页面价时的说明。 */
  note: z.string().optional(),
});
export type CatalogPrice = z.infer<typeof CatalogPriceSchema>;

export const CatalogEntrySchema = z.object({
  productId: IdSchema,
  model: z.string(),
  family: z.string(),
  /** 系统路线（原文），如 HarmonyOS 6、Windows 11 家庭版。 */
  os: z.array(z.string()).default([]),
  /** 检索卡里的一句话定位。 */
  positioning: z.string().optional(),
  heroImageId: IdSchema.optional(),
  figures: z.array(CatalogFigureSchema).default([]),
  price: CatalogPriceSchema.optional(),
  /** 资料覆盖：每类资料有多少条，导购一眼看出哪款资料全、哪款缺。 */
  coverage: z.object({
    facts: z.number().int().nonnegative(),
    pendingFacts: z.number().int().nonnegative(),
    prices: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
    docs: z.number().int().nonnegative(),
    hasBrief: z.boolean(),
  }),
  origin: DataOriginSchema,
  isMock: z.boolean(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogOverviewSchema = z.object({
  entries: z.array(CatalogEntrySchema),
  /** 整库统计；没有整库检索（模拟数据或纯 ima）时为空。 */
  library: z
    .object({
      documents: z.number().int().nonnegative(),
      images: z.number().int().nonnegative(),
      prices: z.number().int().nonnegative(),
      /** 不绑定型号的通用资料：常见问题、客户场景、营销素材。 */
      general: z.array(LibraryDocSchema),
    })
    .optional(),
  origin: DataOriginSchema,
  isMock: z.boolean(),
});
export type CatalogOverview = z.infer<typeof CatalogOverviewSchema>;

/** 全库搜索命中：落到具体文档的小节，附原文摘录。 */
export const CatalogSearchHitSchema = z.object({
  docId: IdSchema,
  title: z.string(),
  section: LibraryDocSchema.shape.section,
  heading: z.string().optional(),
  excerpt: z.string(),
  productIds: z.array(IdSchema).default([]),
});
export type CatalogSearchHit = z.infer<typeof CatalogSearchHitSchema>;

export const CatalogFactSchema = z.object({
  factId: IdSchema,
  field: z.string(),
  value: z.string(),
  qualifiers: z.array(z.string()).default([]),
  reviewStatus: z.enum(["verified", "pending_review"]),
  source: SourceRefSchema,
});
export type CatalogFact = z.infer<typeof CatalogFactSchema>;

export const CatalogDetailSchema = z.object({
  entry: CatalogEntrySchema,
  groups: z.array(z.object({ category: FactCategorySchema, label: z.string(), facts: z.array(CatalogFactSchema) })),
  prices: z.array(PriceRecordSchema),
  brief: ProductBriefSchema.optional(),
  images: z.array(z.object({ imageId: IdSchema, description: z.string(), role: ImageRoleSchema })),
  docs: z.array(LibraryDocSchema),
  /** 资料缺口：导购需要知道哪些问题资料里答不了。 */
  gaps: z.array(z.string()).default([]),
});
export type CatalogDetail = z.infer<typeof CatalogDetailSchema>;
