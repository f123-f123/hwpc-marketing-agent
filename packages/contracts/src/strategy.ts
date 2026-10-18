import { z } from "zod";
import { IdSchema, PlatformSchema, PurchaseStageSchema, ScenarioSchema } from "./common.js";

/** 平台规则落地为可检查的参数，用于证明“换平台时结构、语气、图片数、引导均变化”。 */
export const PlatformPlanSchema = z.object({
  platform: PlatformSchema,
  titleStyle: z.string().min(1),
  /** 正文字数范围（字）。 */
  lengthRange: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }),
  structure: z.array(z.string().min(1)).min(1),
  tone: z.string().min(1),
  imageCount: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }),
  ctaStyle: z.string().min(1),
});
export type PlatformPlan = z.infer<typeof PlatformPlanSchema>;

export const ContentStrategySchema = z.object({
  audience: z.string().min(1),
  scenario: ScenarioSchema,
  scenarioNote: z.string().optional(),
  purchaseStage: PurchaseStageSchema,
  userProblems: z.array(z.string().min(1)).min(1),
  contentGoal: z.string().min(1),
  /** 内容切入点：换场景时必须变化。 */
  angle: z.string().min(1),
  platformPlan: PlatformPlanSchema,
  /** 按优先级排序的计划使用事实。 */
  sellingPointFactIds: z.array(IdSchema),
  /** 可读的策略解释，供界面展示。 */
  rationale: z.string().min(1),
});
export type ContentStrategy = z.infer<typeof ContentStrategySchema>;
