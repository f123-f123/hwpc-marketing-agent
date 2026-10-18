/**
 * 程序级生成门控。纯函数：只读 ConversationState，返回每一项检查的结果。
 * 服务端应在接收 generate 请求时直接调用 evaluateGate，不依赖前端按钮状态。
 */
import type { Platform } from "@hwpc/contracts";
import { affectedConflicts, findEvidenceGaps, MIN_POINTS, pickDirection, scopeOf } from "./strategy.js";
import { GateResultSchema, type ConversationState, type GateResult, type Summary } from "./types.js";
import { openConflicts, reqFingerprint } from "./state.js";
import { directionFingerprint } from "./strategy.js";
import { norm } from "./util.js";
import { latestEvidence } from "./retrieval.js";
import { modeOf } from "./mode.js";
import { buildAssessment, scopeFingerprint } from "./assess.js";

export const REQUIRED_CRITICAL = ["audience", "scenario", "platform", "productScope", "problem", "goal", "deliveryFormat"] as const;

export const activeSummary = (s: ConversationState): Summary | undefined => [...s.summaries].reverse().find((x) => x.status !== "superseded");

export function evaluateGate(s: ConversationState): GateResult {
  return modeOf(s) === "marketing" ? evaluateMarketingGate(s) : evaluateShoppingGate(s);
}

/** 选购方案门控。只检查与选购相关的内容：不要求渠道、交付形式或营销目标。 */
export function evaluateShoppingGate(s: ConversationState): GateResult {
  const checks: GateResult["checks"] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  add("stage_allows_generation", s.stage === "confirmed" || s.stage === "generating" || s.stage === "delivered" || s.stage === "blocked", `当前阶段：${s.stage}`);
  add("critical_requirements_clear", Boolean(s.items["tasks"]), s.items["tasks"] ? "已知实际任务" : "还不知道你主要拿它做什么");
  const oc = openConflicts(s);
  add("no_open_conflicts", oc.length === 0, oc.length ? `仍有未解决的需求矛盾：${oc.map((c) => c.description).join("；")}` : "无未解决矛盾");

  const sm = activeSummary(s);
  const conf = sm ? s.confirmations.find((c) => c.summaryId === sm.summaryId && c.status === "valid") : undefined;
  let confOk = false;
  let confDetail = "没有有效的用户确认";
  if (sm && conf) {
    const reqFp = reqFingerprint(s.items);
    if (sm.status !== "confirmed") confDetail = "摘要未处于已确认状态";
    else if (conf.requirementVersion !== s.requirementVersion || sm.requirementVersion !== s.requirementVersion) confDetail = `确认对应 v${conf.requirementVersion}，当前需求为 v${s.requirementVersion}`;
    else if (conf.fingerprint !== sm.fingerprint) confDetail = "确认指纹与摘要不一致";
    else if (conf.requirementFingerprint !== reqFp || sm.requirementFingerprint !== reqFp) confDetail = "需求已在确认之后被改动，确认失效";
    else if (!s.audit.some((a) => a.type === "user_confirmed" && a.detail === conf.confirmationId)) confDetail = "确认记录缺少服务端用户操作审计，视为无效";
    else {
      confOk = true;
      confDetail = `确认 ${conf.confirmationId} 绑定 v${conf.requirementVersion}`;
    }
  }
  add("confirmation_matches_current_version", confOk, confDetail);

  const ev = latestEvidence(s);
  const loaded = s.candidates.filter((c) => c.status !== "rejected" && c.evidenceLoaded && c.facts.length > 0);
  let evOk = false;
  let evDetail = "当前需求版本没有证据快照";
  if (ev?.error) evDetail = `资料检索失败：${ev.error.message}`;
  else if (ev && loaded.length === 0) evDetail = "没有取得任何候选的资料，无法形成方案";
  else if (ev) {
    evOk = true;
    evDetail = `证据快照 ${ev.snapshotId} 覆盖 ${loaded.length} 个候选`;
  }
  add("evidence_sufficient", evOk, evDetail);

  // 证据或评估范围相对确认时发生变化：不能借旧确认，需重新确认
  let matchOk = true;
  let matchDetail = "评估范围与确认一致";
  if (sm?.planBasis && evOk) {
    const fresh = scopeFingerprint(buildAssessment(s, s.requirementVersion));
    if (fresh !== sm.planBasis.assessmentFingerprint) {
      matchOk = false;
      matchDetail = "资料或评估结论相对确认时发生了变化（候选满足情况有变），需要重新确认";
    }
  } else if (!sm?.planBasis) {
    matchOk = false;
    matchDetail = "确认的摘要缺少评估范围";
  }
  add("evidence_matches_confirmation", matchOk, matchDetail);
  const conflicts = loaded.flatMap((c) => c.conflicts.filter((x) => x.status === "unresolved").map((x) => `${c.model}·${x.field}`));
  add("no_blocking_material_conflict", true, conflicts.length ? `资料冲突只影响相关条件，不能计作满足：${conflicts.join("、")}` : "无资料冲突");

  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  let returnTo: GateResult["returnTo"] = "none";
  if (failed.length) {
    if (failed.every((f) => f === "evidence_matches_confirmation" || f === "confirmation_matches_current_version")) returnTo = "awaiting_confirmation";
    else if (failed.includes("evidence_sufficient")) returnTo = "discuss_evidence_gap";
    else returnTo = "collecting";
  }
  return GateResultSchema.parse({ allowed: failed.length === 0, checks, failed, returnTo });
}

