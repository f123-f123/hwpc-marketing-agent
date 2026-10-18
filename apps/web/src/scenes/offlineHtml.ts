import runtime from "virtual:scene-runtime";
import { getScene, lintDefinition, validateConfig, type PersonalPlan } from "@hwpc/scenes";
import css from "./scene.css?inline";

/**
 * 个人 HTML：已注册场景模块（运行时） + 版本化个人方案（数据）。
 * - 运行时来自构建，不含任何模型生成的代码；方案数据以 JSON 内嵌（< 转义，防止提前结束 script）。
 * - 导出前逐项校验：场景存在且版本一致、定义通过静态检查、配置合法。校验不过就不导出，并说明原因。
 * - 不依赖外部网络、本地接口或外部文件。
 */

export interface OfflineExport {
  ok: true;
  filename: string;
  content: string;
}
export type OfflineResult = OfflineExport | { ok: false; problems: string[] };

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
/** 内嵌 JSON：转义 < 防止提前结束 script，并转义 JS 行分隔符。 */
const safeJson = (v: unknown) => JSON.stringify(v).split("<").join("\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029");

export function buildOfflinePlanHtml(plan: PersonalPlan, notices: string[], exportedAt = new Date().toISOString()): OfflineResult {
  const problems: string[] = [];
  for (const e of plan.experiences) {
    const def = getScene(e.sceneId, e.sceneVersion);
    if (!def) {
      problems.push(`场景 ${e.sceneId} v${e.sceneVersion} 不在场景清单中`);
      continue;
    }
    for (const x of lintDefinition(def)) problems.push(`场景 ${e.sceneId}：${x}`);
    for (const x of validateConfig(def, e.config)) problems.push(`场景 ${e.sceneId} 的配置：${x}`);
  }
  if (!plan.experiences.length) problems.push("方案里没有安排任何体验");
  if (problems.length) return { ok: false, problems };

  const payload = { plan, notices, exportedAt };
  const title = `个人体验方案 v${plan.planVersion}${plan.isMock ? "（MOCK）" : ""}`;
  const content = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${css}</style></head><body>
<div id="root"><noscript>需要启用 JavaScript 才能操作场景体验。</noscript></div>
<script>window.__HWPC_PLAN__=${safeJson(payload)};</script>
<script>${runtime.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`;
  return { ok: true, filename: `plan-v${plan.planVersion}${plan.isMock ? "-MOCK" : ""}.html`, content };
}
