/**
 * 前端导出。三种产物明确区分：
 *  1. 赛题四部分报告（场景判断 / 知识库依据 / 图文软文 / 核验结果）：Markdown。
 *  2. 平台发布正文：纯文本，事实限制保留，带版本与状态头。
 *  3. 互动网页：单个自包含 HTML。
 *
 * 导出一律保留：模拟标识、草稿/待确认状态、历史版本标识。不能为了"好看"而删除。
 */
import type { ResultVersion } from "@hwpc/contracts";
import { DELIVERY_LABEL, PLATFORM_LABEL, RESOLUTION_LABEL, ORIGIN_LABEL, checkPlan, factLine, lookupFor } from "./resolve";
import type { InteractivePlan, WorkView } from "./types";

export interface ExportNotice {
  lines: string[];
}

/** 导出时必须带上的状态说明。 */
export function statusNotice(w: WorkView): string[] {
  const rv = w.result;
  const out: string[] = [];
  if (rv.isMock) out.push("【MOCK 模拟数据】内容含模拟资料，非真实华为产品信息，不得发布。");
  if (!w.meta.currentRequirement) out.push(`【历史版本】${w.meta.staleReason ?? "不对应当前需求"}。其核验结论不适用于当前需求。`);
  const ds = rv.verification.deliveryStatus;
  if (ds === "blocked") out.push("【阻止交付】存在未解决的资料冲突或严重问题，不得发布。");
  else if (ds === "needs_confirmation") out.push("【待确认】存在待人工确认的信息，发布前必须处理。");
  return out;
}

