import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { SceneIdSchema, SceneVersionSchema } from "./scenes.js";
import { NeedKeySchema } from "./needs.js";

export const CompletionSchema = z.enum(["not_started", "in_progress", "walkthrough_completed"]);
export type Completion = z.infer<typeof CompletionSchema>;

/**
 * 体验记录：用户在某个场景实例里走到哪、做过什么。
 * 完成只表示“看完/走完了该场景流程”。deviceTested 恒为 false：
 * 声明性场景不会在真实设备上测试，不能据此宣称设备功能验证通过。
 */
export const ExperienceRecordSchema = z.object({
  instanceId: IdSchema,
  sceneId: SceneIdSchema,
  sceneVersion: SceneVersionSchema,
  planVersion: z.number().int().positive().optional(),
  currentStateId: z.string(),
  visitedStateIds: z.array(z.string()),
  reachedOutcomeIds: z.array(z.string()),
  completion: CompletionSchema,
  actionLog: z.array(z.object({ actionId: z.string(), from: z.string(), to: z.string(), at: IsoDateTimeSchema })),
  deviceTested: z.literal(false),
  updatedAt: IsoDateTimeSchema,
});
export type ExperienceRecord = z.infer<typeof ExperienceRecordSchema>;

export const FeedbackKindSchema = z.enum([
  "new_need", // 体验中发现新需求
  "change_need", // 修改已有需求
  "concern", // 新顾虑
  "reject_candidate",
  "prefer_candidate",
  "reject_scene",
  "confirm_condition", // 用户声明满足某使用条件（自述，非设备验证）
  "note", // 仅记录，不改变任何东西
]);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;

/** 用户明确反馈。只有用户的显式提交才会产生，系统/模型不得代写。 */
export const FeedbackRecordSchema = z.object({
  feedbackId: IdSchema,
  at: IsoDateTimeSchema,
  kind: FeedbackKindSchema,
  /** 用户原话。 */
  text: z.string().min(1).max(1000),
  instanceId: IdSchema.optional(),
  planVersion: z.number().int().positive().optional(),
  needKey: NeedKeySchema.optional(),
  /** change_need 时指向被修改的条目。 */
  entryId: IdSchema.optional(),
  candidateId: IdSchema.optional(),
  conditionKey: z.string().optional(),
  /** 受影响链路的记录编号。 */
  impactId: IdSchema.optional(),
});
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

/** 影响分析：反馈会让哪些东西失效、需要重新做什么。由服务端确定性计算。 */
export const ImpactRecordSchema = z.object({
  impactId: IdSchema,
  feedbackId: IdSchema.optional(),
  cause: z.enum(["feedback", "need_edit", "scene_invalidated", "scene_migrated"]),
  at: IsoDateTimeSchema,
  fromNeedVersion: z.number().int().positive().optional(),
  toNeedVersion: z.number().int().positive().optional(),
  changedNeedKeys: z.array(NeedKeySchema).default([]),
  critical: z.boolean(),
  invalidatedConfirmationIds: z.array(IdSchema),
  stalePlanVersions: z.array(z.number().int().positive()),
  reviewPlanVersions: z.array(z.number().int().positive()),
  affectedInstanceIds: z.array(IdSchema),
  requiresReconfirmation: z.boolean(),
  requiresReassessment: z.boolean(),
  newQuestionIds: z.array(IdSchema),
  summary: z.string(),
});
export type ImpactRecord = z.infer<typeof ImpactRecordSchema>;
