import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { CandidateAssessmentSchema } from "./candidates.js";
import { SceneIdSchema, SceneVersionSchema } from "./scenes.js";
import { ProductRefSchema } from "./product.js";

export const PlanCheckSchema = z.object({
  checkId: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

/** 方案核验报告：只对一个方案版本有效，不继承。 */
export const PlanVerificationSchema = z.object({
  planVersion: z.number().int().positive(),
  checks: z.array(PlanCheckSchema),
  ok: z.boolean(),
  checkedAt: IsoDateTimeSchema,
});
export type PlanVerification = z.infer<typeof PlanVerificationSchema>;

export const PlanCandidateRoleSchema = z.enum(["recommended", "alternative", "not_recommended"]);

export const PlanSceneEntrySchema = z.object({
  instanceId: IdSchema,
  sceneId: SceneIdSchema,
  sceneVersion: SceneVersionSchema,
  order: z.number().int().nonnegative(),
  /** 为什么把这个场景放进方案（对应哪条需求）。 */
  reason: z.string().min(1),
  relatedNeedEntryIds: z.array(IdSchema).default([]),
});

export const PlanStatusSchema = z.enum([
  "current",
  "superseded", // 被新版本取代
  "stale", // 需求关键变化或场景失效，不再对应当前需求
]);

/**
 * 个人方案：基于“已确认”的需求版本正式组装，版本化。
 * 方案内容自带副本（候选评价、场景实例引用），保证离开服务端后仍可核对。
 */
export const PersonalPlanSchema = z.object({
  planId: IdSchema,
  version: z.number().int().positive(),
  needVersion: z.number().int().positive(),
  needFingerprint: z.string(),
  criticalFingerprint: z.string(),
  confirmationId: IdSchema,
  createdAt: IsoDateTimeSchema,
  parentPlanVersion: z.number().int().positive().optional(),
  changeNote: z.string().optional(),
  candidates: z.array(CandidateAssessmentSchema),
  recommendation: z.object({
    primary: ProductRefSchema.optional(),
    byCandidate: z.array(z.object({ candidateId: IdSchema, role: PlanCandidateRoleSchema, reason: z.string().min(1) })),
    /** 无法给出推荐时的说明（如全部候选证据不足）。 */
    noRecommendationReason: z.string().optional(),
  }),
  scenes: z.array(PlanSceneEntrySchema),
  unresolvedQuestionIds: z.array(IdSchema),
  verification: PlanVerificationSchema,
  status: PlanStatusSchema,
  staleReason: z.string().optional(),
  /** 仅非关键需求（偏好/顾虑）变化：方案仍对应已确认需求，但建议复核。 */
  needsReview: z.boolean().default(false),
  reviewNote: z.string().optional(),
  isMock: z.boolean(),
});
export type PersonalPlan = z.infer<typeof PersonalPlanSchema>;
