/**
 * 候选评估（可信推荐）。纯函数，输入需求状态 + 候选事实，输出结构化取舍。
 *
 * 规则：
 *  - 硬条件失败（unmet）→ 结论 unmet_hard，其他卖点不能抵消；
 *  - 未知（资料没有）不计作满足；
 *  - 资料冲突按 conflict 处理，不计作满足也不计作不满足；
 *  - 不产生分数、概率或统一“最佳”，只输出三类结论与逐条依据；
 *  - 没有任何候选达到可推荐（非 unmet_hard）时，如实输出“暂时没有可确认的合适候选”。
 */
import type { FactRecord } from "@hwpc/contracts";
import { METRIC_DEFS, SOFTWARE_NAMES, TASK_PATTERNS, TECH_TERMS, topicLabel } from "./lexicon.js";
import type { Assessment, Candidate, Criterion, CriterionResult, ConversationState, PlanCandidate } from "./types.js";
import { hash, norm } from "./util.js";

const NUM = /(\d+(?:\.\d+)?)/;

function toBase(metric: (typeof METRIC_DEFS)[number]["metric"], n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (metric === "weight_kg") return u === "g" || u === "克" ? n / 1000 : u === "斤" ? n / 2 : n;
  if (metric === "storage_gb") return u === "tb" || u === "t" ? n * 1024 : n;
  return n;
}

/** 从资料原值解析数值。取最保守的那个（“最长”之类的上限值保持原样，不做改写）。 */
export function parseFactNumber(metric: (typeof METRIC_DEFS)[number]["metric"], f: FactRecord): number | undefined {
  const def = METRIC_DEFS.find((d) => d.metric === metric)!;
  const m = f.value.match(def.unit);
  if (m) return toBase(metric, Number(m[1]), m[2]!);
  if (metric === "display_in" || metric === "memory_gb" || metric === "storage_gb") return undefined;
  return undefined;
}

/* ------------------------------ 从需求生成评估标准 ------------------------------ */

const split = (v: string | undefined) => (v ? v.split("；").map((x) => x.trim()).filter(Boolean) : []);

