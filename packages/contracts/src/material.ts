import { z } from "zod";
import { DataOriginSchema, IdSchema, IsoDateTimeSchema, SourceRefSchema } from "./common.js";
import { ProductIdentitySchema } from "./product.js";

export const FactCategorySchema = z.enum([
  "os",
  "processor",
  "memory_storage",
  "display",
  "battery",
  "portability",
  "ports",
  "audio_camera",
  "ecosystem",
  "selling_point",
  "limitation",
  "price",
  "other",
]);
export type FactCategory = z.infer<typeof FactCategorySchema>;

/** 带来源与限制条件的事实记录。价格类事实需有明确来源与有效期限定，否则不得被引用。 */
export const FactRecordSchema = z.object({
  factId: IdSchema,
  productId: IdSchema,
  /** 空数组 = 适用于该型号下所有配置；非空 = 仅适用于所列配置。 */
  configurationIds: z.array(IdSchema).default([]),
  category: FactCategorySchema,
  /** 字段名，如 “屏幕尺寸”。 */
  field: z.string().min(1),
  /** 资料原值，不改写。 */
  value: z.string().min(1),
  /** 限制条件，如 “仅 SE 版”“以实际销售版本为准”。引用时必须带入正文。 */
  qualifiers: z.array(z.string()).default([]),
  source: SourceRefSchema,
  reviewStatus: z.enum(["verified", "pending_review"]).default("verified"),
});
export type FactRecord = z.infer<typeof FactRecordSchema>;

export const ImageRoleSchema = z.enum(["hero", "scene", "detail", "color", "ports", "other"]);
export type ImageRole = z.infer<typeof ImageRoleSchema>;

/** 图片访问方式：由服务端 /api/images/:imageId 统一代理，前端不直接持有 ima 凭证。 */
export const ImageAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local_file"), path: z.string().min(1) }),
  z.object({ kind: z.literal("remote_url"), url: z.string().url() }),
  z.object({ kind: z.literal("ima_media"), mediaId: z.string().min(1), knowledgeItemId: z.string().optional() }),
  /** 仅 mock：占位图，无真实图像内容。 */
  z.object({ kind: z.literal("mock_placeholder"), label: z.string().min(1) }),
]);
export type ImageAccess = z.infer<typeof ImageAccessSchema>;

export const ImageRecordSchema = z.object({
  imageId: IdSchema,
  productId: IdSchema,
  configurationIds: z.array(IdSchema).default([]),
  role: ImageRoleSchema,
  /** 画面说明，来自资料。 */
  description: z.string().min(1),
  /** 用途建议（如 “适合公众号头图”）。 */
  usageNote: z.string().optional(),
  source: SourceRefSchema,
  access: ImageAccessSchema,
  mimeType: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type ImageRecord = z.infer<typeof ImageRecordSchema>;

/** 资料冲突：同一型号/配置同一字段出现互相矛盾的事实。存在 unresolved 冲突时必须停止并请求人工确认。 */
export const MaterialConflictSchema = z.object({
  conflictId: IdSchema,
  productId: IdSchema,
  field: z.string().min(1),
  factIds: z.array(IdSchema).min(2),
  description: z.string().min(1),
  status: z.enum(["unresolved", "resolved_by_user"]).default("unresolved"),
  resolutionNote: z.string().optional(),
});
export type MaterialConflict = z.infer<typeof MaterialConflictSchema>;

export const MaterialPackSchema = z.object({
  packId: IdSchema,
  taskId: IdSchema,
  products: z.array(ProductIdentitySchema).min(1),
  facts: z.array(FactRecordSchema),
  images: z.array(ImageRecordSchema),
  conflicts: z.array(MaterialConflictSchema).default([]),
  /** 资料缺口说明（如 “未找到价格资料”）。Agent 不得用常识补全。 */
  gaps: z.array(z.string()).default([]),
  /** 本资料包涉及的来源类型；含 mock 时 isMock 必须为 true。 */
  origins: z.array(DataOriginSchema).min(1),
  isMock: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type MaterialPack = z.infer<typeof MaterialPackSchema>;
