/**
 * 顾问工作台的前端视图模型（"AdvisorSnapshot"）。
 *
 * 重要：这些类型是前端向主 Agent 提出的接口需求（见 apps/web/integration-notes.md），
 * 尚未进入 packages/contracts。真实后端同步契约前，由 mock 服务（界面模拟）和旧接口适配器提供。
 * 界面状态一律以快照为准；前端本地状态只用于改善交互，不是确认或作品版本的记录。
 */
import type { DataOrigin, ResultVersion } from "@hwpc/contracts";

/** 信息来源：区分用户已表达 / 系统建议 / 默认假设 / 待确认。 */
export type Provenance = "user_said" | "system_suggested" | "assumed_default" | "pending";

export type RequirementKey =
  | "audience"
  | "problem"
  | "goal"
  | "productScope"
  | "channel"
  | "deliverable"
  | "direction"
  | "constraints";

export interface RequirementItem {
  key: RequirementKey;
  label: string;
  value: string | null;
  provenance: Provenance;
  /** 依据：来自哪句话，或系统为何这样建议。 */
  basis?: string;
}

export interface QuestionOption {
  value: string;
  label: string;
  hint?: string;
}

/** preference：用户偏好（可问用户）；material：资料缺口/冲突决定，不要求用户填写产品参数。 */
export interface AdvisorQuestion {
  questionId: string;
  category: "preference" | "material";
  prompt: string;
  why?: string;
  options: QuestionOption[];
  allowFreeText: boolean;
}

export interface MaterialGap {
  gapId: string;
  text: string;
  impact: string;
  handling: "default_applied" | "needs_decision" | "blocking";
  note?: string;
}

export interface ProgressStep {
  stepId: string;
  /** 这一步的目的，如"查看候选型号的携带与接口资料"。 */
  purpose: string;
  state: "running" | "done" | "failed";
  origin: DataOrigin | "model";
  /** 来自模拟实现。 */
  simulated: boolean;
  resultNote?: string;
}

export interface EvidenceItem {
  claim: string;
  status: "supported" | "unknown" | "conflict";
  qualifiers: string[];
  sourceTitle?: string;
  origin?: DataOrigin;
}

export interface CandidateProduct {
  candidateId: string;
  model: string;
  origin: DataOrigin;
  fit: string;
  evidence: EvidenceItem[];
  unknowns: string[];
  differences: string[];
}

export interface ChatMessage {
  messageId: string;
  role: "user" | "advisor";
  text: string;
  at: string;
  /** 用户消息可在等待回答/摘要确认阶段修改。 */
  editable: boolean;
  edited?: boolean;
}

export interface SummaryField {
  key: RequirementKey;
  label: string;
  value: string;
  provenance: Provenance;
  changed?: boolean;
}

export interface RequirementSummary {
  summaryId: string;
  requirementVersion: number;
  status: "pending_confirmation" | "confirmed" | "superseded";
  fields: SummaryField[];
  defaults: string[];
  limitations: string[];
  /** 存在阻塞项时不可确认（由 B 判定，前端只展示）。 */
  blockers: string[];
  /** 相对上一版摘要受影响的项。 */
  affected?: string[];
  createdAt: string;
}

export type Phase =
  | "discussing"
  | "retrieving"
  | "awaiting_confirmation"
  | "producing"
  | "delivered"
  | "blocked"
  | "failed"
  | "interrupted";

/** 后端能力声明：界面据此如实展示，不假设旧接口已满足。 */
export interface Capabilities {
  requirementConfirmation: boolean;
  conversationRestore: boolean;
  amendMessages: boolean;
  freeTextAcrossQuestions: boolean;
  interactivePlan: boolean;
  versionedImages: boolean;
  historyVersions: boolean;
  resume: boolean;
  /** 个人方案与场景体验。 */
  personalPlan: boolean;
  /** 体验进度由服务端保存。false 时只有浏览器本地缓存（如实标注，不称为服务端持久化）。 */
  serverProgress: boolean;
  /** 结构化反馈可送达后端。 */
  feedbackToBackend: boolean;
}

