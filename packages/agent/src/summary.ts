/**
 * 需求摘要：面向用户的简洁说明，绑定需求版本与指纹。摘要不含任何作品文案。
 */
import { FORMAT_LABEL, PLATFORM_LABEL, SCENARIO_LABEL, topicLabel } from "./lexicon.js";
import { productLabel } from "./retrieval.js";
import { latestEvidence } from "./retrieval.js";
import { REQUIRED_CRITICAL } from "./gate.js";
import { openConflicts, reqFingerprint } from "./state.js";
import { affectedConflicts, directionFingerprint, findEvidenceGaps, MIN_POINTS, pickDirection, topicsOf } from "./strategy.js";
import type { ChangeImpact, ContentDirection, ConversationState, Summary } from "./types.js";
import type { Platform, Scenario } from "@hwpc/contracts";
import { hash } from "./util.js";
import { modeOf } from "./mode.js";
import { buildAssessment, scopeFingerprint } from "./assess.js";
import { KEY_LABEL } from "./state.js";

const tag = (s: ConversationState, k: keyof typeof KEY_LABEL): string => {
  const it = s.items[k];
  if (!it) return "";
  if (it.source.kind === "default") return "（默认，可修改）";
  if (it.source.kind === "system" || it.status === "tentative") return "（系统推断，请确认）";
  return "";
};

export interface Readiness {
  ready: boolean;
  blockers: string[];
  direction?: ContentDirection;
}

/** 是否具备形成可确认摘要的条件，以及阻止项。 */
export function assessReadiness(s: ConversationState): Readiness {
  return modeOf(s) === "marketing" ? assessMarketingReadiness(s) : assessShoppingReadiness(s);
}

function assessMarketingReadiness(s: ConversationState): Readiness {
  const blockers: string[] = [];
  const missing = REQUIRED_CRITICAL.filter((k) => !s.items[k]);
  if (missing.length) blockers.push(`还缺少：${missing.map((k) => KEY_LABEL[k]).join("、")}`);
  if (s.items["productScope"] && !s.items["productScope"].refs?.length) blockers.push("产品范围还没有落到具体型号");
  for (const c of openConflicts(s)) blockers.push(`未解决的矛盾：${c.description}`);
  for (const q of s.questions) if (q.status === "open") blockers.push(`待回答：${q.prompt}`);

  const ev = latestEvidence(s);
  let direction: ContentDirection | undefined;
  if (s.items["productScope"]?.refs?.length) {
    if (!ev) blockers.push("尚未取得产品资料");
    else if (ev.error) blockers.push(`资料暂时无法读取：${ev.error.message}`);
    else if (ev.pack) {
      const pack = ev.pack;
      for (const g of findEvidenceGaps(pack, s)) blockers.push(g.text);
      for (const c of affectedConflicts(pack, s)) blockers.push(`资料冲突（${c.field}）：${c.description}`);
      direction = pickDirection(pack, s);
      const platform = s.items["platform"]?.value as Platform | undefined;
      const min = platform ? MIN_POINTS[platform] : 1;
      if (direction.selected.length < min) blockers.push(`资料里可用的事实只有 ${direction.selected.length} 条，不足以支撑${platform ? PLATFORM_LABEL[platform] : "该渠道"}内容`);
    }
  }
  return { ready: blockers.length === 0, blockers, direction };
}

export function buildSummary(s: ConversationState, at: string, opts: { changeNote?: string; impact?: ChangeImpact } = {}): Summary {
  return modeOf(s) === "marketing" ? buildMarketingSummary(s, at, opts) : buildShoppingSummary(s, at, opts);
}