export function evaluateMarketingGate(s: ConversationState): GateResult {
  const checks: GateResult["checks"] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });

  // 1 阶段
  add("stage_allows_generation", s.stage === "confirmed" || s.stage === "generating" || s.stage === "delivered" || s.stage === "blocked", `当前阶段：${s.stage}`);

  // 2 关键需求
  const missing = REQUIRED_CRITICAL.filter((k) => !s.items[k]);
  const noRefs = !s.items["productScope"]?.refs?.length;
  add(
    "critical_requirements_clear",
    missing.length === 0 && !noRefs,
    missing.length ? `缺少关键需求：${missing.join("、")}` : noRefs ? "产品范围尚未落到具体型号" : "关键需求已明确",
  );

  // 3 冲突
  const oc = openConflicts(s);
  add("no_open_conflicts", oc.length === 0, oc.length ? `仍有未解决的需求矛盾：${oc.map((c) => c.description).join("；")}` : "无未解决矛盾");

  // 4 确认绑定当前版本
  const sm = activeSummary(s);
  const conf = sm ? s.confirmations.find((c) => c.summaryId === sm.summaryId && c.status === "valid") : undefined;
  let confOk = false;
  let confDetail = "没有有效的用户确认";
  if (sm && conf) {
    const reqFp = reqFingerprint(s.items);
    if (sm.status !== "confirmed") confDetail = "摘要未处于已确认状态";
    else if (conf.requirementVersion !== s.requirementVersion || sm.requirementVersion !== s.requirementVersion) confDetail = `确认对应 v${conf.requirementVersion}，当前需求为 v${s.requirementVersion}`;
    else if (conf.fingerprint !== sm.fingerprint) confDetail = "确认指纹与摘要不一致";
    else if (conf.requirementFingerprint !== reqFp || sm.requirementFingerprint !== reqFp) confDetail = "需求已在确认之后被改动，确认失效";
    else if (sm.contentDirection && directionFingerprint(sm.contentDirection) !== sm.directionFingerprint) confDetail = "内容方向与确认时不一致";
    else if (!s.audit.some((a) => a.type === "user_confirmed" && a.detail === conf.confirmationId)) confDetail = "确认记录缺少服务端用户操作审计，视为无效";
    else {
      confOk = true;
      confDetail = `确认 ${conf.confirmationId} 绑定 v${conf.requirementVersion}`;
    }
  }
  add("confirmation_matches_current_version", confOk, confDetail);

  // 5/6 证据
  const ev = latestEvidence(s);
  const pack = ev?.pack ?? null;
  const platform = s.items["platform"]?.value as Platform | undefined;
  let evOk = false;
  let evDetail = "当前需求版本没有证据快照";
  if (ev?.error) evDetail = `资料检索失败：${ev.error.message}`;
  else if (pack && sm?.contentDirection) {
    const scope = scopeOf(s);
    const byId = new Map(pack.facts.map((f) => [f.factId, f]));
    const confirmed = sm.contentDirection.selected;
    const confirmedIds = new Set(confirmed.map((x) => x.factId));
    const fresh = pickDirection(pack, s);
    // 已确认的事实必须仍在资料里且取值未变（否则方向变了，要回到沟通/重新确认）
    const lost = confirmed.filter((x) => norm(byId.get(x.factId)?.value ?? "") !== norm(x.value));
    // 最新资料带来了确认时没有的事实（方向变宽），同样不能借原确认
    const extra = fresh.selected.filter((x) => !confirmedIds.has(x.factId));
    const gaps = findEvidenceGaps(pack, s);
    const covered = scope.refs.every((r) => pack.products.some((p) => p.productId === r.productId));
    const min = platform ? MIN_POINTS[platform] : 1;
    if (!covered) evDetail = "证据未覆盖所选产品";
    else if (lost.length) evDetail = `已确认的事实在最新资料中缺失或取值变化：${lost.map((x) => x.factId).join("、")}，需重新确认`;
    else if (extra.length) evDetail = `最新资料使内容方向新增了 ${extra.map((x) => x.factId).join("、")}，需重新确认`;
    else if (fresh.selected.length < min) evDetail = `可用事实仅 ${fresh.selected.length} 条，少于该渠道所需的 ${min} 条`;
    else if (gaps.length) evDetail = gaps.map((g) => g.text).join("；");
    else {
      evOk = true;
      evDetail = `证据快照 ${ev?.snapshotId} 覆盖 ${fresh.selected.length} 条待用事实`;
    }
  }
  add("evidence_sufficient", evOk, evDetail);

  let cfOk = true;
  let cfDetail = "无阻止交付的资料冲突";
  if (pack) {
    const bad = affectedConflicts(pack, s);
    if (bad.length) {
      cfOk = false;
      cfDetail = `资料冲突未处理：${bad.map((c) => `${c.field}（${c.description}）`).join("；")}`;
    }
  } else cfOk = false, (cfDetail = "尚无资料可检查冲突");
  add("no_blocking_material_conflict", cfOk, cfDetail);

  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  let returnTo: GateResult["returnTo"] = "none";
  if (failed.length) {
    if (failed.includes("no_blocking_material_conflict") && pack) returnTo = "resolve_material_conflict";
    else if (failed.includes("evidence_sufficient") && (pack || ev?.error)) returnTo = "discuss_evidence_gap";
    else if (failed.includes("confirmation_matches_current_version") && !failed.includes("critical_requirements_clear") && !failed.includes("no_open_conflicts")) returnTo = "awaiting_confirmation";
    else returnTo = "collecting";
  }
  return GateResultSchema.parse({ allowed: failed.length === 0, checks, failed, returnTo });
}
