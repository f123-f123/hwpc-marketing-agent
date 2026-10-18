import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { CandidateAssessmentSchema } from "./candidates.js";
import { CapabilityReportSchema } from "./capabilities.js";
import { ExperienceRecordSchema, FeedbackKindSchema, FeedbackRecordSchema, ImpactRecordSchema } from "./experience.js";
import { NeedConfirmationSchema, NeedEntrySchema, NeedKeySchema, NeedSummarySchema, NeedVersionRecordSchema } from "./needs.js";
import { NeedEditSchema, QuestionProposalSchema } from "./advisor.js";
import { PersonalPlanSchema } from "./plan.js";
import { SceneCatalogItemSchema, SceneDefinitionSchema, SceneIdSchema, SceneInstanceSchema, SceneVersionSchema } from "./scenes.js";

/* ------------------------------ 持久化记录 ------------------------------ */

export const SessionQuestionSchema = QuestionProposalSchema.extend({
  questionId: IdSchema,
  status: z.enum(["open", "answered", "superseded"]),
  askedAtNeedVersion: z.number().int().positive(),
  askedAt: IsoDateTimeSchema,
  answer: z.string().optional(),
  answeredAt: IsoDateTimeSchema.optional(),
});
export type SessionQuestion = z.infer<typeof SessionQuestionSchema>;

export const SessionMessageSchema = z.object({
  messageId: IdSchema,
  role: z.enum(["user", "advisor", "system"]),
  text: z.string(),
  at: IsoDateTimeSchema,
  needVersion: z.number().int().positive(),
  /** 顾问建议“看看”的已注册场景（说明性浏览，不是个性化推荐）。已由服务端校验存在且可用。 */
  suggestedScenes: z.array(z.object({ sceneId: SceneIdSchema, version: SceneVersionSchema, reason: z.string() })).optional(),
});
export type SessionMessage = z.infer<typeof SessionMessageSchema>;

/**
 * 会话持久化记录。运行状态、需求确认、场景进度是互相独立的三条轴：
 * - 运行：runState（引擎是否出错）。
 * - 需求：needVersions + confirmations（可反复回到沟通，旧确认会作废）。
 * - 场景：instances + experiences（逐实例进度，不影响需求状态）。
 */
