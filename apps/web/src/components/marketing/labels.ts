export const POST_STATUS: Record<string, string> = { not_started: "未开始", draft: "待选稿", selected: "已选稿", published: "已发布" };

export const DELIVERY_LABEL: Record<string, string> = {
  deliverable: "核验通过",
  deliverable_with_notes: "核验通过（有说明）",
  needs_confirmation: "需人工确认",
  blocked: "核验未通过",
};
export const DELIVERY_TONE: Record<string, "success" | "warning" | "danger"> = {
  deliverable: "success",
  deliverable_with_notes: "success",
  needs_confirmation: "warning",
  blocked: "danger",
};

export const PUBLISH_STATE: Record<string, string> = {
  draft_created: "已存草稿",
  published: "已发布",
  pending_manual: "待手动发布",
  failed: "发布失败",
};

export const RESOLUTION_LABEL: Record<string, string> = {
  passed: "通过",
  removed: "已删除",
  rewritten: "已改写",
  flagged: "需注意",
  pending_user: "待确认",
};