export interface PlanVersionMeta {
  planVersion: number;
  requirementVersion: number;
  createdAt: string;
  /** 是否对应当前已确认的需求；false 的旧方案仍可查看，但不是当前建议。 */
  current: boolean;
  staleReason?: string;
}

export interface BackendInfo {
  kind: "mock-ui" | "legacy-api";
  label: string;
  dataOrigin: DataOrigin;
  modelProvider: "mock" | "openai_compatible";
  modelSimulated: boolean;
  mockInUse: boolean;
  notes: string[];
}

export interface WorkVersionMeta {
  version: number;
  /** 该作品基于的需求版本。 */
  requirementVersion: number;
  createdAt: string;
  reason: "initial" | "clarification" | "revision";
  /** 是否对应当前需求。false 表示历史版本，核验结论不适用于当前需求。 */
  currentRequirement: boolean;
  staleReason?: string;
  deliveryStatus: ResultVersion["verification"]["deliveryStatus"];
  isMock: boolean;
}

export interface AdvisorSnapshot {
  sessionId: string;
  /** 快照修订号，用于识别旧数据。 */
  revision: number;
  requirementVersion: number;
  phase: Phase;
  messages: ChatMessage[];
  requirements: RequirementItem[];
  questions: AdvisorQuestion[];
  gaps: MaterialGap[];
  progress: ProgressStep[];
  candidates: CandidateProduct[];
  summary?: RequirementSummary;
  versions: WorkVersionMeta[];
  /** 已确认并正在/已经制作的需求版本；用于判断作品是否对应当前需求。 */
  confirmedRequirementVersion?: number;
  planVersions: PlanVersionMeta[];
  capabilities: Capabilities;
  backend: BackendInfo;
  error?: { code: string; message: string; recoverable: boolean };
}

/* ------------------------------------------------------------------ */
/* 作品视图：ResultVersion（公共契约）+ 互动方案（待契约化）              */
/* ------------------------------------------------------------------ */

/**
 * 互动方案：由 B 输出的结构化描述，前端用受控组件渲染。
 * 文案中的产品事实一律通过 factIds / imageIds 引用当前版本资料包，由渲染器从资料包取值，
 * 不接受模型直接写出的 HTML 或脚本。
 */
export interface InteractiveItem {
  factIds: string[];
  imageId?: string;
}

export interface InteractiveScene {
  stateId: string;
  /** 来自已确认的使用场景，如"课堂与图书馆"。 */
  label: string;
  /** 为什么这个场景值得看（非产品事实的引导语）。 */
  why: string;
  items: InteractiveItem[];
}

export interface ClaimPanel {
  stateId: string;
  /** 卖点标题（引导标签，不含参数）。 */
  headline: string;
  factIds: string[];
  imageIds: string[];
}

export interface CompareCell {
  productId: string;
  /** 空数组 = 资料未提供，界面显示未知，不视为满足。 */
  factIds: string[];
}

export interface CompareRow {
  rowId: string;
  label: string;
  cells: CompareCell[];
}

export interface ComparePanel {
  stateId: string;
  productIds: string[];
  rows: CompareRow[];
}

export interface InteractivePlan {
  planId: string;
  title: string;
  intro: string;
  /** 对应用户确认的交付需求，如"平台图文 + 互动网页"。 */
  deliverableBasis: string;
  scenes: InteractiveScene[];
  claims: ClaimPanel[];
  compare?: ComparePanel;
  /**
   * 后端核验过的全部互动状态。不在其中的状态不渲染。
   * 目的：核验覆盖每一个可到达的状态，而不仅是默认首屏。
   */
  verifiedStateIds: string[];
}

export interface WorkView {
  version: number;
  meta: WorkVersionMeta;
  result: ResultVersion;
  /** 用户确认的交付需求不含互动网页时为空。 */
  interactive?: InteractivePlan;
  /** 确认该版本时所依据的需求摘要。 */
  basisSummary?: RequirementSummary;
}
