/**
 * 个人方案（PersonalPlan）：提案结构，供主 Agent / B 迁入公共契约。
 * 前端只展示，不改写：推荐顺序、理由、候选取舍均由 B 给出；完成状态与点击不会改变推荐。
 */
import type { FeedbackEvent, SavedRun, SceneConfig } from "./types";

export type PlanOrigin = "local" | "ima" | "mock";

export interface PlanCondition {
  label: string;
  value: string;
  provenance: "user_said" | "system_suggested" | "assumed_default" | "pending";
}

export interface PlanEvidenceLine {
  claim: string;
  status: "supported" | "unknown" | "conflict";
  qualifiers: string[];
  sourceTitle?: string;
  origin?: PlanOrigin;
}

export interface PlanCandidate {
  candidateId: string;
  model: string;
  origin: PlanOrigin;
  /** 适合原因 / 不足 / 未知项，均由 B 提供。 */
  fitReasons: string[];
  shortfalls: string[];
  unknowns: string[];
  evidence: PlanEvidenceLine[];
}

/** 推荐的体验。sceneVersion 固定；场景升级不会改变已生成方案。 */
export interface PlanExperience {
  experienceId: string;
  order: number;
  sceneId: string;
  sceneVersion: number;
  /** B 给出的推荐理由；mock 下带有 [模拟顾问理由] 标记。 */
  reason: string;
  reasonSimulated: boolean;
  forCandidateIds: string[];
  config: SceneConfig;
}

export interface PersonalPlan {
  planId: string;
  planVersion: number;
  createdAt: string;
  /** 方案对应的需求版本与确认状态（来自后端，不由前端推断）。 */
  requirementVersion: number;
  requirementConfirmed: boolean;
  conditions: PlanCondition[];
  candidates: PlanCandidate[];
  experiences: PlanExperience[];
  /** 资料缺口与待解决问题（来自后端）。 */
  openIssues: string[];
  isMock: boolean;
  dataOrigin: PlanOrigin;
  /** 方案里素材与证据的用途说明。 */
  notices: string[];
}

export type FeedbackStatus = "sent" | "queued" | "unsupported";

export interface FeedbackRecord {
  event: FeedbackEvent;
  status: FeedbackStatus;
  /** 后端回执（如"已收到,推荐暂未改变,待顾问评估"）。 */
  ack?: string;
}

/** 个人方案的体验进度：随方案版本分别保存。 */
export interface PlanPosition {
  activity: "talk" | "scenes" | "compare" | "plan";
  /** 当前所在局部任务（experienceId）；空表示在全景空间或活动首页。 */
  experienceId?: string;
  yaw: number;
  pitch: number;
}

export interface PlanProgress {
  planId: string;
  planVersion: number;
  /** key = experienceId。 */
  records: Record<string, SavedRun>;
  position?: PlanPosition;
  feedback: FeedbackRecord[];
  /** 保存位置：必须如实标注，浏览器本地缓存不是服务端持久化。 */
  storage: "none" | "browser_local" | "server";
  updatedAt: string;
}

/** 导出/导入的离线进度记录。 */
export interface ProgressExport {
  format: "hwpc-plan-progress";
  formatVersion: 1;
  planId: string;
  planVersion: number;
  exportedAt: string;
  /** 来源：workbench=顾问工作台；offline_html=离线个人页面（独立副本）。 */
  from: "workbench" | "offline_html";
  records: Record<string, SavedRun>;
  feedback: FeedbackEvent[];
}
