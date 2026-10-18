import { z } from "zod";
import { DataOriginSchema, IsoDateTimeSchema } from "./common.js";
import type { MaterialPack } from "./material.js";
import type { ImageRecord } from "./material.js";
import type { ProductRef, ProductSearchResult } from "./product.js";
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  MarketingTaskInput,
} from "./task.js";
import type { ResultVersion, WorkflowCheckpoint, WorkflowEventInput } from "./run.js";

/* ------------------------------------------------------------------ */
/* 连接状态                                                            */
/* ------------------------------------------------------------------ */

export const ConnectionStateSchema = z.enum([
  "connected", // 已实际验证可用
  "not_configured", // 缺少凭证/路径
  "error", // 已配置但调用失败
  "unverified", // 已配置，尚未做过真实调用
]);
export type ConnectionState = z.infer<typeof ConnectionStateSchema>;

/** 账号信息。密钥一律脱敏：只给前 4 位 + 长度，不返回完整值。 */
export const AccountInfoSchema = z.object({
  clientIdMasked: z.string(),
  /** ima 返回的账号昵称等，字段是否存在以实测为准，故全部可选。 */
  displayName: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
});
export type AccountInfo = z.infer<typeof AccountInfoSchema>;

export const KnowledgeBaseInfoSchema = z.object({
  /** 只展示名称；kb_id 仅服务端内部使用，不进入契约。 */
  name: z.string(),
  found: z.boolean(),
  itemCount: z.number().int().nonnegative().optional(),
});

export const SourceStatusSchema = z.object({
  origin: DataOriginSchema,
  state: ConnectionStateSchema,
  enabled: z.boolean(),
  /** 给人看的状态说明，如“未设置 IMA_OPENAPI_CLIENTID”。 */
  message: z.string(),
  account: AccountInfoSchema.optional(),
  knowledgeBase: KnowledgeBaseInfoSchema.optional(),
  /** local：本地资料根目录是否可读；以及统计。 */
  local: z.object({ rootConfigured: z.boolean(), productCount: z.number().int().nonnegative().optional() }).optional(),
  lastCheckedAt: IsoDateTimeSchema.optional(),
});
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const ModelStatusSchema = z.object({
  state: ConnectionStateSchema,
  provider: z.enum(["openai_compatible", "mock"]),
  modelName: z.string().optional(),
  message: z.string(),
  lastCheckedAt: IsoDateTimeSchema.optional(),
});
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ConnectionStatusSchema = z.object({
  /** 当前实际用于任务的资料来源（由 DATA_SOURCE_MODE 与可用性决定）。 */
  activeDataOrigin: DataOriginSchema,
  sources: z.array(SourceStatusSchema),
  model: ModelStatusSchema,
  /** 任意环节为 mock 时 true，界面需常驻提示。 */
  mockInUse: z.boolean(),
  serverTime: IsoDateTimeSchema,
});
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/* ------------------------------------------------------------------ */
/* 资料层接口（Agent A 实现）                                           */
/* ------------------------------------------------------------------ */

export interface ImageContent {
  mimeType: string;
  bytes: Uint8Array;
}

export interface MaterialRequest {
  taskId: string;
  product: ProductRef;
  /** 任务上下文，用于选择与排序，不用于改变事实。 */
  scenarioHint?: string;
  platformHint?: string;
  /** 需要的图片数量上限。 */
  maxImages?: number;
  signal?: AbortSignal;
}

/**
 * 资料层：隔离 local / ima / mock 三类来源。
 * 约定：
 * - 方法在资料不可用时抛出 DataServiceError，不得返回编造内容。
 * - 返回的每条事实/图片都必须带真实 SourceRef；mock 实现必须 origin="mock"。
 * - 凭证只读环境变量，不进入任何返回值。
 */
export interface DataService {
  /** 每次调用做真实检查（可带短缓存），并返回各来源状态。 */
  getStatus(signal?: AbortSignal): Promise<SourceStatus[]>;
  /** 搜索产品；命中多型号或需选配置时 ambiguous=true 并给出 disambiguation。 */
  searchProducts(query: string, signal?: AbortSignal): Promise<ProductSearchResult>;
  /** 按任务取资料包。product 必须明确到型号；配置不明且影响事实时应在包内保留各配置事实及 qualifiers。 */
  getMaterialPack(request: MaterialRequest): Promise<MaterialPack>;
  /** 读取图片内容，供服务端 /api/images/:imageId 代理。 */
  readImage(image: ImageRecord, signal?: AbortSignal): Promise<ImageContent>;
}

export const DataErrorCodeSchema = z.enum([
  "not_configured",
  "unauthorized",
  "kb_not_found",
  "not_found",
  "upstream_error",
  "timeout",
  "invalid_data",
]);
export type DataErrorCode = z.infer<typeof DataErrorCodeSchema>;

export class DataServiceError extends Error {
  constructor(
    public readonly code: DataErrorCode,
    message: string,
    public readonly origin?: z.infer<typeof DataOriginSchema>,
  ) {
    super(message);
    this.name = "DataServiceError";
  }
}

/* ------------------------------------------------------------------ */
/* 模型服务（服务端实现，注入工作流）                                    */
/* ------------------------------------------------------------------ */

export const ChatMessageSchema = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string() });
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export interface ModelRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** true 时要求模型输出单个 JSON 对象；调用方自行用 zod 校验。 */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  /** mock 模型必须为 true。 */
  simulated: boolean;
}

export interface ModelService {
  getStatus(signal?: AbortSignal): Promise<z.infer<typeof ModelStatusSchema>>;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelServiceError extends Error {
  constructor(
    public readonly code: "not_configured" | "unauthorized" | "upstream_error" | "timeout" | "bad_output",
    message: string,
  ) {
    super(message);
    this.name = "ModelServiceError";
  }
}

/* ------------------------------------------------------------------ */
/* 工作流接口（Agent B 实现）                                           */
/* ------------------------------------------------------------------ */

export interface WorkflowDeps {
  data: DataService;
  model: ModelService;
  /** 注入时钟便于测试。 */
  now?: () => Date;
}

/** 工作流只通过该回调报告真实发生的事件；服务端补全 seq/taskId/时间。 */
export type EventSink = (event: WorkflowEventInput) => void;

export interface WorkflowContext {
  taskId: string;
  emit: EventSink;
  signal?: AbortSignal;
}

/** 工作流单次调用的结果：要么需要澄清，要么给出新版本。 */
export type WorkflowOutcome =
  | { kind: "needs_clarification"; questions: ClarificationQuestion[]; checkpoint: WorkflowCheckpoint }
  | { kind: "completed"; result: Omit<ResultVersion, "version" | "createdAt" | "reason" | "instruction"> };

export interface MarketingWorkflow {
  /** 执行新任务。信息不足/型号歧义/资料冲突时返回 needs_clarification。 */
  run(input: MarketingTaskInput, ctx: WorkflowContext): Promise<WorkflowOutcome>;
  /** 带着用户回答恢复。仍有缺口可再次返回 needs_clarification。 */
  resume(checkpoint: WorkflowCheckpoint, answers: ClarificationAnswer[], ctx: WorkflowContext): Promise<WorkflowOutcome>;
  /** 基于上一版本和修改要求生成新版本（换渠道、删减、替换卖点等）。可返回澄清。 */
  revise(
    previous: ResultVersion,
    input: MarketingTaskInput,
    instruction: string,
    ctx: WorkflowContext,
  ): Promise<WorkflowOutcome>;
}

export type CreateWorkflow = (deps: WorkflowDeps) => MarketingWorkflow;
