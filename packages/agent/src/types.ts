/**
 * 需求顾问的可序列化状态与动作类型。
 * 这些类型是 Agent B 的内部契约；需要主 Agent 持久化/暴露的部分见 integration-notes.md。
 */
import { z } from "zod";
import {
  ArticleSchema,
  ContentStrategySchema,
  IdSchema,
  IsoDateTimeSchema,
  FactRecordSchema,
  MaterialConflictSchema,
  MaterialPackSchema,
  PlatformSchema,
  ProductRefSchema,
  VerificationReportSchema,
} from "@hwpc/contracts";

/* ------------------------------ 需求项 ------------------------------ */

export * from "./keys.js";
import { ReqKeySchema, type ReqKey } from "./keys.js";

export const DeliveryFormatSchema = z.enum(["platform_article", "interactive_html", "combo"]);
export type DeliveryFormat = z.infer<typeof DeliveryFormatSchema>;

export const SourceSchema = z.object({
  /** user：用户本人表达；system：系统推断/建议；default：系统默认值。 */
  kind: z.enum(["user", "system", "default"]),
  turn: z.number().int().nonnegative(),
  quote: z.string().optional(),
  note: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const HistoryEntrySchema = z.object({
  value: z.string(),
  refs: z.array(ProductRefSchema).optional(),
  source: SourceSchema,
  replacedAtTurn: z.number().int().nonnegative(),
  replacedAtVersion: z.number().int().positive(),
  reason: z.enum(["user_modification", "explicit_change", "conflict_resolution", "refined", "summary_edit"]),
});

export const RequirementItemSchema = z.object({
  key: ReqKeySchema,
  value: z.string().min(1),
  /** 仅 productScope：已选定的型号（可含配置）。 */
  refs: z.array(ProductRefSchema).optional(),
  /** confirmed：用户本人明确表达或明确选择；tentative：系统推断/默认；conflict：存在未解决矛盾。 */
  status: z.enum(["confirmed", "tentative", "conflict"]),
  source: SourceSchema,
  critical: z.boolean(),
  setAtVersion: z.number().int().positive(),
  alternatives: z.array(z.object({ value: z.string(), turn: z.number().int() })).optional(),
  history: z.array(HistoryEntrySchema).default([]),
});
export type RequirementItem = z.infer<typeof RequirementItemSchema>;

export const ConflictSchema = z.object({
  conflictId: IdSchema,
  kind: z.enum(["value_clash", "cross_field"]),
  keys: z.array(ReqKeySchema).min(1),
  /** cross_field 的规则编号。 */
  ruleId: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string(), turn: z.number().int().optional() })).min(2),
  description: z.string(),
  status: z.enum(["open", "resolved"]),
  openedTurn: z.number().int(),
  resolvedTurn: z.number().int().optional(),
  resolution: z.string().optional(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

/* ------------------------------ 问题 ------------------------------ */

export const QuestionSchema = z.object({
  questionId: IdSchema,
  kind: z.enum(["preference", "clarify_conflict", "choose_candidate", "choose_config", "gap_handling", "quantify"]),
  /** 谁来回答：preference 类只能问用户；产品事实类不会出现在这里（由数据服务回答）。 */
  owner: z.literal("user"),
  targetKeys: z.array(ReqKeySchema).min(1),
  prompt: z.string().min(1),
  /** 提问原因（面向用户可读）。 */
  reason: z.string().min(1),
  /** 什么条件下视为已解决。 */
  resolveWhen: z.string().min(1),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1), hint: z.string().optional() })).optional(),
  allowFreeText: z.literal(true).default(true),
  status: z.enum(["open", "answered", "superseded"]),
  askedTurn: z.number().int(),
  answeredTurn: z.number().int().optional(),
  answer: z.string().optional(),
  priority: z.number(),
  /** 该问题会影响什么：候选筛选 / 推荐取舍 / 场景安排 / 未解决的顾虑。 */
  affects: z.array(z.enum(["candidates", "tradeoffs", "scenes", "concerns", "output"])).default([]),
  /** false：不阻塞形成摘要（细化类问题），用户可以直接看方案。 */
  blocking: z.boolean().default(true),
  /** 面向用户的一句话：答案会怎样改变结果。 */
  impactNote: z.string().optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

/* ------------------------------ 候选与证据 ------------------------------ */

