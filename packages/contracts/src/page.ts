import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, SourceRefSchema } from "./common.js";
import { CandidateOverallSchema } from "./candidates.js";
import { ImageRoleSchema } from "./material.js";
import { PlanCandidateRoleSchema } from "./plan.js";
import { ProductRefSchema } from "./product.js";

/**
 * 沉浸式体验页（需求确认、方案组装之后生成）。
 *
 * 页面不是模型写的 HTML，而是程序按方案拼出的“版块 + 内容位”：
 * - 版块种类固定（开场 / 你的日常 / 候选 / 动手体验 / 方案），结构当场生成，立即可看；
 * - 图片位、文案位由填充器异步补齐（知识库、官网、以后的检索 API），每一项都标明来源；
 * - 事实只能来自知识库原文并带限制条件；没填上的位置显示占位，不编造。
 * 页面绑定方案版本：之后的提问不会修改它，需求变化要回到需求沟通重新确认、重新生成。
 */

/** 内容从哪来，界面按此标注。 */
export const SlotOriginSchema = z.enum([
  "local", // 本地知识库
  "ima", // ima 知识库
  "official_web", // 官网（华为官方域名）
  "web", // 其他网页，仅供参考
  "illustration", // 程序绘制的示意
  "template", // 按知识库事实套用的模板句
  "model", // 模型写的文案（事实仍由程序按原文填入）
]);
export type SlotOrigin = z.infer<typeof SlotOriginSchema>;

export const SlotStatusSchema = z.enum(["pending", "filled", "failed"]);
export type SlotStatus = z.infer<typeof SlotStatusSchema>;

export const ImageSlotSchema = z.object({
  slotId: IdSchema,
  /** 这张图要表达什么，例如“MateBook 14 外观主视觉”。填充器据此找图，未填时作为占位说明。 */
  intent: z.string().min(1),
  product: ProductRefSchema.optional(),
  /** 期望的画面类型，按优先级。 */
  roles: z.array(ImageRoleSchema).default([]),
  status: SlotStatusSchema,
  image: z
    .object({
      url: z.string().min(1),
      alt: z.string(),
      caption: z.string().optional(),
      origin: SlotOriginSchema,
      source: SourceRefSchema.optional(),
    })
    .optional(),
  failReason: z.string().optional(),
});
export type ImageSlot = z.infer<typeof ImageSlotSchema>;

export const CopySlotSchema = z.object({
  slotId: IdSchema,
  intent: z.string().min(1),
  status: SlotStatusSchema,
  text: z.string().optional(),
  origin: SlotOriginSchema.optional(),
  /** 文案引用的事实；限制条件随文案一起展示。 */
  factIds: z.array(IdSchema).default([]),
  qualifiers: z.array(z.string()).default([]),
});
export type CopySlot = z.infer<typeof CopySlotSchema>;

/** 大字展示的事实数字，例如“约 1.33 kg”。只取知识库原值。 */
export const PageHighlightSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  factId: IdSchema.optional(),
  qualifiers: z.array(z.string()).default([]),
});

export const PagePointSchema = z.object({
  text: z.string().min(1),
  evidence: z.array(z.object({ title: z.string(), quote: z.string().optional() })).default([]),
  hard: z.boolean().optional(),
});
export type PagePoint = z.infer<typeof PagePointSchema>;

const base = { sectionId: IdSchema };

export const PageSectionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("hero"),
    eyebrow: z.string(),
    headline: z.string().min(1),
    lede: CopySlotSchema,
    /** 需求关键词，例如“出差 / 预算约 6000 元 / 轻一点”。 */
    chips: z.array(z.string()).default([]),
    image: ImageSlotSchema,
  }),
  z.object({
    ...base,
    kind: z.literal("needs"),
    title: z.string(),
    items: z.array(
      z.object({
        label: z.string(),
        values: z.array(z.object({ text: z.string(), hard: z.boolean().default(false), status: z.string() })),
      }),
    ),
  }),
  z.object({
    ...base,
    kind: z.literal("candidate"),
    candidateId: IdSchema,
    product: ProductRefSchema,
    name: z.string().min(1),
    role: z.union([PlanCandidateRoleSchema, z.literal("unranked")]),
    overall: CandidateOverallSchema,
    /** 一句话结论：为什么选 / 不选。 */
    verdict: z.string().min(1),
    intro: CopySlotSchema,
    image: ImageSlotSchema,
    highlights: z.array(PageHighlightSchema).default([]),
    satisfied: z.array(PagePointSchema).default([]),
    compromises: z.array(PagePointSchema).default([]),
    unmet: z.array(PagePointSchema).default([]),
    unknowns: z.array(PagePointSchema).default([]),
    isMock: z.boolean(),
  }),
  z.object({
    ...base,
    kind: z.literal("experience"),
    title: z.string(),
    lede: z.string(),
    /** 方案安排的场景（个人实例）。空数组时只展示通用浏览。 */
    scenes: z.array(z.object({ instanceId: IdSchema, sceneId: IdSchema, title: z.string(), reason: z.string() })).default([]),
  }),
  z.object({
    ...base,
    kind: z.literal("plan"),
    title: z.string(),
    primaryName: z.string().optional(),
    primaryReason: z.string().optional(),
    noRecommendationReason: z.string().optional(),
    others: z.array(z.object({ name: z.string(), role: PlanCandidateRoleSchema, reason: z.string() })).default([]),
    verificationOk: z.boolean(),
    checks: z.array(z.object({ ok: z.boolean(), detail: z.string() })).default([]),
  }),
]);
export type PageSection = z.infer<typeof PageSectionSchema>;
export type PageSectionKind = PageSection["kind"];

export const ExperiencePageSchema = z.object({
  pageId: IdSchema,
  planVersion: z.number().int().positive(),
  needVersion: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  theme: z.literal("dark-hero").default("dark-hero"),
  sections: z.array(PageSectionSchema).min(1),
  isMock: z.boolean(),
  /** 还有待填充的内容位、且配置了能处理它们的填充器：前端据此轮询。 */
  filling: z.boolean().default(false),
});
export type ExperiencePage = z.infer<typeof ExperiencePageSchema>;

/** 页面里所有内容位（便于填充器遍历）。 */
export function pageSlots(page: ExperiencePage): { images: ImageSlot[]; copies: CopySlot[] } {
  const images: ImageSlot[] = [];
  const copies: CopySlot[] = [];
  for (const s of page.sections) {
    if (s.kind === "hero") {
      images.push(s.image);
      copies.push(s.lede);
    }
    if (s.kind === "candidate") {
      images.push(s.image);
      copies.push(s.intro);
    }
  }
  return { images, copies };
}
