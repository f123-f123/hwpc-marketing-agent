import { z } from "zod";
import { IdSchema } from "./common.js";
import { CandidateAssessmentSchema } from "./candidates.js";
import type { DataService, ModelService } from "./services.js";
import { NeedKeySchema, NeedStatusSchema, type NeedEntry, type NeedSummary } from "./needs.js";
import { ProductRefSchema } from "./product.js";
import { SceneIdSchema, SceneParamValueSchema, SceneVersionSchema, type SceneCatalog, type SceneCatalogItem } from "./scenes.js";
import type { DeviceKnowledgeService } from "./devices.js";
import type { FeedbackKind } from "./experience.js";

/* ------------------------------ 需求编辑（引擎提议 / 用户直接编辑） ------------------------------ */

export const NeedEditSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    key: NeedKeySchema,
    value: z.string().min(1).max(500),
    structured: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** 提议的状态。known 必须带 quote 且 quote 必须出自用户本轮原话，否则服务端降级为 inferred。 */
    status: NeedStatusSchema,
    quote: z.string().max(500).optional(),
    note: z.string().max(300).optional(),
    /** 替换已有条目（保留历史）；缺省时单值键替换同键条目，多值键新增。 */
    entryId: IdSchema.optional(),
  }),
  z.object({ op: z.literal("remove"), entryId: IdSchema, note: z.string().max(300).optional() }),
]);
export type NeedEdit = z.infer<typeof NeedEditSchema>;

/* ------------------------------ 问题提议 ------------------------------ */

export const QuestionProposalSchema = z.object({
  kind: z.enum(["preference", "clarify", "choose_candidate", "choose_config", "gap"]),
  prompt: z.string().min(1).max(300),
  /** 为什么问（面向用户）。 */
  reason: z.string().min(1).max(300),
  targetKeys: z.array(NeedKeySchema).min(1),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).max(6).optional(),
  allowFreeText: z.boolean().default(true),
});
export type QuestionProposal = z.infer<typeof QuestionProposalSchema>;

/** 一轮最多追问数。更多的问题会被服务端截断。 */
export const MAX_OPEN_QUESTIONS = 3;

/* ------------------------------ 引擎输入输出（B 实现） ------------------------------ */

/** 引擎看到的只读会话视图，不含他人隐私以外的内容；引擎不能直接写会话。 */
export interface AdvisorView {
  sessionId: string;
  needVersion: number;
  entries: NeedEntry[];
  summary: NeedSummary;
  /** 最近若干条对话（时间正序）。 */
  recentMessages: { role: "user" | "advisor"; text: string }[];
  openQuestions: { questionId: string; prompt: string; targetKeys: string[] }[];
  candidates: z.infer<typeof CandidateAssessmentSchema>[];
  /** 用户明确否决的产品，不得再作为首选推荐。 */
  rejectedProductIds: string[];
  /** 用户明确不想要的场景。 */
  excludedSceneIds: string[];
  confirmed: boolean;
}

export interface AdvisorDeps {
  data: DataService;
  model: ModelService;
  catalog: SceneCatalog;
  knowledge: DeviceKnowledgeService;
  emit: (e: { type: string; message: string; detail?: Record<string, unknown>; simulated?: boolean }) => void;
  signal?: AbortSignal;
}

export const AdvisorProposalSchema = z.object({
  /** 给用户的话。不得包含“已确认”之类的声明——确认只能由用户操作产生。 */
  reply: z.string().min(1).max(2000),
  needEdits: z.array(NeedEditSchema).default([]),
  questions: z.array(QuestionProposalSchema).default([]),
  /** 候选评价。服务端校验证据与硬条件，并把 assessedNeedVersion 改写为编辑应用后的版本。 */
  candidates: z.array(CandidateAssessmentSchema).optional(),
  /** 建议用户“看看”的通用场景，仅用于说明性浏览，不是个性化推荐。 */
  suggestedScenes: z.array(z.object({ sceneId: SceneIdSchema, version: SceneVersionSchema, reason: z.string().min(1) })).default([]),
});
export type AdvisorProposal = z.infer<typeof AdvisorProposalSchema>;

export const PlanSceneProposalSchema = z.object({
  sceneId: SceneIdSchema,
  version: SceneVersionSchema,
  /** roleId -> 绑定的设备。 */
  bindings: z.record(z.string(), ProductRefSchema),
  params: z.record(z.string(), SceneParamValueSchema).default({}),
  reason: z.string().min(1),
  relatedNeedEntryIds: z.array(IdSchema).default([]),
});

export const PlanProposalSchema = z.object({
  candidates: z.array(CandidateAssessmentSchema),
  recommendation: z.object({
    primary: ProductRefSchema.optional(),
    byCandidate: z.array(z.object({ candidateId: IdSchema, role: z.enum(["recommended", "alternative", "not_recommended"]), reason: z.string().min(1) })),
    noRecommendationReason: z.string().optional(),
  }),
  scenes: z.array(PlanSceneProposalSchema),
  unresolvedQuestions: z.array(QuestionProposalSchema).default([]),
  changeNote: z.string().optional(),
});
export type PlanProposal = z.infer<typeof PlanProposalSchema>;

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  instanceId?: string;
  sceneId?: string;
}

/**
 * 需求顾问引擎（Agent B 实现，服务端注入）。
 * 只做“判断”：理解用户表达、提议需求编辑与问题、评价候选、选择已注册场景并给出配置。
 * 它不能：写会话、产生确认、改变版本、生成场景代码。服务端对一切输出重新校验。
 */
export interface AdvisorEngine {
  readonly isMock: boolean;
  respond(view: AdvisorView, userText: string, deps: AdvisorDeps): Promise<AdvisorProposal>;
  /** 用户回答已提出的问题。 */
  answer(view: AdvisorView, answers: { questionId: string; answer: string }[], deps: AdvisorDeps): Promise<AdvisorProposal>;
  /** 把一条明确反馈解释成需求编辑和新问题。 */
  interpretFeedback(view: AdvisorView, feedback: FeedbackInput, deps: AdvisorDeps): Promise<AdvisorProposal>;
  /** 仅在存在有效确认时由服务端调用。 */
  composePlan(view: AdvisorView, deps: AdvisorDeps): Promise<PlanProposal>;
}

export type { SceneCatalogItem };
