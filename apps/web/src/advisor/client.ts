import type { FeedbackEvent, FeedbackRecord, PersonalPlan, PlanProgress } from "@hwpc/scenes";
import type { AdvisorSnapshot, RequirementKey, WorkView } from "./types";

/** 用户对一个问题的回答：选项或自由文本。 */
export interface AnswerItem {
  questionId: string;
  optionValue?: string;
  text?: string;
}

export interface SubmitAnswersRequest {
  answers: AnswerItem[];
  /** 一句话同时覆盖多个问题；具体解释由 B 处理。 */
  freeText?: string;
  baseRevision: number;
}

export interface SummaryRef {
  summaryId: string;
  requirementVersion: number;
}

export type ConfirmRejectReason =
  | "stale_summary" // 摘要已被新版本取代
  | "already_confirmed" // 重复提交
  | "not_pending" // 当前不处于待确认
  | "blocked" // 摘要含阻塞项，不能开始制作
  | "unavailable"; // 服务端暂不能开始制作

export type ConfirmResult =
  | { status: "accepted"; duplicate: boolean; snapshot: AdvisorSnapshot }
  | { status: "rejected"; reason: ConfirmRejectReason; message: string; snapshot: AdvisorSnapshot };

export interface SummaryEdit {
  key: RequirementKey;
  value: string;
}

export class AdvisorApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "AdvisorApiError";
  }
}

/**
 * 前端对"顾问后端"的全部依赖。真实后端、旧接口适配器、界面模拟服务都实现它。
 * 所有写操作带 baseRevision / 摘要标识，由服务端判定是否过期。
 */
export interface AdvisorClient {
  readonly kind: "mock-ui" | "legacy-api";
  createSession(text: string): Promise<AdvisorSnapshot>;
  /** 会话不存在返回 null。 */
  getSnapshot(sessionId: string): Promise<AdvisorSnapshot | null>;
  sendMessage(sessionId: string, text: string, baseRevision: number): Promise<AdvisorSnapshot>;
  submitAnswers(sessionId: string, req: SubmitAnswersRequest): Promise<AdvisorSnapshot>;
  /** 仅等待回答或摘要待确认阶段可用；该消息之后的对话由服务端重新生成。 */
  editMessage(sessionId: string, messageId: string, text: string, baseRevision: number): Promise<AdvisorSnapshot>;
  confirmSummary(sessionId: string, ref: SummaryRef): Promise<ConfirmResult>;
  reviseSummary(sessionId: string, ref: SummaryRef, edits: SummaryEdit[]): Promise<AdvisorSnapshot>;
  continueDiscussion(sessionId: string, ref: SummaryRef): Promise<AdvisorSnapshot>;
  /** 已生成作品后提出修改。关键需求变化时服务端返回需求沟通阶段的快照。 */
  requestWorkRevision(sessionId: string, instruction: string, baseWorkVersion: number): Promise<AdvisorSnapshot>;
  /** 从互动网页或作品区主动回到需求沟通（改变选购目标、产品范围等）。 */
  requestRequirementChange(sessionId: string, note: string, baseWorkVersion: number): Promise<AdvisorSnapshot>;
  resume(sessionId: string): Promise<AdvisorSnapshot>;
  getWork(sessionId: string, version: number): Promise<WorkView>;
  /** 个人方案（含推荐体验）。没有方案返回 null。planVersion 缺省为最新。 */
  getPlan(sessionId: string, planVersion?: number): Promise<PersonalPlan | null>;
  /** 体验进度。storage 字段如实说明保存位置。 */
  loadProgress(sessionId: string, planVersion: number): Promise<PlanProgress>;
  saveProgress(sessionId: string, progress: PlanProgress): Promise<PlanProgress>;
  /** 结构化反馈送后端，由 B 判断影响；前端不据此改变推荐。 */
  sendFeedback(sessionId: string, event: FeedbackEvent): Promise<FeedbackRecord>;
  /** 绑定作品版本的图片地址。 */
  imageUrl(sessionId: string, version: number, imageId: string): string | null;
}
