import type { SessionSnapshot } from "@hwpc/contracts";

export type NextAction = "resume" | "confirm" | "compose" | "experience" | "answer" | "talk";

export interface NextStep {
  action: NextAction;
  title: string;
  detail: string;
  /** 主按钮文案 */
  cta: string;
  tone: "primary" | "danger" | "neutral";
  /** 动作是否当前可执行（例如需求有阻塞时不能确认） */
  enabled: boolean;
}

/** 快照里与“下一步”判断有关的最小字段，便于单测时手写。 */
export type StageInput = Pick<SessionSnapshot, "run" | "needs" | "plan" | "conversation">;

/**
 * 根据会话状态给出唯一的下一步。优先级：任务出错 → 待确认 → 可组装方案 → 去体验 → 回答问题 → 继续沟通。
 * 这里只做展示层判断；能不能执行仍以服务端门控为准。
 */
export function nextStep(s: StageInput): NextStep {
  if (s.run.state === "failed") {
    return { action: "resume", title: "上一步没有完成", detail: s.run.error?.message ?? "顾问处理时出错了，可以恢复后继续。", cta: "恢复并继续", tone: "danger", enabled: true };
  }
  const needs = s.needs;
  if (needs.status === "awaiting_confirmation" || needs.status === "changed_since_confirmation") {
    const again = needs.status === "changed_since_confirmation";
    return {
      action: "confirm",
      title: again ? "需求有变化，请重新确认" : "需求已经整理好，请确认",
      detail: needs.summary.confirmable
        ? "确认后才会生成个人方案。之后的关键变化会要求重新确认。"
        : `暂时不能确认：${needs.summary.blockers.join("；")}`,
      cta: again ? "重新确认需求" : "确认这版需求",
      tone: "primary",
      enabled: needs.summary.confirmable,
    };
  }
  if (needs.status === "confirmed" && !s.plan.current) {
    return {
      action: "compose",
      title: "需求已确认，可以生成你的体验页",
      detail: s.plan.canCompose ? "体验页会讲清每款候选满足什么、要取舍什么，并安排适合你的场景。" : (s.plan.cannotComposeReason ?? "暂时不能生成方案"),
      cta: "生成我的体验页",
      tone: "primary",
      enabled: s.plan.canCompose,
    };
  }
  if (s.plan.current) {
    return {
      action: "experience",
      title: s.plan.current.needsReview ? "方案待复核：有新的反馈" : "你的体验页已经生成",
      detail: s.plan.current.needsReview ? "你提交了新的反馈。可以先看体验页，或按当前需求重新生成。" : "全屏浏览候选、亲手试场景；有疑问可以在页面里随时提问。",
      cta: "进入体验页",
      tone: "neutral",
      enabled: true,
    };
  }
  if (s.conversation.openQuestions.length > 0) {
    return { action: "answer", title: "顾问有几个问题", detail: "回答后我会整理需求摘要，请你确认。", cta: "去回答", tone: "neutral", enabled: true };
  }
  return { action: "talk", title: "继续聊聊你的使用方式", detail: "说说主要任务、预算和已有设备，我会整理成需求摘要。", cta: "去沟通", tone: "neutral", enabled: true };
}
