/**
 * v2 类型：场景、候选评估、个人方案、体验事件与反馈。
 * 与 types.ts 分文件只是为了便于阅读；对外统一从 index.ts 导出。
 */
import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, ProductRefSchema } from "@hwpc/contracts";
import { ReqKeySchema } from "./keys.js";

/* ------------------------------ 场景（由 C 预先编写，经目录接口提供） ------------------------------ */

export const CapabilityStatusSchema = z.enum(["supported", "unsupported", "unknown", "conflict"]);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

/** 三种证据类型必须分开标识，互相不能替代。 */
export const EvidenceModeSchema = z.enum(["functional_flow_demo", "principle_diagram", "real_device_test"]);
export type EvidenceMode = z.infer<typeof EvidenceModeSchema>;

export const SceneRoleSchema = z.object({
  roleId: IdSchema,
  label: z.string(),
  deviceClass: z.enum(["laptop", "phone", "tablet", "display", "accessory", "other"]),
  required: z.boolean(),
  /** recommended：必须由候选产品担任；existing：由用户已有设备担任；either：均可。 */
  from: z.enum(["recommended", "existing", "either"]),
});
export type SceneRole = z.infer<typeof SceneRoleSchema>;

export const SceneParamSchema = z.object({
  name: z.string(),
  type: z.enum(["enum", "number", "boolean"]),
  allowed: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]),
});

export const SceneDefinitionSchema = z.object({
  sceneId: IdSchema,
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  /** 场景涉及的技术（能力编号）。一个场景可涉及多项，一项技术可有多个场景。 */
  capabilities: z.array(z.object({ capabilityId: IdSchema, roleId: IdSchema })),
  /** 场景服务的任务标签：按用户任务选择，而不是“每项技术展示一次”。 */
  taskTags: z.array(z.string()),
  understandingQuestions: z.array(z.object({ id: IdSchema, text: z.string() })),
  roles: z.array(SceneRoleSchema),
  params: z.array(SceneParamSchema).default([]),
  evidenceMode: EvidenceModeSchema,
  /** 设备能力不明时，是否允许以“通用原理示意”展示。 */
  principleFallback: z.boolean(),
  /** 场景预先编写的可达状态与允许的操作。B 只能引用，不能新增。 */
  allowedStates: z.array(IdSchema),
  allowedActions: z.array(IdSchema),
  complexity: z.number().int().min(1).max(5),
  estimatedMinutes: z.number().positive(),
  feedbackPrompts: z.array(
    z.object({ id: IdSchema, text: z.string(), maps: z.enum(["understanding", "complexity", "missing_device", "priority", "alternative"]) }),
  ),
  /** 场景内可见的固定文案（由 C 编写）。核验时会检查。 */
  visibleTexts: z.array(z.string()).default([]),
});
export type SceneDefinition = z.infer<typeof SceneDefinitionSchema>;

/** 主 Agent 提供的场景目录接口（B 只读）。 */
export interface SceneCatalog {
  list(): Promise<SceneDefinition[]> | SceneDefinition[];
  get(sceneId: string, version?: number): Promise<SceneDefinition | undefined> | SceneDefinition | undefined;
}

/** A 的证据能力检查接口（可选注入）。 */
export interface CapabilityChecker {
  check(req: { productRef: { productId: string; configurationId?: string }; capabilityId: string; signal?: AbortSignal }): Promise<{
    status: CapabilityStatus;
    factIds: string[];
    note?: string;
  }>;
}

export const SceneBindingSchema = z.object({
  roleId: IdSchema,
  kind: z.enum(["candidate", "existing", "generic"]),
  productRef: ProductRefSchema.optional(),
  label: z.string(),
});
export type SceneBinding = z.infer<typeof SceneBindingSchema>;

export const SceneCapabilityResultSchema = z.object({
  capabilityId: IdSchema,
  roleId: IdSchema,
  status: CapabilityStatusSchema,
  factIds: z.array(IdSchema),
  note: z.string().optional(),
});