function buildMarketingSummary(s: ConversationState, at: string, opts: { changeNote?: string; impact?: ChangeImpact } = {}): Summary {
  const r = assessReadiness(s);
  const it = s.items;
  const ev = latestEvidence(s);
  const direction = r.direction;
  const platform = it["platform"]?.value as Platform | undefined;
  const scenario = it["scenario"]?.value as Scenario | undefined;
  const refs = it["productScope"]?.refs ?? [];

  const assumptions: string[] = [];
  for (const k of ["problem", "goal", "deliveryFormat", "scenario"] as const) {
    const t = tag(s, k);
    if (t && it[k]) assumptions.push(`${KEY_LABEL[k]}：${fmt(s, k)}${t}`);
  }
  if (!it["activity"]) assumptions.push("活动：未提到活动，内容不涉及活动，也不写价格或优惠");
  for (const c of s.userClaims) assumptions.push(`你提到的${c.kind === "price" ? "价格" : "参数"}「${c.text}」没有资料依据，不会写入作品`);
  for (const d of s.decisions) assumptions.push(`已按你的决定处理：${d.decision}`);

  const constraints: string[] = [];
  if (it["mustEmphasize"]) constraints.push(`强调：${it["mustEmphasize"].value}`);
  if (it["mustAvoid"]) constraints.push(`避免：${it["mustAvoid"].value}`);
  if (it["activity"]) constraints.push(`活动：${it["activity"].value}`);
  if (it["styleNotes"]) constraints.push(`表达：${it["styleNotes"].value}`);
  if (!constraints.length) constraints.push("没有额外限制");

  const evidenceDigest = direction?.selected.map((x) => `${x.field}：${x.value}`) ?? [];
  const evidenceGaps = [...(ev?.pack ? findEvidenceGaps(ev.pack, s).map((g) => g.text) : []), ...(ev?.pack?.gaps ?? [])];

  const sections = [
    { key: "audience", label: "面向谁", text: `${it["audience"]?.value ?? "未明确"}${tag(s, "audience")}` },
    { key: "problem", label: "要解决的问题", text: fmt(s, "problem") + tag(s, "problem") },
    { key: "goal", label: "营销目标", text: fmt(s, "goal") + tag(s, "goal") },
    { key: "product", label: "产品", text: refs.length ? refs.map((x) => productLabel(s, x)).join("、") : (it["productScope"]?.value ?? "未明确") },
    { key: "channel", label: "发布渠道", text: platform ? PLATFORM_LABEL[platform] : "未明确" },
    { key: "delivery", label: "交付形式", text: it["deliveryFormat"] ? (FORMAT_LABEL[it["deliveryFormat"].value as keyof typeof FORMAT_LABEL] ?? it["deliveryFormat"].value) + tag(s, "deliveryFormat") : "未明确" },
    { key: "direction", label: "内容方向", text: direction ? `${direction.angle}；拟使用的资料事实：${direction.selected.map((x) => x.field).join("、") || "无"}` : "待资料就绪后确定" },
    { key: "constraints", label: "限制与偏好", text: constraints.join("；") },
  ];

  const directionFp = direction ? directionFingerprint(direction) : "none";
  const requirementFingerprint = reqFingerprint(it);
  const fingerprint = hash({ r: requirementFingerprint, d: directionFp, a: assumptions, v: s.requirementVersion, sn: it["styleNotes"]?.value ?? "", c: constraints });

  const lines = [`需求摘要（v${s.requirementVersion}）`, ...sections.map((x) => `${x.label}：${x.text}${x.key === "audience" && scenario ? `；场景：${SCENARIO_LABEL[scenario] ?? scenario}` : ""}`)];
  if (assumptions.length) lines.push(`采用的默认值与说明：\n- ${assumptions.join("\n- ")}`);
  if (evidenceGaps.length) lines.push(`资料缺口：\n- ${evidenceGaps.join("\n- ")}`);
  if (opts.changeNote) lines.unshift(opts.changeNote);
  if (!r.ready) lines.push(`暂时不能确认，原因：\n- ${r.blockers.join("\n- ")}`);
  else lines.push("请确认以上内容：确认后才会开始生成；也可以修改摘要，或继续讨论。");

  return {
    summaryId: `sm-${s.summaries.length + 1}`,
    requirementVersion: s.requirementVersion,
    fingerprint,
    requirementFingerprint,
    directionFingerprint: directionFp,
    createdAt: at,
    status: "pending",
    confirmable: r.ready,
    blockers: r.blockers,
    sections,
    mode: "marketing" as const,
    assumptions,
    evidenceDigest,
    evidenceGaps,
    contentDirection: direction,
    changeNote: opts.changeNote,
    impact: opts.impact,
    text: lines.join("\n"),
  };
}

function fmt(s: ConversationState, k: keyof typeof KEY_LABEL): string {
  const it = s.items[k];
  if (!it) return "未明确";
  if (k === "deliveryFormat") return FORMAT_LABEL[it.value as keyof typeof FORMAT_LABEL] ?? it.value;
  if (k === "platform") return PLATFORM_LABEL[it.value as Platform] ?? it.value;
  if (k === "scenario") return SCENARIO_LABEL[it.value as Scenario] ?? it.value;
  return it.value;
}

export { topicLabel, topicsOf };


/* ------------------------------ 选购摘要 ------------------------------ */

const VERDICT_LABEL = { unmet_hard: "有硬条件不满足", conditional: "尚有硬条件未确认", fits_confirmed: "已确认的硬条件均满足" } as const;

