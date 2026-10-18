/**
 * 界面模拟：需求沟通状态机。代表 B（问什么、是否充分）与主 Agent（确认校验）的行为，
 * 仅用于前端联调，判断规则只是关键词匹配，与真实后端无关。
 *
 * 状态 = 对 inputs 顺序回放的结果。这样"修改前面的表达"就是截断并重放，
 * 刷新恢复就是读取 inputs 重放，前端不另存确认状态。
 */
import type { AdvisorQuestion, CandidateProduct, ChatMessage, MaterialGap, Phase, RequirementItem, RequirementKey, RequirementSummary } from "../types";
import {
  AUDIENCE_OPTIONS,
  BATTERY_OPTIONS,
  CHANNEL_OPTIONS,
  DELIVERABLE_OPTIONS,
  SCOPE_OPTIONS,
  buildRequirements,
  buildSummary,
  candidatesFor,
  gapsFor,
  parseText,
  type Knowns,
} from "./knowns";

export type Input =
  | { kind: "msg"; text: string; at: string }
  | { kind: "answers"; items: { questionId: string; optionValue?: string; text?: string }[]; freeText?: string; at: string }
  | { kind: "retrieval_done"; at: string; failed?: boolean }
  | { kind: "summary_edit"; edits: { key: RequirementKey; value: string }[]; at: string; source: "user" | "other_window" }
  | { kind: "continue"; at: string }
  | { kind: "confirm"; summaryId: string; at: string }
  | { kind: "work_done"; version: number; at: string; failed?: boolean }
  | { kind: "work_revision"; instruction: string; at: string }
  | { kind: "requirement_change"; note: string; at: string }
  | { kind: "resume"; at: string };

type Stage = "ask" | "retrieving" | "ask_material" | "summary" | "producing" | "delivered";

export interface Derived {
  phase: Phase;
  stage: Stage;
  messages: ChatMessage[];
  requirements: RequirementItem[];
  questions: AdvisorQuestion[];
  gaps: MaterialGap[];
  candidates: CandidateProduct[];
  summary?: RequirementSummary;
  summaries: RequirementSummary[];
  requirementVersion: number;
  confirmedRequirementVersion?: number;
  needsRetrieval: boolean;
  needsWork?: { reqVersion: number; reason: "initial" | "revision"; instruction?: string };
  knowns: Knowns;
  /** work version → 需求版本。 */
  workReq: Record<number, number>;
  retrieved: boolean;
  failed?: { code: string; message: string; recoverable: boolean };
}

const idxOf = (messageId: string) => Number(messageId.split("-")[1]);