export const SceneInstanceSchema = z.object({
  instanceId: IdSchema,
  /** 场景+版本+设备绑定+参数+能力结论 的签名。签名变化即新实例，旧进度不继承。 */
  signature: z.string(),
  sceneId: IdSchema,
  sceneVersion: z.number().int().positive(),
  title: z.string(),
  order: z.number().int().nonnegative(),
  taskFocus: z.array(z.string()),
  questions: z.array(z.object({ id: IdSchema, text: z.string() })),
  bindings: z.array(SceneBindingSchema),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  capabilityResults: z.array(SceneCapabilityResultSchema),
  /** 只有全部能力 supported 才是 device_flow；否则最多是明确标识的通用原理示意，或不可用。 */
  presentation: z.enum(["device_flow", "principle_only", "unavailable"]),
  evidenceMode: EvidenceModeSchema,
  disclosures: z.array(z.string()),
  factIds: z.array(IdSchema),
  imageIds: z.array(IdSchema),
  feedbackPromptIds: z.array(IdSchema),
  reason: z.string(),
  /** 说明性探索实例没有需求版本。 */
  requirementVersion: z.number().int().positive().optional(),
  purpose: z.enum(["explore", "plan"]),
  status: z.enum(["planned", "in_progress", "task_completed_virtual", "superseded", "blocked"]),
  progress: z.object({
    operations: z.number().int().nonnegative(),
    reachedStates: z.array(IdSchema),
    virtualTaskCompleted: z.boolean(),
  }),
  supersededBy: IdSchema.optional(),
  supersededReason: z.string().optional(),
});
export type SceneInstance = z.infer<typeof SceneInstanceSchema>;

/** 事件三分：场景操作 / 虚拟任务完成 / 用户明确反馈。前两类绝不修改需求。 */
export const ExperienceEventSchema = z.object({
  eventId: IdSchema,
  at: IsoDateTimeSchema,
  instanceId: IdSchema,
  type: z.enum(["operation", "task_completed"]),
  action: z.string().optional(),
  stateId: z.string().optional(),
  accepted: z.boolean(),
  rejectReason: z.string().optional(),
});
export type ExperienceEvent = z.infer<typeof ExperienceEventSchema>;

export const FeedbackTypeSchema = z.enum(["not_understood", "too_complex", "missing_device", "priority_change", "want_alternative", "other"]);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

export const FeedbackImpactSchema = z.object({
  feedbackId: IdSchema,
  kind: z.enum(["explanation_only", "preference_refined", "scope_changed", "evidence_changed", "scene_swapped", "no_change"]),
  changedKeys: z.array(ReqKeySchema),
  scopeChanged: z.boolean(),
  actions: z.array(z.string()),
  rerank: z.boolean(),
  reRetrieve: z.boolean(),
  reConfirm: z.boolean(),
  reverify: z.array(z.string()),
  preservedInstanceIds: z.array(IdSchema),
  supersededInstanceIds: z.array(IdSchema),
  explanation: z.string(),
});
export type FeedbackImpact = z.infer<typeof FeedbackImpactSchema>;

export const FeedbackRecordSchema = z.object({
  feedbackId: IdSchema,
  at: IsoDateTimeSchema,
  type: FeedbackTypeSchema,
  instanceId: IdSchema.optional(),
  text: z.string(),
  /** 只有用户通过反馈动作提交才会产生；行为事件不会。 */
  origin: z.literal("explicit_user_feedback"),
  impact: FeedbackImpactSchema,
});
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

/* ------------------------------ 候选评估（可信推荐） ------------------------------ */