function assessShoppingReadiness(s: ConversationState): Readiness {
  const blockers: string[] = [];
  if (!s.items["tasks"]) blockers.push("还不知道你主要拿它做什么");
  for (const c of openConflicts(s)) blockers.push(`未解决的矛盾：${c.description}`);
  for (const q of s.questions) if (q.status === "open" && q.blocking) blockers.push(`待回答：${q.prompt}`);
  const ev = latestEvidence(s);
  if (!ev) blockers.push("尚未取得候选资料");
  else if (ev.error) blockers.push(`资料暂时无法读取：${ev.error.message}`);
  return { ready: blockers.length === 0, blockers };
}

function buildShoppingSummary(s: ConversationState, at: string, opts: { changeNote?: string; impact?: ChangeImpact } = {}): Summary {
  const r = assessShoppingReadiness(s);
  const it = s.items;
  const a = buildAssessment(s, s.requirementVersion);
  const line = (k: keyof typeof KEY_LABEL) => (it[k] ? `${it[k]!.value}${tag(s, k)}` : "");
  const sections = [
    { key: "tasks", label: "你主要要做的事", text: line("tasks") || "未明确" },
    { key: "env", label: "使用情况", text: [line("environment"), line("frequency"), it["existingDevices"] ? `已有：${it["existingDevices"].value}` : ""].filter(Boolean).join("；") || "未提到" },
    { key: "hard", label: "必须满足 / 不能接受", text: [line("hardConstraints"), line("requiredSoftware") && `必要软件：${line("requiredSoftware")}`, line("unacceptable") && `不能接受：${line("unacceptable")}`, line("budget") && `预算：${line("budget")}`].filter(Boolean).join("；") || "没有提出硬条件" },
    { key: "pref", label: "偏好与顾虑", text: [line("preferences"), line("concerns") && `顾虑：${line("concerns")}`, line("techQuestions") && `想了解：${line("techQuestions")}`].filter(Boolean).join("；") || "未提到" },
    {
      key: "candidates",
      label: "候选与取舍",
      text: a.noSuitableCandidate
        ? (a.noSuitableReason ?? "暂时没有可确认的合适候选")
        : a.candidates.map((c) => `${c.model}${c.configurationLabel ? `（${c.configurationLabel}）` : ""}：${VERDICT_LABEL[c.verdict]}；${c.explanation}`).join("\n"),
    },
  ];
  const assumptions: string[] = [];
  for (const k of Object.keys(s.items) as (keyof typeof KEY_LABEL)[]) {
    const t = tag(s, k);
    if (t) assumptions.push(`${KEY_LABEL[k]}：${s.items[k]!.value}${t}`);
  }
  for (const c of s.userClaims) assumptions.push(`你提到的${c.kind === "price" ? "价格" : "参数"}「${c.text}」没有资料依据，不会当作产品事实`);
  for (const d of s.decisions) assumptions.push(`已按你的决定处理：${d.decision}`);
  const requirementFingerprint = reqFingerprint(it);
  const aFp = scopeFingerprint(a);
  const fingerprint = hash({ r: requirementFingerprint, a: aFp, v: s.requirementVersion, as: assumptions });
  const text = [
    ...(opts.changeNote ? [opts.changeNote] : []),
    `选购摘要（v${s.requirementVersion}）`,
    ...sections.map((x) => `${x.label}：${x.text}`),
    ...(a.openQuestions.length ? [`尚未确认：\n- ${a.openQuestions.join("\n- ")}`] : []),
    ...(assumptions.length ? [`采用的默认值与说明：\n- ${assumptions.join("\n- ")}`] : []),
    r.ready ? "请确认：确认后会生成个人方案并安排体验场景；也可以修改，或继续讨论。" : `暂时不能确认，原因：\n- ${r.blockers.join("\n- ")}`,
  ].join("\n");
  return {
    summaryId: `sm-${s.summaries.length + 1}`,
    requirementVersion: s.requirementVersion,
    fingerprint,
    requirementFingerprint,
    directionFingerprint: aFp,
    createdAt: at,
    status: "pending",
    confirmable: r.ready,
    blockers: r.blockers,
    sections,
    mode: "shopping",
    assumptions,
    evidenceDigest: a.candidates.flatMap((c) => c.satisfied.slice(0, 2).map((x) => `${c.model}｜${x.text}：${x.evidenceText ?? ""}`)),
    evidenceGaps: a.openQuestions,
    planBasis: { assessmentFingerprint: aFp, candidates: a.candidates.map((c) => ({ key: c.key, model: c.model, verdict: c.verdict })) },
    changeNote: opts.changeNote,
    impact: opts.impact,
    text,
  };
}
