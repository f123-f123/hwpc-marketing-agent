/**
 * 只读恢复包的 HTML 呈现。
 *
 * 这是给人看的“方案快照”，不是可交互的离线体验包：
 * 页内没有脚本、没有场景运行时，也不写回任何会话。
 * 交互式个人页面（复用场景模块与本地进度）尚未接入，这里不假装已经具备。
 */
import type { RecoveryPack } from "@hwpc/contracts";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ESC[c]!);

const COMPLETION_LABEL: Record<string, string> = {
  not_started: "尚未开始",
  in_progress: "体验中",
  walkthrough_completed: "已走完流程（非硬件实测）",
};
const OVERALL_LABEL: Record<string, string> = {
  fits: "适合",
  fits_with_compromise: "有取舍",
  not_fit: "不适合",
  insufficient_evidence: "证据不足",
};
const STATUS_LABEL: Record<string, string> = { current: "当前方案", superseded: "已被取代", stale: "已过期" };
const NEED_STATUS_LABEL: Record<string, string> = { known: "用户明说", inferred: "系统推断", default: "系统默认", pending: "待确认" };

export function renderRecoveryHtml(pack: RecoveryPack): string {
  const p = pack.payload;
  const plan = p.plan;
  const defs = new Map(p.sceneDefinitions.map((d) => [`${d.sceneId}@${d.version}`, d]));
  const exps = new Map(p.experiences.map((e) => [e.instanceId, e]));

  const candidates = plan.candidates
    .map((c) => {
      const rows = (label: string, list: { text: string }[]) => (list.length ? `<p><strong>${esc(label)}：</strong>${list.map((x) => esc(x.text)).join("；")}</p>` : "");
      return `<article><h3>${esc(c.modelName)} <small>${esc(OVERALL_LABEL[c.overall] ?? c.overall)}</small></h3>
        <p>${esc(c.comparisonReason)}</p>
        ${rows("满足", c.satisfied)}${rows("不满足", c.unmet)}${rows("需要妥协", c.compromises)}${rows("尚未确认（不视为满足）", c.unknowns)}
      </article>`;
    })
    .join("");

  const scenes = plan.scenes
    .map((s) => {
      const inst = p.instances.find((i) => i.instanceId === s.instanceId);
      const def = defs.get(`${s.sceneId}@${s.sceneVersion}`);
      const exp = exps.get(s.instanceId);
      const state = def?.states.find((x) => x.stateId === exp?.currentStateId)?.label ?? exp?.currentStateId ?? "—";
      return `<li><strong>${esc(def?.title ?? s.sceneId)} v${s.sceneVersion}</strong>
        <div class="muted">为什么安排：${esc(s.reason)}</div>
        <div>进度：${esc(state)} · ${esc(COMPLETION_LABEL[exp?.completion ?? "not_started"] ?? exp?.completion ?? "")}</div>
        <div class="muted">演示边界：${esc(def?.demoBoundary.statement ?? "—")}</div>
        <div class="muted">适用性：${esc(inst?.applicability.result ?? "—")}${inst?.applicability.presentAsAvailable ? "" : "（不作为可用功能宣称）"}</div>
      </li>`;
    })
    .join("");

  const needs = p.need.record.entries
    .map((e) => `<li>${esc(e.value)} <small class="muted">${esc(NEED_STATUS_LABEL[e.status] ?? e.status)}${e.hard ? " · 硬条件" : ""}</small></li>`)
    .join("");

  const caps = p.capabilities.declarations
    .map((d) => `<li><strong>${esc(d.id)}</strong>：${esc(d.status)} — ${esc(d.statement)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>只读恢复包 · 个人方案 v${plan.version}${p.isMock ? "（MOCK）" : ""}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px;line-height:1.6;color:#1f2430;background:#f6f7fb}
  main{max-width:860px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #e6e9f2;padding-bottom:6px}
  h3{font-size:14px;margin:12px 0 4px} .muted{color:#697089;font-size:13px} .banner{background:#fff6e5;border:1px solid #ffd591;border-radius:8px;padding:10px 12px;margin:12px 0}
  .mock{background:#ffece8;border-color:#ffb3a7} ul{padding-left:20px} article{border:1px solid #e6e9f2;border-radius:8px;padding:8px 12px;margin:8px 0}
  small{font-weight:400;color:#697089} footer{margin-top:24px;color:#697089;font-size:12px}
</style></head><body><main>
<div class="banner"><strong>只读副本</strong>：这是导出时的方案快照，接收方看到的是独立副本，改动不会同步回原会话，也不能修改原顾客方案。</div>
<h1>个人方案 v${plan.version}${p.isMock ? "（MOCK）" : ""}</h1>
<div class="muted">来源会话 ${esc(p.origin.sessionId)} · 导出时间 ${esc(p.origin.exportedAt)} · 会话 revision ${p.origin.sessionRevision}</div>
<div class="muted">需求 v${plan.needVersion} · 方案状态：${esc(STATUS_LABEL[plan.status] ?? plan.status)} · 核验：${plan.verification.ok ? "通过" : "未通过"}${p.freshness.needsReview ? " · 待复核" : ""}</div>

<h2>需求摘要（导出时已确认的版本）</h2>
<ul>${needs || "<li>（无）</li>"}</ul>

<h2>候选与取舍</h2>
${candidates || "<p class=\"muted\">没有候选。</p>"}

<h2>体验顺序</h2>
<ol>${scenes || "<li>没有安排体验。</li>"}</ol>

<h2>必要说明</h2>
<ul>${p.notices.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>

<h2>能力声明</h2>
<ul>${caps}</ul>

<footer>这不是可交互的离线体验包：页面不含场景运行时，也不会记录新的体验进度。交互式个人页面尚未接入。</footer>
</main></body></html>`;
}
