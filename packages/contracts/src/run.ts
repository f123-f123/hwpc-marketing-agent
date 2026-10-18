import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { ArticleSchema } from "./article.js";
import { MaterialPackSchema } from "./material.js";
import { ContentStrategySchema } from "./strategy.js";
import { ClarificationQuestionSchema, MarketingTaskInputSchema } from "./task.js";
import { VerificationReportSchema } from "./verification.js";

/** 标准流程阶段（赛题 §四（二））。 */
export const StageIdSchema = z.enum([
  "scenario_analysis",
  "platform_strategy",
  "material_retrieval",
  "fact_extraction",
  "layout",
  "drafting",
  "verification",
  "compliance",
  "export",
]);
export type StageId = z.infer<typeof StageIdSchema>;

export const TaskStatusSchema = z.enum(["queued", "running", "awaiting_clarification", "completed", "failed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** 允许的状态转换，服务端强制执行。 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["running", "failed"],
  running: ["awaiting_clarification", "completed", "failed"],
  awaiting_clarification: ["running", "failed"],
  completed: ["running"], // 提交修改要求
  failed: ["running"], // 重试（本阶段不开放接口，预留）
};
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const EventTypeSchema = z.enum([
  "stage_started",
  "stage_completed",
  "stage_failed",
  "info",
  "data_access", // 实际发生的资料/模型调用
  "clarification_requested",
  "task_completed",
  "task_failed",
]);

/** 工作流只能报告真实发生的事件。simulated=true 表示由 mock/占位实现产生，界面必须标明。 */
export const WorkflowEventSchema = z.object({
  stage: StageIdSchema.optional(),
  type: EventTypeSchema,
  message: z.string().min(1),
  /** 事件细节，如命中事实数、检索耗时；不得含凭证。 */
  detail: z.record(z.string(), z.unknown()).optional(),
  simulated: z.boolean().default(false),
});
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;
/** 工作流回调入参（可省略有默认值的字段）。 */
export type WorkflowEventInput = z.input<typeof WorkflowEventSchema>;

/** 服务端补全 seq / taskId / at 后的事件。seq 在任务内从 1 递增。 */
export const ExecutionEventSchema = WorkflowEventSchema.extend({
  seq: z.number().int().positive(),
  taskId: IdSchema,
  at: IsoDateTimeSchema,
});
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

export const ResultVersionReasonSchema = z.enum(["initial", "clarification", "revision"]);
export type ResultVersionReason = z.infer<typeof ResultVersionReasonSchema>;

export const ResultVersionSchema = z.object({
  version: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  reason: ResultVersionReasonSchema,
  /** 修改要求原文（reason=revision）。 */
  instruction: z.string().optional(),
  strategy: ContentStrategySchema,
  article: ArticleSchema,
  verification: VerificationReportSchema,
  /** 本版本所用资料包（含事实、图片，供前端解析 factIds / imageIds）。 */
  materialPack: MaterialPackSchema,
  /** 资料含 mock 或由占位实现生成时为 true。 */
  isMock: z.boolean(),
});
export type ResultVersion = z.infer<typeof ResultVersionSchema>;

/**
 * 工作流断点：需要澄清时由工作流返回，服务端原样保存并在 resume 时传回。
 * state 由工作流自行定义，必须可 JSON 序列化。
 */
export const WorkflowCheckpointSchema = z.object({
  taskId: IdSchema,
  resumeStage: StageIdSchema,
  state: z.record(z.string(), z.unknown()),
});
export type WorkflowCheckpoint = z.infer<typeof WorkflowCheckpointSchema>;

export const TaskSnapshotSchema = z.object({
  taskId: IdSchema,
  status: TaskStatusSchema,
  currentStage: StageIdSchema.optional(),
  input: MarketingTaskInputSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  pendingQuestions: z.array(ClarificationQuestionSchema).default([]),
  /** 最新版本；未产出前为空。 */
  latestVersion: ResultVersionSchema.optional(),
  versions: z.array(
    z.object({ version: z.number().int().positive(), createdAt: IsoDateTimeSchema, reason: ResultVersionReasonSchema }),
  ),
  eventCount: z.number().int().nonnegative(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