function usedFactIds(rv: ResultVersion): string[] {
  const ids: string[] = [];
  for (const b of rv.article.blocks) if (b.type === "paragraph") for (const id of b.factIds) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function buildReportMarkdown(w: WorkView): { filename: string; content: string } {
  const rv = w.result;
  const lk = lookupFor(rv);
  const s = rv.strategy;
  const a = rv.article;
  const out: string[] = [];
  for (const n of statusNotice(w)) out.push(`> ${n}`);
  if (out.length) out.push("");
  out.push(`作品版本：v${w.version}　基于需求第 ${w.meta.requirementVersion || "—"} 版　生成于 ${rv.createdAt}`, "");

  out.push("## 一、场景判断");
  out.push(`- 目标人群：${s.audience}`, `- 使用场景：${s.scenario}${s.scenarioNote ? `（${s.scenarioNote}）` : ""}`);
  out.push(`- 用户问题：${s.userProblems.join("；")}`, `- 内容目标：${s.contentGoal}`, `- 平台：${PLATFORM_LABEL[a.platform]}`, `- 切入点：${s.angle}`, "");

  out.push("## 二、知识库依据");
  out.push(`- 产品型号：${rv.materialPack.products.map((p) => p.model).join("、")}`);
  for (const id of usedFactIds(rv)) {
    const f = lk.fact(id);
    if (f) out.push(`- ${factLine(f)} ——《${f.source.title}》[${ORIGIN_LABEL[f.source.origin]}]`);
  }
  for (const g of rv.materialPack.gaps) out.push(`- 资料缺口：${g}`);
  out.push("");

  out.push("## 三、图文软文");
  out.push(`### ${a.title}`);
  if (a.lead) out.push(a.lead, "");
  for (const b of a.blocks) {
    if (b.type === "paragraph") {
      if (b.heading) out.push(`#### ${b.heading}`);
      out.push(b.text);
      for (const id of b.factIds) {
        const f = lk.fact(id);
        if (f && f.qualifiers.length) out.push(`（限制条件：${f.qualifiers.join("；")}）`);
      }
      out.push("");
    } else {
      const im = lk.image(b.imageId);
      out.push(`[图片] ${im?.description ?? b.imageId}｜来源：${im?.source.title ?? "未知"}｜说明：${b.caption}｜插入位置理由：${b.placementReason}`, "");
    }
  }
  out.push(`行动引导：${a.callToAction}`);
  if (a.tags.length) out.push(`标签：${a.tags.join(" ")}`);
  out.push("");

  out.push("## 四、核验结果");
  out.push(`- 交付状态：${DELIVERY_LABEL[rv.verification.deliveryStatus]}`);
  for (const f of rv.verification.findings) out.push(`- [${f.kind}/${f.severity}] ${f.message}（${RESOLUTION_LABEL[f.resolution]}${f.resolutionNote ? `：${f.resolutionNote}` : ""}）`);
  for (const p of rv.verification.pendingConfirmations) out.push(`- 待确认：${p}`);
  return { filename: `report-v${w.version}${rv.isMock ? "-MOCK" : ""}${w.meta.currentRequirement ? "" : "-历史版本"}.md`, content: out.join("\n") };
}

/** 平台发布正文。正文每段后保留事实限制；顶部状态说明不可省略。 */
export function buildPlatformCopy(w: WorkView): { filename: string; content: string; warnings: string[] } {
  const rv = w.result;
  const lk = lookupFor(rv);
  const a = rv.article;
  const warnings = statusNotice(w);
  const out: string[] = [];
  if (warnings.length) out.push(...warnings.map((x) => `※ ${x}`), "");
  out.push(a.title, "");
  if (a.lead) out.push(a.lead, "");
  let imgNo = 0;
  for (const b of a.blocks) {
    if (b.type === "paragraph") {
      if (b.heading) out.push(b.heading);
      out.push(b.text);
      const qs = b.factIds.flatMap((id) => lk.fact(id)?.qualifiers ?? []);
      if (qs.length) out.push(`（注：${[...new Set(qs)].join("；")}）`);
      out.push("");
    } else {
      imgNo += 1;
      out.push(`【配图${imgNo}：${b.caption}】`, "");
    }
  }
  out.push(a.callToAction);
  if (a.tags.length) out.push("", a.tags.join(" "));
  return { filename: `post-v${w.version}${rv.isMock ? "-MOCK" : ""}.txt`, content: out.join("\n"), warnings };
}

/* ------------------------------------------------------------------ */
/* 互动网页：自包含 HTML                                                */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface HtmlExportResult {
  filename: string;
  content: string;
  skippedStates: { stateId: string; reason: string }[];
  imageCount: number;
  missingImages: string[];
}

/**
 * 生成自包含 HTML。模型内容只以转义文本进入；脚本是本函数固定输出的一小段（展开/切换），
 * 不含任何模型生成的代码。图片以 data URI 内嵌，不依赖本地接口或外部网络。
 * 未经核验或引用缺失的互动状态不写入文件。
 */
export function buildInteractiveHtml(w: WorkView, imageData: Record<string, string>): HtmlExportResult {
  const plan = w.interactive;
  if (!plan) throw new Error("该版本没有互动方案");
  const rv = w.result;
  const lk = lookupFor(rv);
  const chk = checkPlan(plan, rv);
  const notices = statusNotice(w);
  const missing: string[] = [];
  let imageCount = 0;

  const img = (imageId: string): string => {
    const im = lk.image(imageId);
    const data = imageData[imageId];
    if (!im || !data) {
      missing.push(imageId);
      return `<p class="img-missing">图片暂不可用（${esc(imageId)}）</p>`;
    }
    imageCount += 1;
    return `<figure><img src="${data}" alt="${esc(im.description)}"><figcaption>${esc(im.description)}｜来源：${esc(im.source.title)}｜${esc(ORIGIN_LABEL[im.source.origin])}</figcaption></figure>`;
  };
  const factHtml = (id: string) => {
    const f = lk.fact(id);
    if (!f) return "";
    const p = rv.materialPack.products.find((x) => x.productId === f.productId);
    return `<li><b>${esc(f.field)}</b>：${esc(f.value)}${f.qualifiers.length ? `<span class="q">限制：${esc(f.qualifiers.join("；"))}</span>` : ""}<details><summary>查看依据</summary><p>${esc(f.source.title)}｜${esc(ORIGIN_LABEL[f.source.origin])}｜适用：${esc(p?.model ?? "")}${f.configurationIds.length ? "（限部分配置）" : ""}</p></details></li>`;
  };

  const tabs: string[] = [];
  const panels: string[] = [];
  const addPanel = (stateId: string, label: string, body: string) => {
    tabs.push(`<button type="button" role="tab" data-target="${esc(stateId)}">${esc(label)}</button>`);
    panels.push(`<section role="tabpanel" id="${esc(stateId)}" hidden>${body}</section>`);
  };
  for (const s of plan.scenes) {
    if (!chk.renderable.has(s.stateId)) continue;
    const facts = s.items.flatMap((i) => i.factIds);
    const imgs = s.items.flatMap((i) => (i.imageId ? [i.imageId] : []));
    addPanel(s.stateId, `场景：${s.label}`, `<p>${esc(s.why)}</p><ul>${[...new Set(facts)].map(factHtml).join("")}</ul>${imgs.map(img).join("")}`);
  }
  for (const c of plan.claims) {
    if (!chk.renderable.has(c.stateId)) continue;
    addPanel(c.stateId, c.headline, `<ul>${c.factIds.map(factHtml).join("")}</ul>${c.imageIds.map(img).join("")}`);
  }
  if (plan.compare && chk.renderable.has(plan.compare.stateId)) {
    const c = plan.compare;
    const heads = c.productIds.map((id) => `<th>${esc(rv.materialPack.products.find((p) => p.productId === id)?.model ?? id)}</th>`).join("");
    const rows = c.rows
      .map((r) => {
        const cells = r.cells
          .map((cell) => {
            if (!cell.factIds.length) return `<td class="unknown">资料未提供（不视为满足）</td>`;
            return `<td>${cell.factIds.map((id) => { const f = lk.fact(id); return f ? `${esc(f.value)}${f.qualifiers.length ? `<span class="q">${esc(f.qualifiers.join("；"))}</span>` : ""}` : ""; }).join("<br>")}</td>`;
          })
          .join("");
        return `<tr><th scope="row">${esc(r.label)}</th>${cells}</tr>`;
      })
      .join("");
    addPanel(c.stateId, "型号差异", `<table><thead><tr><th></th>${heads}</tr></thead><tbody>${rows}</tbody></table>`);
  }

  const banner = notices.map((n) => `<p class="banner">${esc(n)}</p>`).join("");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.title)}</title>