export const CriterionSchema = z.object({
  criterionId: IdSchema,
  kind: z.enum(["hard", "task", "preference", "concern", "unacceptable"]),
  sourceKey: ReqKeySchema,
  text: z.string(),
  /** 可核对的规则；解析不出来则为 opaque，结果只能是 unknown。 */
  rule: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("numeric"),
      metric: z.enum(["weight_kg", "battery_h", "display_in", "memory_gb", "storage_gb"]),
      op: z.enum(["<=", ">="]),
      value: z.number(),
    }),
    z.object({ type: z.literal("keyword"), keyword: z.string(), categories: z.array(z.string()).default([]) }),
    z.object({ type: z.literal("software"), name: z.string() }),
    z.object({ type: z.literal("opaque") }),
  ]),
  needsFromUser: z.string().optional(),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const CriterionResultSchema = z.object({
  criterionId: IdSchema,
  status: z.enum(["satisfied", "unmet", "unknown", "conflict"]),
  factIds: z.array(IdSchema),
  evidenceText: z.string().optional(),
  note: z.string(),
});
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const PlanCandidateSchema = z.object({
  key: z.string(),
  productId: IdSchema,
  configurationId: IdSchema.optional(),
  model: z.string(),
  configurationLabel: z.string().optional(),
  /**
   * 只有三类结论，不带分数、概率或“最佳”：
   * unmet_hard：有硬条件被证实不满足（其他卖点不能抵消）
   * conditional：没有硬条件被证伪，但仍有硬条件未知/冲突
   * fits_confirmed：全部硬条件均已由资料证实满足
   */
  verdict: z.enum(["unmet_hard", "conditional", "fits_confirmed"]),
  results: z.array(CriterionResultSchema),
  satisfied: z.array(z.object({ criterionId: IdSchema, text: z.string(), evidenceText: z.string().optional(), factIds: z.array(IdSchema) })),
  tradeoffs: z.array(z.object({ criterionId: IdSchema, text: z.string(), evidenceText: z.string().optional(), factIds: z.array(IdSchema) })),
  unconfirmed: z.array(z.object({ criterionId: IdSchema, text: z.string(), why: z.string() })),
  differences: z.array(z.object({ versus: z.string(), criterionId: IdSchema, meaning: z.string(), factIds: z.array(IdSchema) })),
  explanation: z.string(),
  origin: z.enum(["local", "ima", "mock"]).optional(),
  blocked: z.boolean().default(false),
  blockedReason: z.string().optional(),
});
export type PlanCandidate = z.infer<typeof PlanCandidateSchema>;

export const AssessmentSchema = z.object({
  assessmentId: IdSchema,
  requirementVersion: z.number().int().positive(),
  fingerprint: z.string(),
  criteria: z.array(CriterionSchema),
  candidates: z.array(PlanCandidateSchema),
  /** 没有任何可确认的合适候选时，如实说明。 */
  noSuitableCandidate: z.boolean(),
  noSuitableReason: z.string().optional(),
  openQuestions: z.array(z.string()),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

/* ------------------------------ 个人方案 ------------------------------ */

export const PlanVerificationSchema = z.object({
  reportId: IdSchema,
  subjectPlanId: IdSchema,
  inheritedFrom: z.null(),
  checkedAt: IsoDateTimeSchema,
  findings: z.array(
    z.object({
      findingId: IdSchema,
      target: z.enum(["candidate", "scene", "plan"]),
      targetKey: z.string(),
      code: z.string(),
      message: z.string(),
      severity: z.enum(["blocker", "major", "minor"]),
      resolution: z.enum(["passed", "blocked", "removed", "flagged"]),
    }),
  ),
  blockedCandidateKeys: z.array(z.string()),
  blockedInstanceIds: z.array(IdSchema),
  overall: z.enum(["ok", "partial", "blocked"]),
});
export type PlanVerification = z.infer<typeof PlanVerificationSchema>;

export const PersonalPlanSchema = z.object({
  planId: IdSchema,
  version: z.number().int().positive(),
  parentPlanId: IdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  requirementVersion: z.number().int().positive(),
  confirmationId: IdSchema,
  summaryId: IdSchema,
  fingerprint: z.string(),
  evidenceSnapshotId: IdSchema,
  assessmentId: IdSchema,
  candidates: z.array(PlanCandidateSchema),
  noSuitableCandidate: z.boolean(),
  noSuitableReason: z.string().optional(),
  sceneInstanceIds: z.array(IdSchema),
  scenes: z.array(SceneInstanceSchema),
  unresolved: z.array(z.string()),
  feedbackIds: z.array(IdSchema),
  changeLog: z.array(z.object({ at: IsoDateTimeSchema, reason: z.string(), changes: z.array(z.string()) })),
  verification: PlanVerificationSchema,
  status: z.enum(["current", "superseded", "stale"]),
  staleReason: z.string().optional(),
  isMock: z.boolean(),
});
export type PersonalPlan = z.infer<typeof PersonalPlanSchema>;
