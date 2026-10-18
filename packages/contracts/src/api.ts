import { z } from "zod";
import { ProductSearchResultSchema } from "./product.js";
import { ClarificationAnswerSchema, MarketingTaskInputSchema } from "./task.js";
import { ExecutionEventSchema, ResultVersionSchema, TaskSnapshotSchema, TaskStatusSchema } from "./run.js";

/**
 * HTTP 接口契约（前缀 /api，JSON）。路径常量与请求/响应 schema 集中在此。
 * 前端用 schema.parse 校验响应；服务端用 schema.safeParse 校验请求。
 */
export const API_PATHS = {
  health: "/api/health",
  status: "/api/status",
  productSearch: "/api/products/search", // ?q=
  tasks: "/api/tasks",
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  events: (id: string) => `/api/tasks/${encodeURIComponent(id)}/events`, // ?after=<seq>
  answers: (id: string) => `/api/tasks/${encodeURIComponent(id)}/answers`,
  revisions: (id: string) => `/api/tasks/${encodeURIComponent(id)}/revisions`,
  exportResult: (id: string) => `/api/tasks/${encodeURIComponent(id)}/export`, // ?format=&version=
  image: (taskId: string, imageId: string) =>
    `/api/tasks/${encodeURIComponent(taskId)}/images/${encodeURIComponent(imageId)}`,
  /** 绑定版本的图片：只能访问该版本资料包内的图片。 */
  versionImage: (taskId: string, version: number, imageId: string) =>
    `/api/tasks/${encodeURIComponent(taskId)}/versions/${version}/images/${encodeURIComponent(imageId)}`,

  /* ---- 门店选购会话 ---- */
  capabilities: "/api/capabilities",
  scenes: "/api/scenes",
  scene: (id: string, version: number) => `/api/scenes/${encodeURIComponent(id)}/${version}`,
  sessions: "/api/sessions",
  session: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  sessionMessages: (id: string) => `/api/sessions/${encodeURIComponent(id)}/messages`,
  sessionAnswers: (id: string) => `/api/sessions/${encodeURIComponent(id)}/answers`,
  sessionNeeds: (id: string) => `/api/sessions/${encodeURIComponent(id)}/needs`,
  sessionConfirm: (id: string) => `/api/sessions/${encodeURIComponent(id)}/confirm`,
  sessionPlan: (id: string) => `/api/sessions/${encodeURIComponent(id)}/plan`,
  sessionExplore: (id: string) => `/api/sessions/${encodeURIComponent(id)}/explore`,
  sessionAction: (id: string, instanceId: string) =>
    `/api/sessions/${encodeURIComponent(id)}/instances/${encodeURIComponent(instanceId)}/actions`,
  sessionFeedback: (id: string) => `/api/sessions/${encodeURIComponent(id)}/feedback`,
  sessionMigrate: (id: string) => `/api/sessions/${encodeURIComponent(id)}/scene-migrations`,
  sessionExport: (id: string) => `/api/sessions/${encodeURIComponent(id)}/export`, // ?format=&planVersion=
  sessionResume: (id: string) => `/api/sessions/${encodeURIComponent(id)}/resume`,
  recoveryVerify: "/api/recovery/verify",
} as const;

/* ---- 错误 ---- */
export const ApiErrorCodeSchema = z.enum([
  "validation_error", // 400 请求体/参数不合法
  "not_found", // 404 任务/版本/图片不存在
  "invalid_state", // 409 当前任务状态不允许该操作
  "data_unavailable", // 503 资料来源不可用（未配置/鉴权失败/上游错误）
  "model_unavailable", // 503 模型服务不可用
  "workflow_unavailable", // 501 工作流尚未接入
  "stale_revision", // 409 写操作基于过期快照；details.snapshot 为最新快照
  "confirm_rejected", // 409 确认被拒；details.reason 机器可读，details.snapshot 为最新快照
  "needs_confirmation", // 409 没有对当前需求版本的有效确认，不能正式组装方案
  "scene_unavailable", // 409 场景版本不存在、已失效、完整性异常或配置不合法
  "storage_error", // 500 持久化读写失败
  "internal_error", // 500
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const API_ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  validation_error: 400,
  not_found: 404,
  invalid_state: 409,
  data_unavailable: 503,
  model_unavailable: 503,
  workflow_unavailable: 501,
  stale_revision: 409,
  confirm_rejected: 409,
  needs_confirmation: 409,
  scene_unavailable: 409,
  storage_error: 500,
  internal_error: 500,
};

/* ---- GET /api/health ---- */
export const HealthResponseSchema = z.object({ ok: z.literal(true), version: z.string() });

/* ---- GET /api/products/search?q= ---- */
export const ProductSearchQuerySchema = z.object({ q: z.string().min(1).max(200) });
export const ProductSearchResponseSchema = ProductSearchResultSchema;

/* ---- POST /api/tasks ---- */
export const CreateTaskRequestSchema = z.object({ input: MarketingTaskInputSchema });
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export const CreateTaskResponseSchema = z.object({ taskId: z.string(), status: TaskStatusSchema });
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;

/* ---- GET /api/tasks/:id ---- */
export const GetTaskResponseSchema = TaskSnapshotSchema;

/* ---- GET /api/tasks/:id/events?after=seq ---- */
export const GetEventsResponseSchema = z.object({
  events: z.array(ExecutionEventSchema),
  /** 下次轮询传入的 after 值。 */
  lastSeq: z.number().int().nonnegative(),
});
export type GetEventsResponse = z.infer<typeof GetEventsResponseSchema>;

/* ---- POST /api/tasks/:id/answers ---- 仅 awaiting_clarification 可用 */
export const AnswerRequestSchema = z.object({ answers: z.array(ClarificationAnswerSchema).min(1) });
export type AnswerRequest = z.infer<typeof AnswerRequestSchema>;
export const AcceptedResponseSchema = z.object({ taskId: z.string(), status: TaskStatusSchema });

/* ---- POST /api/tasks/:id/revisions ---- 仅 completed 可用，产生新版本 ---- */
export const ReviseRequestSchema = z.object({
  instruction: z.string().min(1).max(1000),
  /** 可选：同时调整任务输入（如换平台 {platform:"store_moments"}）。字段浅合并到原 input。 */
  inputPatch: z.record(z.string(), z.unknown()).optional(),
});
export type ReviseRequest = z.infer<typeof ReviseRequestSchema>;

/* ---- GET /api/tasks/:id/export?format=&version= ---- */
export const ExportFormatSchema = z.enum(["markdown", "text", "json"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export const ExportQuerySchema = z.object({
  format: ExportFormatSchema.default("markdown"),
  version: z.coerce.number().int().positive().optional(),
});
export const ExportResponseSchema = z.object({
  taskId: z.string(),
  version: z.number().int().positive(),
  format: ExportFormatSchema,
  filename: z.string(),
  content: z.string(),
  /** 导出内容含模拟数据时 true；导出文本里也会带明确标注。 */
  isMock: z.boolean(),
  deliveryStatus: ResultVersionSchema.shape.verification.shape.deliveryStatus,
});
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