<style>
body{font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif;margin:0;color:#1d2433;background:#f6f7fb}
main{max-width:760px;margin:0 auto;padding:20px}
.banner{background:#fff3cd;border:1px solid #e0b84a;padding:8px 12px;border-radius:6px;font-weight:600}
[role=tablist]{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
button{font:inherit;padding:8px 14px;border:1px solid #b6bfd3;background:#fff;border-radius:999px;cursor:pointer}
button[aria-selected=true]{background:#1f4fd8;color:#fff;border-color:#1f4fd8}
section{background:#fff;border:1px solid #dde2ee;border-radius:10px;padding:16px}
.q{display:block;color:#8a4b00;font-size:14px}
figure{margin:12px 0}img{max-width:100%;border-radius:8px}figcaption{font-size:13px;color:#55607a}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #dde2ee;padding:8px;text-align:left;vertical-align:top}
.unknown{color:#8a4b00;background:#fff8e6}.img-missing{color:#a33}
footer{font-size:13px;color:#55607a;margin-top:16px}
</style></head><body><main>
<h1>${esc(plan.title)}</h1>${banner}
<p>${esc(plan.intro)}</p>
<div role="tablist">${tabs.join("")}</div>
${panels.join("\n")}
<footer>作品版本 v${w.version}｜基于需求第 ${w.meta.requirementVersion || "—"} 版｜核验状态：${esc(DELIVERY_LABEL[rv.verification.deliveryStatus])}｜本页是互动网页体验，不是平台可直接发布的图文。如需改变选购目标或产品范围，请回到需求沟通重新确认。</footer>
</main>
<script>
(function(){var t=[].slice.call(document.querySelectorAll('[role=tab]')),p=[].slice.call(document.querySelectorAll('[role=tabpanel]'));
function show(id){t.forEach(function(b){b.setAttribute('aria-selected',String(b.getAttribute('data-target')===id))});p.forEach(function(s){s.hidden=s.id!==id})}
t.forEach(function(b){b.addEventListener('click',function(){show(b.getAttribute('data-target'))})});if(t[0])show(t[0].getAttribute('data-target'));})();
</script></body></html>`;
  return {
    filename: `interactive-v${w.version}${rv.isMock ? "-MOCK" : ""}${w.meta.currentRequirement ? "" : "-历史版本"}.html`,
    content: html,
    skippedStates: chk.blocked,
    imageCount,
    missingImages: [...new Set(missing)],
  };
}

export function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function imageToDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`图片读取失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("图片编码失败"));
    r.readAsDataURL(blob);
  });
}

export type { InteractivePlan };