export function replay(sessionId: string, inputs: Input[]): Derived {
  const k: Knowns = { overrides: {} };
  const messages: ChatMessage[] = [];
  const summaries: RequirementSummary[] = [];
  const workReq: Record<number, number> = {};
  let reqVersion = 0;
  let confirmedReq: number | undefined;
  let retrieved = false;
  let stage = "ask" as Stage;
  let pendingWork: Derived["needsWork"];
  let lastWork = -1;
  let failed: Derived["failed"];

  const say = (i: number, text: string, at: string, n = 1) =>
    messages.push({ messageId: `m-${i}-${n}`, role: "advisor", text, at, editable: false });
  const user = (i: number, text: string, at: string) =>
    messages.push({ messageId: `m-${i}-0`, role: "user", text, at, editable: false });

  const newSummary = (at: string): RequirementSummary => {
    const prev = summaries.at(-1);
    if (prev) prev.status = "superseded";
    reqVersion += 1;
    const s = buildSummary(sessionId, reqVersion, k, prev, at);
    summaries.push(s);
    return s;
  };

  /** 讨论阶段推进：缺人群/渠道 → 追问；未检索 → 检索；缺范围/续航处理 → 追问；否则出摘要。 */
  const advance = (i: number, at: string) => {
    if (stage === "producing" || stage === "delivered") return;
    if (!k.audience || !k.channel) {
      stage = "ask";
      const missing = [!k.audience && "面向的人群", !k.channel && "发布渠道"].filter(Boolean).join("和");
      say(i, `先把${missing}定下来，其他细节我们边聊边定。${k.audience ? `已记下人群：${k.audience}。` : ""}`, at);
      return;
    }
    if (!retrieved) {
      stage = "retrieving";
      say(i, `明白：面向${k.audience}，发布到${k.channel}。我去资料库看看候选型号，看完给你有依据的选择。`, at);
      return;
    }
    if (!k.scope || !k.battery) {
      stage = "ask_material";
      say(i, "资料看完了。产品范围和续航资料冲突的处理需要你定，其余我先按默认处理。", at);
      return;
    }
    stage = "summary";
    const s = newSummary(at);
    say(i, `信息够了，我整理成需求摘要（第 ${s.requirementVersion} 版）。你确认后才会开始制作。`, at);
  };

  inputs.forEach((inp, i) => {
    switch (inp.kind) {
      case "msg": {
        user(i, inp.text, inp.at);
        parseText(inp.text, k);
        if (stage === "summary") {
          const s = newSummary(inp.at);
          say(i, `已按你的补充更新摘要（第 ${s.requirementVersion} 版）。`, inp.at);
        } else advance(i, inp.at);
        break;
      }
      case "answers": {
        const labels: string[] = [];
        for (const a of inp.items) {
          const v = a.optionValue;
          if (v !== undefined) {
            if (a.questionId === "q-audience") k.audience = v;
            else if (a.questionId === "q-channel") k.channel = v;
            else if (a.questionId === "q-deliverable") k.deliverable = v as Knowns["deliverable"];
            else if (a.questionId === "q-scope") k.scope = v as Knowns["scope"];
            else if (a.questionId === "q-battery") k.battery = v as Knowns["battery"];
            const all = [...AUDIENCE_OPTIONS, ...CHANNEL_OPTIONS, ...DELIVERABLE_OPTIONS, ...SCOPE_OPTIONS, ...BATTERY_OPTIONS];
            labels.push(all.find((o) => o.value === v)?.label ?? v);
          }
          if (a.text) {
            parseText(a.text, k);
            labels.push(a.text);
          }
        }
        if (inp.freeText) {
          parseText(inp.freeText, k);
          labels.push(inp.freeText);
        }
        user(i, labels.join("；") || "（已回答）", inp.at);
        if (stage === "summary") {
          const s = newSummary(inp.at);
          say(i, `摘要已更新（第 ${s.requirementVersion} 版）。`, inp.at);
        } else advance(i, inp.at);
        break;
      }
      case "retrieval_done": {
        if (inp.failed) {
          failed = { code: "data_unavailable", message: "资料来源暂时不可用（模拟）。你的需求已保留，可以重试。", recoverable: true };
          break;
        }
        retrieved = true;
        failed = undefined;
        advance(i, inp.at);
        break;
      }
      case "summary_edit": {
        for (const e of inp.edits) {
          k.overrides[e.key] = e.value;
          parseText(e.value, k);
        }
        const s = newSummary(inp.at);
        say(
          i,
          inp.source === "other_window"
            ? `另一个窗口修改了需求，摘要已更新到第 ${s.requirementVersion} 版。旧版本的确认不再有效。`
            : `已按你的修改更新摘要（第 ${s.requirementVersion} 版），请重新确认。`,
          inp.at,
          0,
        );
        stage = "summary";
        break;
      }
      case "continue": {
        say(i, "好，继续聊。想先调整哪一部分？直接说就行，我会据此更新摘要。当前摘要在你确认前不会触发制作。", inp.at, 0);
        break;
      }
      case "confirm": {
        const s = summaries.find((x) => x.summaryId === inp.summaryId);
        if (!s || s.status !== "pending_confirmation") break;
        s.status = "confirmed";
        confirmedReq = s.requirementVersion;
        stage = "producing";
        pendingWork = { reqVersion: s.requirementVersion, reason: Object.keys(workReq).length ? "revision" : "initial" };
        say(i, `已确认第 ${s.requirementVersion} 版需求，开始制作。`, inp.at, 0);
        break;
      }
      case "work_done": {
        if (inp.failed) {
          failed = { code: "task_interrupted", message: "制作中断（模拟）。已确认的需求仍保留，可以继续。", recoverable: true };
          break;
        }
        workReq[inp.version] = pendingWork?.reqVersion ?? confirmedReq ?? reqVersion;
        lastWork = i;
        pendingWork = undefined;
        stage = "delivered";
        failed = undefined;
        say(i, `第 ${inp.version} 版作品完成。可在右侧查看平台内容、互动网页和依据核验。`, inp.at, 0);
        break;
      }
      case "work_revision": {
        user(i, inp.instruction, inp.at);
        stage = "producing";
        pendingWork = { reqVersion: confirmedReq ?? reqVersion, reason: "revision", instruction: inp.instruction };
        say(i, "这是内容层面的修改，不改变已确认的需求。我会生成新版本并重新核验。", inp.at);
        break;
      }
      case "requirement_change": {
        user(i, inp.note, inp.at);
        parseText(inp.note, k);
        const s = newSummary(inp.at);
        stage = "summary";
        say(i, `这会改变已确认的需求，先更新摘要（第 ${s.requirementVersion} 版）。你确认前，现有作品保留为历史版本，不再对应当前需求。`, inp.at);
        break;
      }
      case "resume": {
        failed = undefined;
        break;
      }
    }
  });

  // 只有尚未开始制作、且在最近一次交付之后的用户表达可以修改。
  const editableStage = (stage === "ask" || stage === "ask_material" || stage === "summary" || stage === "retrieving") && !pendingWork;
  for (const m of messages) {
    if (m.role === "user") m.editable = editableStage && idxOf(m.messageId) > lastWork;
  }

  const questions: AdvisorQuestion[] = [];
  if (stage === "ask") {
    if (!k.audience)
      questions.push({ questionId: "q-audience", category: "preference", prompt: "这篇内容主要写给谁看？", why: "人群不同，切入点完全不同", options: AUDIENCE_OPTIONS, allowFreeText: true });
    if (!k.channel)
      questions.push({ questionId: "q-channel", category: "preference", prompt: "打算发布在哪里？", why: "平台决定结构、语气和图片数量", options: CHANNEL_OPTIONS, allowFreeText: true });
  }
  if (stage === "ask_material") {
    if (!k.scope)
      questions.push({ questionId: "q-scope", category: "preference", prompt: "产品范围想怎么定？", why: "资料库里有两款候选，各有取舍", options: SCOPE_OPTIONS, allowFreeText: true });
    if (!k.battery)
      questions.push({ questionId: "q-battery", category: "material", prompt: "续航资料有两个来源且数值不同，怎么处理？", why: "这是资料缺口，不需要你填写参数", options: BATTERY_OPTIONS, allowFreeText: false });
    if (!k.deliverable)
      questions.push({ questionId: "q-deliverable", category: "preference", prompt: "除平台图文外，需要可分享的互动网页吗？", why: "不选则只做平台图文", options: DELIVERABLE_OPTIONS, allowFreeText: true });
  }

  let phase: Phase = "discussing";
  if (failed && stage === "producing") phase = "interrupted";
  else if (failed) phase = "failed";
  else if (stage === "retrieving") phase = "retrieving";
  else if (stage === "summary") phase = "awaiting_confirmation";
  else if (stage === "producing") phase = "producing";
  else if (stage === "delivered") phase = "delivered";

  return {
    phase,
    stage,
    messages,
    requirements: buildRequirements(k),
    questions,
    gaps: retrieved ? gapsFor(k) : [],
    candidates: retrieved ? candidatesFor(k) : [],
    summary: summaries.at(-1),
    summaries,
    requirementVersion: reqVersion,
    confirmedRequirementVersion: confirmedReq,
    needsRetrieval: stage === "retrieving" && !failed,
    needsWork: stage === "producing" && !failed ? pendingWork : undefined,
    knowns: k,
    workReq,
    retrieved,
    failed,
  };
}