export const SessionRecordSchema = z.object({
  schema: z.literal("hwpc.session.v1"),
  sessionId: IdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** 每次写入 +1；写操作带 baseRevision 以发现过期窗口。 */
  revision: z.number().int().nonnegative(),
  usedMock: z.object({ engine: z.boolean(), knowledge: z.boolean(), data: z.boolean() }),
  messages: z.array(SessionMessageSchema),
  needVersions: z.array(NeedVersionRecordSchema).min(1),
  confirmations: z.array(NeedConfirmationSchema),
  questions: z.array(SessionQuestionSchema),
  candidates: z.array(CandidateAssessmentSchema),
  /** 用户明确否决的产品；之后不能被推荐为首选。 */
  rejectedProductIds: z.array(IdSchema),
  excludedScenes: z.array(z.object({ sceneId: SceneIdSchema, feedbackId: IdSchema, at: IsoDateTimeSchema })),
  /** 首次使用时冻结的场景定义副本，键为 sceneId@version。注册表后续变化不会影响已保存方案。 */
  sceneDefinitions: z.record(z.string(), SceneDefinitionSchema),
  instances: z.array(SceneInstanceSchema),
  experiences: z.array(ExperienceRecordSchema),
  plans: z.array(PersonalPlanSchema),
  /** 最近一次组装方案时被拒绝的场景（不满足条件），供用户理解。 */
  planNotes: z.array(z.object({ at: IsoDateTimeSchema, text: z.string() })),
  feedback: z.array(FeedbackRecordSchema),
  impacts: z.array(ImpactRecordSchema),
  runState: z.object({ state: z.enum(["idle", "failed"]), at: IsoDateTimeSchema, error: z.object({ code: z.string(), message: z.string() }).optional() }),
  audit: z.array(z.object({ at: IsoDateTimeSchema, type: z.string(), detail: z.string().optional() })),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const sceneKey = (sceneId: string, version: number) => `${sceneId}@${version}`;

/* ------------------------------ 对外快照 ------------------------------ */

export const NeedsStatusSchema = z.enum(["collecting", "awaiting_confirmation", "confirmed", "changed_since_confirmation"]);
export type NeedsStatus = z.infer<typeof NeedsStatusSchema>;

export const InstanceViewSchema = z.object({
  instance: SceneInstanceSchema,
  title: z.string(),
  summary: z.string(),
  knowledgeScope: z.enum(["pc_knowledge_base", "outside_pc_knowledge_base"]),
  competitionEligible: z.boolean(),
  /** 冻结的定义（渲染器据此运行状态机）。 */
  definition: SceneDefinitionSchema,
  experience: ExperienceRecordSchema,
  /** 该场景版本已被注册表标记失效。 */
  invalidation: z.object({ reason: z.string(), replacedByVersion: SceneVersionSchema.optional() }).optional(),
  /** 注册表中同一 id@version 的内容与冻结副本不一致。 */
  registryDrift: z.boolean(),
  /** 注册表中更新的可用版本（仅提示，不自动迁移）。 */
  newerVersion: SceneVersionSchema.optional(),
  /** 展示给用户的限定语。 */
  caveats: z.array(z.string()),
});
export type InstanceView = z.infer<typeof InstanceViewSchema>;

export const SessionSnapshotSchema = z.object({
  sessionId: IdSchema,
  revision: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  run: z.object({ state: z.enum(["idle", "working", "failed"]), error: z.object({ code: z.string(), message: z.string() }).optional() }),
  needs: z.object({
    version: z.number().int().positive(),
    status: NeedsStatusSchema,
    entries: z.array(NeedEntrySchema),
    summary: NeedSummarySchema,
    confirmation: NeedConfirmationSchema.optional(),
    invalidatedConfirmations: z.array(NeedConfirmationSchema),
  }),
  conversation: z.object({
    messages: z.array(SessionMessageSchema),
    openQuestions: z.array(SessionQuestionSchema),
    resolvedQuestions: z.array(SessionQuestionSchema),
  }),
  candidates: z.object({
    assessments: z.array(CandidateAssessmentSchema),
    /** 评价基于的需求版本落后于当前版本时为 true，界面不得当作当前推荐展示。 */
    stale: z.boolean(),
    rejectedProductIds: z.array(IdSchema),
  }),
  plan: z.object({
    current: PersonalPlanSchema.optional(),
    versions: z.array(z.object({ version: z.number().int().positive(), status: z.enum(["current", "superseded", "stale"]), needVersion: z.number().int().positive(), createdAt: IsoDateTimeSchema })),
    canCompose: z.boolean(),
    cannotComposeReason: z.string().optional(),
    notes: z.array(z.object({ at: IsoDateTimeSchema, text: z.string() })),
  }),
  scenes: z.object({
    instances: z.array(InstanceViewSchema),
    /** 可供“说明性浏览”的场景目录（元数据）。 */
    catalog: z.array(SceneCatalogItemSchema),
  }),
  feedback: z.array(FeedbackRecordSchema),
  impacts: z.array(ImpactRecordSchema),
  capabilities: CapabilityReportSchema,
  components: z.object({
    engine: z.object({ isMock: z.boolean() }),
    knowledge: z.object({ isMock: z.boolean() }),
    dataOrigin: z.enum(["local", "ima", "mock"]),
  }),
  /** 会话涉及任何模拟组件或模拟场景时为 true；界面必须常驻提示。 */
  isMock: z.boolean(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

/* ------------------------------ 请求与响应 ------------------------------ */

export const CreateSessionRequestSchema = z.object({ text: z.string().min(1).max(2000) });
export const MessageRequestSchema = z.object({ text: z.string().min(1).max(2000), baseRevision: z.number().int().nonnegative() });
export const AnswersRequestSchema = z
  .object({
    answers: z.array(z.object({ questionId: IdSchema, answer: z.string().min(1).max(1000) })).default([]),
    /** 一段话同时回答多个问题，由引擎解释。 */
    freeText: z.string().min(1).max(2000).optional(),
    baseRevision: z.number().int().nonnegative(),
  })
  .refine((v) => v.answers.length > 0 || v.freeText, { message: "answers 与 freeText 至少提供一个" });
export const NeedEditRequestSchema = z.object({ edits: z.array(NeedEditSchema).min(1).max(20), baseRevision: z.number().int().nonnegative() });
export const ConfirmRequestSchema = z.object({
  needVersion: z.number().int().positive(),
  fingerprint: z.string().min(1),
  baseRevision: z.number().int().nonnegative().optional(),
});
export const ComposePlanRequestSchema = z.object({ baseRevision: z.number().int().nonnegative() });
export const ExploreRequestSchema = z.object({
  sceneId: SceneIdSchema,
  version: SceneVersionSchema.optional(),
  baseRevision: z.number().int().nonnegative().optional(),
});
export const SceneActionRequestSchema = z.object({ actionId: z.string().min(1), baseRevision: z.number().int().nonnegative().optional() });
export const FeedbackRequestSchema = z.object({
  kind: FeedbackKindSchema,
  text: z.string().min(1).max(1000),
  instanceId: IdSchema.optional(),
  /** confirm_condition 时必填：用户声明满足的使用条件。 */
  conditionKey: z.string().optional(),
  productId: IdSchema.optional(),
  needKey: NeedKeySchema.optional(),
  /** change_need 时指向被修改的条目。 */
  entryId: IdSchema.optional(),
  baseRevision: z.number().int().nonnegative(),
});
export const MigrateSceneRequestSchema = z.object({ instanceId: IdSchema, toVersion: SceneVersionSchema, baseRevision: z.number().int().nonnegative() });

export const ConfirmRejectReasonSchema = z.enum(["stale_summary", "blocked", "no_content"]);
export type ConfirmRejectReason = z.infer<typeof ConfirmRejectReasonSchema>;

export const ConfirmResponseSchema = z.object({ duplicate: z.boolean(), snapshot: SessionSnapshotSchema });
export const SessionListItemSchema = z.object({
  sessionId: IdSchema,
  updatedAt: IsoDateTimeSchema,
  needVersion: z.number().int().positive(),
  needsStatus: NeedsStatusSchema,
  planVersion: z.number().int().positive().optional(),
  firstUserMessage: z.string().optional(),
  isMock: z.boolean(),
});
export const SessionListResponseSchema = z.object({ sessions: z.array(SessionListItemSchema), unreadable: z.array(z.object({ sessionId: z.string(), reason: z.string() })) });

export const SESSION_EXPORT_FORMATS = ["recovery_json", "recovery_html"] as const;
export const SessionExportQuerySchema = z.object({ format: z.enum(SESSION_EXPORT_FORMATS).default("recovery_html"), planVersion: z.coerce.number().int().positive().optional() });
