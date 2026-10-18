import type { FeedbackKind, NeedsStatus } from "@hwpc/contracts";

/** 界面用的中文标签。集中在这里，避免同一个状态在不同位置叫法不一。 */

export const ORIGIN_LABEL: Record<string, string> = { local: "本地知识库", ima: "ima 知识库", mock: "模拟数据" };

export const NEEDS_STATUS_LABEL: Record<NeedsStatus, string> = {
  collecting: "沟通中",
  awaiting_confirmation: "待确认",
  confirmed: "已确认",
  changed_since_confirmation: "需重新确认",
};

export const ENTRY_STATUS_LABEL: Record<string, string> = { known: "你说的", inferred: "推断", default: "默认", pending: "待确认" };

export const OUTCOME_LABEL: Record<string, string> = {
  fits: "满足需求",
  fits_with_compromise: "有取舍",
  not_fit: "不满足",
  insufficient_evidence: "证据不足",
};
export const OUTCOME_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  fits: "success",
  fits_with_compromise: "warning",
  not_fit: "danger",
  insufficient_evidence: "neutral",
};

export const APPLICABILITY_LABEL: Record<string, string> = {
  applicable: "有证据支持适用",
  conditional: "还有使用条件待确认",
  not_applicable: "不适用",
  unknown: "支持性未知",
  illustrative: "通用说明，不针对你的设备",
};

export const COMPLETION_LABEL: Record<string, string> = {
  not_started: "未开始",
  in_progress: "体验中",
  walkthrough_completed: "已走完流程（非实机测试）",
};

export const CAPABILITY_LABEL: Record<string, string> = {
  offline_experience: "离线体验",
  local_recovery: "进度保存",
  online_ai: "在线顾问",
  live_updates: "资料更新",
  cross_device_continuation: "跨设备续接",
  sharing: "方案分享",
};

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  new_need: "新增需求",
  change_need: "修改需求",
  concern: "顾虑",
  reject_candidate: "排除候选",
  prefer_candidate: "偏好候选",
  reject_scene: "不想体验",
  confirm_condition: "确认条件",
  note: "备注",
};