export function deriveCriteria(s: ConversationState): Criterion[] {
  const out: Criterion[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const parseText = (text: string, kind: Criterion["kind"], sourceKey: Criterion["sourceKey"]) => {
    const asLimit = kind === "hard" || kind === "unacceptable";
    let matched = false;
    for (const d of METRIC_DEFS) {
      if (!d.word.test(text) && !d.unit.test(text)) continue;
      const um = text.match(d.unit);
      if (!um) continue;
      const val = toBase(d.metric, Number(um[1]), um[2]!);
      let op: "<=" | ">=" = d.metric === "weight_kg" ? "<=" : ">=";
      if (/不超过|不能超过|不要超过|最多|以内|以下|不高于|低于|小于|轻于/.test(text)) op = "<=";
      if (/至少|不低于|最少|以上|起码|大于|高于|不少于/.test(text)) op = ">=";
      if (kind === "unacceptable") op = d.metric === "weight_kg" ? "<=" : ">=";
      out.push({ criterionId: id("c"), kind, sourceKey, text: `${d.label}${op === "<=" ? "不超过" : "不低于"} ${um[1]}${um[2]}`, rule: { type: "numeric", metric: d.metric, op, value: val } });
      matched = true;
    }
    for (const sw of SOFTWARE_NAMES) {
      if (new RegExp(sw, "i").test(text) && (sourceKey === "requiredSoftware" || /必须|一定|需要|离不开/.test(text))) {
        out.push({ criterionId: id("c"), kind: asLimit ? "hard" : kind, sourceKey, text: `能运行 ${sw}`, rule: { type: "software", name: sw } });
        matched = true;
      }
    }
    if (!matched) {
      // 没有阈值的表达：能识别维度就要求用户补阈值；不能识别则只作为不可评估条件保留（结果只能是 unknown）
      const dim = METRIC_DEFS.find((d) => d.word.test(text) && !/^(?:不|没)/.test(text));
      out.push({
        criterionId: id("c"),
        kind,
        sourceKey,
        text,
        rule: { type: "opaque" },
        needsFromUser: dim ? `「${text}」需要一个具体的数值标准（例如${dim.label}的上限/下限），才能核对资料` : undefined,
      });
    }
  };

  for (const t of split(s.items["hardConstraints"]?.value)) parseText(t, "hard", "hardConstraints");
  for (const t of split(s.items["unacceptable"]?.value)) parseText(t, "unacceptable", "unacceptable");
  for (const t of split(s.items["requiredSoftware"]?.value)) parseText(`必须 ${t}`, "hard", "requiredSoftware");
  if (s.items["budget"]) {
    out.push({
      criterionId: id("c"),
      kind: "hard",
      sourceKey: "budget",
      text: `预算 ${s.items["budget"].value}`,
      rule: { type: "opaque" },
      needsFromUser: undefined,
    });
  }
  for (const t of split(s.items["tasks"]?.value)) {
    const task = TASK_PATTERNS.find((p) => p.re.test(t) || p.label === t);
    out.push({
      criterionId: id("c"),
      kind: "task",
      sourceKey: "tasks",
      text: `任务：${task?.label ?? t}`,
      rule: task ? { type: "keyword", keyword: task.label, categories: task.categories as string[] } : { type: "opaque" },
    });
  }
  for (const t of split(s.items["preferences"]?.value)) parseText(t, "preference", "preferences");
  for (const t of split(s.items["concerns"]?.value)) out.push({ criterionId: id("c"), kind: "concern", sourceKey: "concerns", text: t, rule: { type: "opaque" } });
  for (const t of split(s.items["techQuestions"]?.value)) {
    const tech = TECH_TERMS.find((x) => x.re.test(t));
    out.push({
      criterionId: id("c"),
      kind: "concern",
      sourceKey: "techQuestions",
      text: `想了解：${tech?.label ?? t}`,
      rule: tech ? { type: "keyword", keyword: tech.capabilityKeywords[0]!, categories: ["ecosystem", "selling_point", "os"] } : { type: "opaque" },
    });
  }
  return out;
}

/* ------------------------------ 逐条评估 ------------------------------ */

function factsFor(c: Candidate, configurationId?: string): FactRecord[] {
  return c.facts.filter((f) => f.reviewStatus === "verified" && (f.configurationIds.length === 0 || (configurationId && f.configurationIds.includes(configurationId))));
}
/** 配置专属事实但未选配置：属于“未确认”，不能计入任何结论。 */
function configSpecific(c: Candidate, configurationId?: string): FactRecord[] {
  return c.facts.filter((f) => f.reviewStatus === "verified" && f.configurationIds.length > 0 && !(configurationId && f.configurationIds.includes(configurationId)));
}
const fv = (f: FactRecord) => `${f.field}：${f.value}${f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : ""}`;

export function evaluateCriterion(cr: Criterion, cand: Candidate, configurationId?: string): CriterionResult {
  const facts = factsFor(cand, configurationId);
  const conflicted = new Set(cand.conflicts.filter((x) => x.status === "unresolved").flatMap((x) => x.factIds));
  const base = { criterionId: cr.criterionId };
  const rule = cr.rule;

  if (rule.type === "numeric") {
    const def = METRIC_DEFS.find((d) => d.metric === rule.metric)!;
    const rel = facts.filter((f) => def.cats.includes(f.category) && def.fieldRe.test(f.field));
    const withNum = rel.map((f) => ({ f, n: parseFactNumber(rule.metric, f) })).filter((x): x is { f: FactRecord; n: number } => x.n !== undefined);
    if (!withNum.length) {
      const pending = configSpecific(cand, configurationId).filter((f) => def.cats.includes(f.category) && def.fieldRe.test(f.field));
      return { ...base, status: "unknown", factIds: pending.map((f) => f.factId), note: pending.length ? `「${def.label}」因配置而异，尚未选定配置，无法确认` : `资料中没有可核对的「${def.label}」数值` };
    }
    if (withNum.some((x) => conflicted.has(x.f.factId))) return { ...base, status: "conflict", factIds: withNum.map((x) => x.f.factId), evidenceText: withNum.map((x) => fv(x.f)).join(" ｜ "), note: `「${def.label}」资料存在冲突，不能据此判断` };
    const vals = withNum.map((x) => x.n);
    const ok = rule.op === "<=" ? vals.every((v) => v <= rule.value) : vals.every((v) => v >= rule.value);
    const bad = rule.op === "<=" ? vals.every((v) => v > rule.value) : vals.every((v) => v < rule.value);
    const ids = withNum.map((x) => x.f.factId);
    const ev = withNum.map((x) => fv(x.f)).join(" ｜ ");
    if (ok) return { ...base, status: "satisfied", factIds: ids, evidenceText: ev, note: `资料原值满足「${cr.text}」` };
    if (bad) return { ...base, status: "unmet", factIds: ids, evidenceText: ev, note: `资料原值不满足「${cr.text}」` };
    return { ...base, status: "unknown", factIds: ids, evidenceText: ev, note: `不同条目对「${def.label}」的数值跨越了标准，无法确认` };
  }

  if (rule.type === "software") {
    const hit = facts.filter((f) => new RegExp(rule.name, "i").test(`${f.field} ${f.value} ${f.qualifiers.join(" ")}`));
    const lim = facts.filter((f) => f.category === "limitation" && /软件|兼容/.test(`${f.field} ${f.value}`));
    if (hit.length && !hit.some((f) => f.category === "limitation")) return { ...base, status: "satisfied", factIds: hit.map((f) => f.factId), evidenceText: hit.map(fv).join(" ｜ "), note: `资料明确提到 ${rule.name}` };
    return {
      ...base,
      status: "unknown",
      factIds: [...hit, ...lim].map((f) => f.factId),
      evidenceText: [...hit, ...lim].map(fv).join(" ｜ ") || undefined,
      note: lim.length ? `资料只说明软件兼容需自行确认，没有 ${rule.name} 的明确结论` : `资料中没有 ${rule.name} 的兼容说明`,
    };
  }

  if (rule.type === "keyword") {
    const kw = rule.keyword;
    const directly = facts.filter((f) => `${f.field} ${f.value} ${f.qualifiers.join(" ")}`.includes(kw));
    if (directly.length) {
      if (directly.some((f) => conflicted.has(f.factId))) return { ...base, status: "conflict", factIds: directly.map((f) => f.factId), note: "相关资料存在冲突" };
      return { ...base, status: "satisfied", factIds: directly.map((f) => f.factId), evidenceText: directly.map(fv).join(" ｜ "), note: `资料明确提到「${kw}」` };
    }
    // 任务类：相关类别事实仅“相关”，不等于满足
    const rel = facts.filter((f) => rule.categories.includes(f.category));
    return {
      ...base,
      status: "unknown",
      factIds: rel.map((f) => f.factId),
      evidenceText: rel.length ? rel.slice(0, 3).map(fv).join(" ｜ ") : undefined,
      note: rel.length ? "有相关资料，但资料没有就这项任务给出明确结论，不计作满足" : "资料中没有相关说明",
    };
  }
  return { ...base, status: "unknown", factIds: [], note: cr.kind === "hard" && cr.sourceKey === "budget" ? "资料中没有带有效条件的价格信息，预算无法核对" : "该条件无法用资料直接核对" };
}

export function assessCandidate(s: ConversationState, cand: Candidate, criteria: Criterion[], configurationId?: string, others: Candidate[] = []): PlanCandidate {
  const results = criteria.map((cr) => evaluateCriterion(cr, cand, configurationId));
  const byId = new Map(criteria.map((c) => [c.criterionId, c]));
  const satisfied: PlanCandidate["satisfied"] = [];
  const tradeoffs: PlanCandidate["tradeoffs"] = [];
  const unconfirmed: PlanCandidate["unconfirmed"] = [];
  let unmetHard = false;
  let unknownHard = false;
  for (const r of results) {
    const c = byId.get(r.criterionId)!;
    const isHard = c.kind === "hard" || c.kind === "unacceptable";
    if (r.status === "satisfied") satisfied.push({ criterionId: c.criterionId, text: c.text, evidenceText: r.evidenceText, factIds: r.factIds });
    else if (r.status === "unmet") {
      tradeoffs.push({ criterionId: c.criterionId, text: `${c.text}：${r.note}`, evidenceText: r.evidenceText, factIds: r.factIds });
      if (isHard) unmetHard = true;
    } else {
      unconfirmed.push({ criterionId: c.criterionId, text: c.text, why: r.note });
      if (isHard) unknownHard = true;
    }
  }
  const verdict: PlanCandidate["verdict"] = unmetHard ? "unmet_hard" : unknownHard ? "conditional" : "fits_confirmed";
  const hardCount = criteria.filter((c) => c.kind === "hard" || c.kind === "unacceptable").length;
  const model = cand.model;
  const cfg = cand.configurations.find((c) => c.configurationId === configurationId);

  const differences: PlanCandidate["differences"] = [];
  for (const o of others) {
    if (o.productId === cand.productId) continue;
    for (const cr of criteria) {
      if (cr.rule.type !== "numeric") continue;
      const a = results.find((r) => r.criterionId === cr.criterionId);
      const b = evaluateCriterion(cr, o);
      if (a && a.status !== b.status && (a.status === "satisfied" || a.status === "unmet") && (b.status === "satisfied" || b.status === "unmet")) {
        differences.push({ versus: o.model, criterionId: cr.criterionId, meaning: a.status === "satisfied" ? `在「${cr.text}」上，${model}满足而${o.model}不满足，对你的${labelKind(cr.kind)}更有利` : `在「${cr.text}」上，${model}不满足而${o.model}满足，这是选${model}需要接受的妥协`, factIds: [...a.factIds, ...b.factIds] });
      }
    }
  }
  const explanation =
    verdict === "unmet_hard"
      ? `${model}有硬条件被资料证实不满足（${tradeoffs.filter((t) => byId.get(t.criterionId) && (byId.get(t.criterionId)!.kind === "hard" || byId.get(t.criterionId)!.kind === "unacceptable")).map((t) => byId.get(t.criterionId)!.text).join("、")}），其他优点不能抵消，不建议作为选项。`
      : verdict === "conditional"
        ? `${model}没有被证实不满足硬条件，但还有 ${unconfirmed.filter((u) => { const c = byId.get(u.criterionId); return c && (c.kind === "hard" || c.kind === "unacceptable"); }).length} 项硬条件资料未能确认，暂不能说它适合你。`
        : hardCount === 0
          ? `${model}：你还没有提出硬条件，所以不能判断是否合适；下面只列出资料中查到的情况。`
          : `${model}的资料已证实满足你提出的全部 ${hardCount} 项硬条件${tradeoffs.length ? `，但有 ${tradeoffs.length} 项需要妥协` : ""}${unconfirmed.length ? `；另有 ${unconfirmed.length} 项条件尚未确认` : ""}。`;

  return {
    key: `${cand.productId}${configurationId ? `/${configurationId}` : ""}`,
    productId: cand.productId,
    configurationId,
    model,
    configurationLabel: cfg?.label,
    verdict,
    results,
    satisfied,
    tradeoffs,
    unconfirmed,
    differences,
    explanation,
    origin: cand.origin,
    blocked: false,
  };
}

export function buildAssessment(s: ConversationState, evidenceVersion: number): Assessment {
  const criteria = deriveCriteria(s);
  const considered = s.candidates.filter((c) => c.status !== "rejected" && c.evidenceLoaded);
  const chosenRefs = s.items["productScope"]?.refs ?? [];
  const list: { c: Candidate; cfg?: string }[] = [];
  for (const c of considered) {
    const ref = chosenRefs.find((r) => r.productId === c.productId);
    list.push({ c, cfg: ref?.configurationId });
  }
  const candidates = list.map(({ c, cfg }) => assessCandidate(s, c, criteria, cfg, considered));
  const open: string[] = [];
  for (const cr of criteria) if (cr.needsFromUser) open.push(cr.needsFromUser);
  for (const c of candidates) for (const u of c.unconfirmed) if (!open.includes(`${c.model}：${u.text}（${u.why}）`)) open.push(`${c.model}：${u.text}（${u.why}）`);
  const usable = candidates.filter((c) => c.verdict !== "unmet_hard");
  const noSuitable = candidates.length === 0 || usable.length === 0;
  const fp = hash({ c: criteria.map((x) => [x.kind, x.text]), k: candidates.map((x) => [x.key, x.verdict, x.results.map((r) => r.status)]) });
  return {
    assessmentId: `as-${s.assessments.length + 1}`,
    requirementVersion: evidenceVersion,
    fingerprint: fp,
    criteria,
    candidates,
    noSuitableCandidate: noSuitable,
    noSuitableReason: noSuitable
      ? candidates.length === 0
        ? "资料里没有检索到可评估的候选，暂时没有可确认的合适候选。"
        : "所有候选都有硬条件被资料证实不满足，暂时没有可确认的合适候选。可以放宽条件或缩小范围后再试。"
      : undefined,
    openQuestions: open,
  };
}

export const labelKind = (k: Criterion["kind"]) => ({ hard: "硬条件", task: "任务", preference: "偏好", concern: "顾虑", unacceptable: "不可接受项" })[k];
export { norm, topicLabel };

/** 确认所绑定的评估范围：候选集合 + 各候选对硬条件/不可接受项的结论。偏好、顾虑、任务的变化不改变它（不要求重新确认）。 */
export function scopeFingerprint(a: Assessment): string {
  const hard = new Set(a.criteria.filter((c) => c.kind === "hard" || c.kind === "unacceptable").map((c) => c.criterionId));
  return hash({
    h: a.criteria.filter((c) => hard.has(c.criterionId)).map((c) => [c.kind, c.text]),
    c: a.candidates.map((c) => [c.key, c.verdict, c.results.filter((r) => hard.has(r.criterionId)).map((r) => [r.criterionId, r.status, r.factIds])]),
  });
}
