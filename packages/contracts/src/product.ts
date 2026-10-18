import { z } from "zod";
import { DataOriginSchema, IdSchema } from "./common.js";

/**
 * 型号（model）与配置（configuration）必须分开：
 * - 型号：如 “HUAWEI MateBook D 14 2024 13代酷睿版”，决定参数与图片的主归属。
 * - 配置：同一型号下的 SKU 差异，如 标准版/SE 版、i5/i7、内存/存储、键盘类型。
 */
export const ProductConfigurationSchema = z.object({
  configurationId: IdSchema,
  label: z.string().min(1),
  /** 区分该配置的属性，如 { 版本: "SE 版", 处理器: "i5-13420H" }。 */
  attributes: z.record(z.string(), z.string()).default({}),
});
export type ProductConfiguration = z.infer<typeof ProductConfigurationSchema>;

/** 设备类别。场景的设备角色按类别匹配；缺省类别视为未知，不默认为 pc。 */
export const DeviceCategorySchema = z.enum(["pc", "phone", "tablet", "display", "printer", "accessory", "other"]);
export type DeviceCategory = z.infer<typeof DeviceCategorySchema>;

export const ProductIdentitySchema = z.object({
  productId: IdSchema,
  category: DeviceCategorySchema.optional(),
  /** 系列/家族，如 MateBook D 14。 */
  family: z.string().min(1),
  /** 精确型号名。 */
  model: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  configurations: z.array(ProductConfigurationSchema).default([]),
  origin: DataOriginSchema,
});
export type ProductIdentity = z.infer<typeof ProductIdentitySchema>;

/** 指向某一型号（可选再细化到某一配置）。 */
export const ProductRefSchema = z.object({
  productId: IdSchema,
  configurationId: IdSchema.optional(),
});
export type ProductRef = z.infer<typeof ProductRefSchema>;

export const ProductSearchResultSchema = z.object({
  query: z.string(),
  candidates: z.array(ProductIdentitySchema),
  /** 查询命中多个型号，或命中型号下配置会影响事实时为 true。 */
  ambiguous: z.boolean(),
  disambiguation: z
    .object({
      question: z.string().min(1),
      options: z.array(
        z.object({
          productId: IdSchema,
          configurationId: IdSchema.optional(),
          label: z.string().min(1),
        }),
      ),
    })
    .optional(),
});
export type ProductSearchResult = z.infer<typeof ProductSearchResultSchema>;
