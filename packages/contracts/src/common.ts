import { z } from "zod";

/** 资料来源类型。mock 数据必须在所有展示处可辨认。 */
export const DataOriginSchema = z.enum(["local", "ima", "mock"]);
export type DataOrigin = z.infer<typeof DataOriginSchema>;

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const IdSchema = z.string().min(1).max(200);

/** 内容发布平台（赛题 §三（三））。 */
export const PlatformSchema = z.enum(["wechat_article", "xiaohongshu", "store_moments", "store_poster"]);
export type Platform = z.infer<typeof PlatformSchema>;

/** 业务场景（赛题 §三（二））。other 时需在 scenarioNote 说明。 */
export const ScenarioSchema = z.enum([
  "back_to_school",
  "business_office",
  "content_creation",
  "family_upgrade",
  "enterprise_procurement",
  "store_visit",
  "new_launch",
  "holiday",
  "other",
]);
export type Scenario = z.infer<typeof ScenarioSchema>;

export const PurchaseStageSchema = z.enum(["awareness", "consideration", "decision", "after_sales", "unknown"]);
export type PurchaseStage = z.infer<typeof PurchaseStageSchema>;

/** 资料出处。locator 是本地相对路径、ima 资料标识或公开 URL；不得含密钥。 */
export const SourceRefSchema = z.object({
  origin: DataOriginSchema,
  title: z.string().min(1),
  locator: z.string().min(1),
  /** 官方公开页面（如资料中标注的来源 URL），可选。 */
  officialUrl: z.string().url().optional(),
  /** 资料抓取/核验日期（来自资料本身），可选。 */
  capturedAt: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
