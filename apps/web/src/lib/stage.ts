import type { SessionSnapshot } from "@hwpc/contracts";
import { NEEDS_STATUS_LABEL } from "./labels";

export type TabId = "talk" | "needs" | "candidates" | "experience" | "plan";

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
      title: "需求已确认，可以生成个人方案",
      detail: s.plan.canCompose ? "方案会给出候选取舍，并安排适合你的场景体验。" : (s.plan.cannotComposeReason ?? "暂时不能生成方案"),
      cta: "生成个人方案",
      tone: "primary",
      enabled: s.plan.canCompose,
    };
  }
  if (s.plan.current) {
    return {
      action: "experience",
      title: s.plan.current.needsReview ? "方案待复核：有新的反馈" : "方案已生成，去亲手试一试",
      detail: "在体验区走一遍方案里的任务；有新的想法可以随时在场景里提交反馈。",
      cta: "进入场景体验",
      tone: "neutral",
      enabled: true,
    };
  }
  if (s.conversation.openQuestions.length > 0) {
    return { action: "answer", title: "顾问有几个问题", detail: "回答后我会整理需求摘要，请你确认。", cta: "去回答", tone: "neutral", enabled: true };
  }
  return { action: "talk", title: "继续聊聊你的使用方式", detail: "说说主要任务、预算和已有设备，我会整理成需求摘要。", cta: "去沟通", tone: "neutral", enabled: true };
}

export interface TabMeta {
  id: TabId;
  label: string;
  hint: string;
  attention?: boolean;
}

/** 右侧各标签页的简短状态，显示在标签下方，让顾客一眼看到进度。 */
export function tabMeta(s: SessionSnapshot): TabMeta[] {
  const plan = s.plan.current;
  const candidates = plan?.candidates ?? s.candidates.assessments;
  const assigned = plan?.scenes ?? [];
  const done = assigned.filter((e) => s.scenes.instances.find((v) => v.instance.instanceId === e.instanceId)?.experience.completion === "walkthrough_completed").length;
  return [
    { id: "talk", label: "对话", hint: s.conversation.openQuestions.length ? `${s.conversation.openQuestions.length} 个问题` : `${s.conversation.messages.length} 条`, attention: s.conversation.openQuestions.length > 0 },
    {
      id: "needs",
      label: "需求",
      hint: NEEDS_STATUS_LABEL[s.needs.status],
      attention: s.needs.status === "awaiting_confirmation" || s.needs.status === "changed_since_confirmation",
    },
    { id: "candidates", label: "候选", hint: candidates.length ? (s.candidates.stale && !plan ? "待更新" : `${candidates.length} 个`) : "暂无" },
    { id: "experience", label: "体验", hint: assigned.length ? `${done}/${assigned.length} 已体验` : "可浏览" },
    { id: "plan", label: "方案", hint: plan ? `v${plan.version}${plan.needsReview ? " 待复核" : ""}` : "未生成", attention: Boolean(plan?.needsReview) },
  ];
}