export const CandidateSchema = z.object({
  productId: IdSchema,
  model: z.string(),
  family: z.string(),
  configurations: z.array(z.object({ configurationId: IdSchema, label: z.string(), attributes: z.record(z.string(), z.string()).default({}) })),
  status: z.enum(["open", "chosen", "rejected"]),
  via: z.enum(["mention", "category_search"]),
  /** 候选亮点：每条都带事实编号与资料原值，不做改写。 */
  highlights: z.array(z.object({ factId: IdSchema, category: z.string(), field: z.string(), value: z.string() })).default([]),
  evidenceLoaded: z.boolean().default(false),
  /** 资料层返回“需选配置才能确定事实”。 */
  configRequired: z.boolean().default(false),
  /** 资料层返回的完整事实（用于逐条评估硬条件）。原值不改写。 */
  facts: z.array(FactRecordSchema).default([]),
  conflicts: z.array(MaterialConflictSchema).default([]),
  gaps: z.array(z.string()).default([]),
  origin: z.enum(["local", "ima", "mock"]).optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const EvidenceSnapshotSchema = z.object({
  snapshotId: IdSchema,
  takenAt: IsoDateTimeSchema,
  requirementVersion: z.number().int().positive(),
  fingerprint: z.string(),
  productRefs: z.array(ProductRefSchema),
  hints: z.object({ scenario: z.string().optional(), platform: z.string().optional() }),
  pack: MaterialPackSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  purpose: z.enum(["summary", "pre_generation"]),
});
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;

/* ------------------------------ 摘要与确认 ------------------------------ */

export const SelectedFactSchema = z.object({ factId: IdSchema, field: z.string(), value: z.string(), reason: z.string() });
export const ContentDirectionSchema = z.object({
  angle: z.string(),
  selected: z.array(SelectedFactSchema),
  excluded: z.array(z.object({ factId: IdSchema, reason: z.string() })),
});
export type ContentDirection = z.infer<typeof ContentDirectionSchema>;

export const ChangeImpactSchema = z.object({
  changedKeys: z.array(ReqKeySchema),
  critical: z.boolean(),
  effects: z.array(z.object({ key: ReqKeySchema, effect: z.string() })),
  invalidatedConfirmationIds: z.array(IdSchema),
  staleArtifactIds: z.array(IdSchema),
  needsReRetrieval: z.boolean(),
  needsReConfirmation: z.boolean(),
  needsReVerification: z.boolean(),
});
export type ChangeImpact = z.infer<typeof ChangeImpactSchema>;

export const SummarySchema = z.object({
  summaryId: IdSchema,
  requirementVersion: z.number().int().positive(),
  /** 摘要指纹 = hash(需求指纹, 内容方向, 采用的默认值)。确认绑定它。 */
  fingerprint: z.string(),
  /** 需求项指纹（不含内容方向）。 */
  requirementFingerprint: z.string(),
  directionFingerprint: z.string(),
  createdAt: IsoDateTimeSchema,
  status: z.enum(["pending", "confirmed", "superseded"]),
  /** 是否可以被确认（存在阻止项时只能继续沟通）。 */
  confirmable: z.boolean(),
  blockers: z.array(z.string()),
  /** 有序小节。选购摘要与营销摘要各自生成不同的小节。 */
  sections: z.array(z.object({ key: z.string(), label: z.string(), text: z.string() })),
  mode: z.enum(["shopping", "marketing"]).default("shopping"),
  /** 采用了默认值或系统推断、需要用户留意的条目。 */
  assumptions: z.array(z.string()),
  evidenceDigest: z.array(z.string()),
  evidenceGaps: z.array(z.string()),
  contentDirection: ContentDirectionSchema.optional(),
  /** 选购摘要：确认时的候选评估指纹与结论。 */
  planBasis: z.object({ assessmentFingerprint: z.string(), candidates: z.array(z.object({ key: z.string(), model: z.string(), verdict: z.string() })) }).optional(),
  changeNote: z.string().optional(),
  impact: ChangeImpactSchema.optional(),
  /** 面向用户的摘要正文。不含作品文案。 */
  text: z.string(),
});
export type Summary = z.infer<typeof SummarySchema>;

export const ConfirmationSchema = z.object({
  confirmationId: IdSchema,
  requirementVersion: z.number().int().positive(),
  fingerprint: z.string(),
  requirementFingerprint: z.string(),
  summaryId: IdSchema,
  confirmedAt: IsoDateTimeSchema,
  /** 只有 confirm() 动作能写入，模型输出无法产生该记录。 */
  actor: z.literal("user"),
  channel: z.literal("confirm_action"),
  status: z.enum(["valid", "invalidated"]),
  invalidatedAt: IsoDateTimeSchema.optional(),
  invalidatedReason: z.string().optional(),
});
export type Confirmation = z.infer<typeof ConfirmationSchema>;

/* ------------------------------ 互动方案 ------------------------------ */

const SafeText = z
  .string()
  .min(1)
  .max(400)
  .refine((s) => !/[<>]|javascript:|\bon\w+\s*=|https?:\/\/|\bscript\b|\beval\b/i.test(s), "互动文本不得含标签、脚本或链接");

export const InteractionSchema = z.object({
  interactionId: IdSchema,
  kind: z.enum(["select_option", "reveal_detail", "toggle_compare", "step_through"]),
  label: SafeText,
  prompt: SafeText,
  /** 服务哪些已确认的需求项。 */
  servesRequirementKeys: z.array(ReqKeySchema).min(1),
  /** 使用哪些已核验事实。 */
  factIds: z.array(IdSchema).min(1),
  allowedActions: z.array(z.enum(["select", "expand", "collapse", "compare"])).min(1),
  options: z
    .array(z.object({ optionId: IdSchema, label: SafeText, reveal: z.object({ text: SafeText, factIds: z.array(IdSchema).min(1) }) }))
    .min(2)
    .max(6),
  /**
   * 分层：场景内操作只改变场景状态（不改需求、不改证据）；
   * 用户在互动之后给出的明确反馈才可以进入需求/方案更新流程。
   */
  effects: z.object({
    operationScope: z.literal("scene_state_only"),
    operationsMutateRequirements: z.literal(false),
    operationsMutateEvidence: z.literal(false),
    explicitFeedbackMayUpdate: z.boolean(),
  }),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export const InteractionPlanSchema = z.object({
  planId: IdSchema,
  requirementVersion: z.number().int().positive(),
  fingerprint: z.string(),
  platform: PlatformSchema,
  deliveryFormat: DeliveryFormatSchema,
  /** HTML 只是补充，平台图文必须同时存在。 */
  /** 仅 combo 交付形式要求同时有平台图文；纯互动交付不再强制。 */
  requiresPlatformArticle: z.boolean(),
  interactions: z.array(InteractionSchema).max(3),
  verified: z.boolean(),
  verificationNotes: z.array(z.string()),
});
export type InteractionPlan = z.infer<typeof InteractionPlanSchema>;

/* ------------------------------ 作品版本 ------------------------------ */

export const ArtifactSchema = z.object({
  artifactId: IdSchema,
  version: z.number().int().positive(),
  parentArtifactId: IdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  kind: z.enum(["initial", "regeneration", "revision"]),
  reason: z.string(),
  requirementVersion: z.number().int().positive(),
  fingerprint: z.string(),
  confirmationId: IdSchema,
  evidenceSnapshotId: IdSchema,
  verificationReportId: IdSchema,
  /** 每份核验报告只对一个作品版本有效，不继承。 */
  reportMeta: z.object({ reportId: IdSchema, subjectArtifactId: IdSchema, inheritedFrom: z.null(), checkedAt: IsoDateTimeSchema }),
  status: z.enum(["current", "superseded", "stale"]),
  staleReason: z.string().optional(),
  result: z.object({
    strategy: ContentStrategySchema,
    article: ArticleSchema,
    verification: VerificationReportSchema,
    materialPack: MaterialPackSchema,
    isMock: z.boolean(),
  }),
  selection: ContentDirectionSchema,
  interactionPlan: InteractionPlanSchema.optional(),
  generationMode: z.enum(["model", "template_fallback"]),
  /** 生成该作品的模型响应是否为模拟（simulated=true）。为 true 时不得称为真实生成效果。 */
  modelSimulated: z.boolean(),
  repairRounds: z.number().int().nonnegative(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

/* ------------------------------ 动作与门控 ------------------------------ */

export const NextActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ask_user"), questionIds: z.array(IdSchema).min(1).max(3) }),
  z.object({ type: z.literal("query_data"), purpose: z.enum(["search_by_mention", "search_candidates", "load_candidate_evidence", "load_evidence", "answer_fact_question"]), detail: z.string() }),
  z.object({ type: z.literal("await_confirmation"), summaryId: IdSchema, fingerprint: z.string(), requirementVersion: z.number().int() }),
  z.object({ type: z.literal("discuss_evidence_gap"), gaps: z.array(z.string()), paths: z.array(z.string()) }),
  z.object({ type: z.literal("resolve_material_conflict"), conflictIds: z.array(IdSchema), paths: z.array(z.string()) }),
  z.object({ type: z.literal("generate"), fingerprint: z.string(), requirementVersion: z.number().int() }),
  z.object({ type: z.literal("deliver"), artifactId: IdSchema }),
  z.object({ type: z.literal("discuss"), note: z.string() }),
  z.object({ type: z.literal("blocked"), reason: z.string() }),
]);
export type NextAction = z.infer<typeof NextActionSchema>;

export const GateCheckSchema = z.object({ id: z.string(), ok: z.boolean(), detail: z.string() });
export const GateResultSchema = z.object({
  allowed: z.boolean(),
  checks: z.array(GateCheckSchema),
  /** 失败的检查编号。 */
  failed: z.array(z.string()),
  returnTo: z.enum(["none", "collecting", "awaiting_confirmation", "discuss_evidence_gap", "resolve_material_conflict"]),
});
export type GateResult = z.infer<typeof GateResultSchema>;

import {
  AssessmentSchema,
  ExperienceEventSchema,
  FeedbackRecordSchema,
  PersonalPlanSchema,
  SceneInstanceSchema,
} from "./types2.js";
export * from "./types2.js";

/* ------------------------------ 对话状态 ------------------------------ */

export const StageSchema = z.enum(["collecting", "awaiting_confirmation", "confirmed", "generating", "delivered", "blocked"]);
export type Stage = z.infer<typeof StageSchema>;

export const TurnSchema = z.object({
  turn: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant", "system"]),
  kind: z.enum(["message", "confirm", "summary_edit", "revision", "event"]).default("message"),
  text: z.string(),
  at: IsoDateTimeSchema,
});
export type Turn = z.infer<typeof TurnSchema>;

export const AuditEntrySchema = z.object({
  seq: z.number().int().positive(),
  at: IsoDateTimeSchema,
  type: z.enum(["model_call", "model_call_refused", "forged_confirmation_ignored", "confirm_rejected", "gate", "data_call", "chat_confirm_ignored", "user_confirmed", "behavior_ignored", "scene_rejected", "feedback"]),
  purpose: z.string().optional(),
  detail: z.string().optional(),
  requirementVersion: z.number().int().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const ConversationStateSchema = z.object({
  schema: z.enum(["hwpc.consultant.v1", "hwpc.consultant.v2"]),
  taskId: IdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  stage: StageSchema,
  blockedReason: z.string().optional(),
  turns: z.array(TurnSchema),
  requirementVersion: z.number().int().positive(),
  currentFingerprint: z.string(),
  items: z.record(z.string(), RequirementItemSchema),
  conflicts: z.array(ConflictSchema),
  questions: z.array(QuestionSchema),
  candidates: z.array(CandidateSchema),
  /** 用户提到、尚未解析为型号的产品文字。 */
  productMentions: z.array(z.string()),
  searchLog: z.array(z.object({ query: z.string(), resultProductIds: z.array(IdSchema), ambiguous: z.boolean(), at: IsoDateTimeSchema, error: z.string().optional() })),
  /** 用户口头给出、没有知识库依据的数值/价格。永远不当作事实。 */
  userClaims: z.array(z.object({ turn: z.number().int(), kind: z.enum(["price", "spec"]), text: z.string(), status: z.literal("unverified") })),
  factQnA: z.array(z.object({ turn: z.number().int(), text: z.string(), factIds: z.array(IdSchema), status: z.enum(["answered", "gap"]) })),
  requirementSnapshots: z.array(z.object({ version: z.number().int().positive(), fingerprint: z.string(), at: IsoDateTimeSchema, items: z.record(z.string(), RequirementItemSchema) })),
  evidence: z.array(EvidenceSnapshotSchema),
  summaries: z.array(SummarySchema),
  confirmations: z.array(ConfirmationSchema),
  artifacts: z.array(ArtifactSchema),
  /** v2：选购方案相关（v1 状态恢复时缺省为空）。 */
  assessments: z.array(AssessmentSchema).default([]),
  plans: z.array(PersonalPlanSchema).default([]),
  sceneInstances: z.array(SceneInstanceSchema).default([]),
  experienceEvents: z.array(ExperienceEventSchema).default([]),
  feedback: z.array(FeedbackRecordSchema).default([]),
  /** 行为只能触发追问建议，不会写入需求。 */
  behaviorSuggestions: z.array(z.object({ suggestionId: IdSchema, at: IsoDateTimeSchema, instanceId: IdSchema, suggestion: z.string(), consumed: z.boolean() })).default([]),
  /** 说明性探索记录：不是个性化推荐。 */
  explorations: z.array(z.object({ explorationId: IdSchema, at: IsoDateTimeSchema, sceneId: IdSchema, sceneVersion: z.number().int(), label: z.string(), instanceId: IdSchema })).default([]),
  impactLog: z.array(ChangeImpactSchema.extend({ at: IsoDateTimeSchema, fromVersion: z.number().int(), toVersion: z.number().int() })),
  /** 用户对资料缺口/冲突的处理决定（如：删去价格承诺、不采用冲突参数）。 */
  decisions: z.array(z.object({ decisionId: IdSchema, gapId: z.string(), decision: z.string(), turn: z.number().int() })),
  nextAction: NextActionSchema,
  lastGate: GateResultSchema.optional(),
  audit: z.array(AuditEntrySchema),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;
