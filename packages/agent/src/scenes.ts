/**
 * 场景编排：从注册目录选择 sceneId+version，绑定设备/参数，调用能力检查，决定展示方式。
 * 不生成场景代码、HTML 或脚本。
 */
import type { FactRecord } from "@hwpc/contracts";
import { CONCERN_TAGS, TASK_PATTERNS, TECH_TERMS } from "./lexicon.js";
import type {
  Candidate,
  CapabilityChecker,
  CapabilityStatus,
  ConversationState,
  SceneBinding,
  SceneCatalog,
  SceneDefinition,
  SceneInstance,
} from "./types.js";
import { hash, norm } from "./util.js";

export const UNSUPPORTED_DISCLOSURE = "这是通用原理示意，不代表所选型号具备该功能。";
export const FLOW_DISCLOSURE = "功能流程演示：虚拟操作，不证明真实连接成功或设备性能。";
export const DIAGRAM_DISCLOSURE = "原理/参数示意：预设内容，不是实机测试结果。";
export const REAL_TEST_DISCLOSURE = "实机测试结果，仅对所标注的设备与条件有效。";

export const disclosureFor = (mode: SceneDefinition["evidenceMode"]) =>
  mode === "functional_flow_demo" ? FLOW_DISCLOSURE : mode === "principle_diagram" ? DIAGRAM_DISCLOSURE : REAL_TEST_DISCLOSURE;

/* ------------------------------ 需求 → 场景标签 ------------------------------ */

export interface SceneNeed {
  tags: Set<string>;
  tech: string[];
  weights: Map<string, number>;
  /** 用户明确想了解的技术点（techQuestions）。 */
  asked: string[];
}

export function sceneNeeds(s: ConversationState): SceneNeed {
  const tags = new Set<string>();
  const weights = new Map<string, number>();
  const bump = (t: string, w: number) => {
    tags.add(t);
    weights.set(t, (weights.get(t) ?? 0) + w);
  };
  const tasks = s.items["tasks"]?.value ?? "";
  for (const p of TASK_PATTERNS) if (p.re.test(tasks) || tasks.includes(p.label)) p.tags.forEach((t) => bump(t, 2));
  const asked: string[] = [];
  const tech = `${s.items["techQuestions"]?.value ?? ""}；${s.items["concerns"]?.value ?? ""}；${s.items["preferences"]?.value ?? ""}`;
  for (const t of TECH_TERMS) {
    if (t.re.test(tech)) {
      asked.push(t.id);
      t.tags.forEach((x) => bump(x, 3));
    }
  }
  for (const c of CONCERN_TAGS) if (c.re.test(`${s.items["concerns"]?.value ?? ""}`)) c.tags.forEach((x) => bump(x, 1));
  // 已有设备 + 多设备任务 → 协同场景相关
  if (s.items["existingDevices"]) bump("multi_device", 1);
  return { tags, tech: [...new Set(asked)], weights, asked };
}

export function scoreScene(def: SceneDefinition, need: SceneNeed): { score: number; matched: string[] } {
  const matched = def.taskTags.filter((t) => need.tags.has(t));
  return { score: matched.reduce((a, t) => a + (need.weights.get(t) ?? 1), 0), matched };
}

/* ------------------------------ 绑定与参数 ------------------------------ */

const DEVICE_CLASS_RE: Record<SceneDefinition["roles"][number]["deviceClass"], RegExp> = {
  laptop: /笔记本|电脑|MateBook|laptop|旧电脑|旧笔记本/i,
  phone: /手机|iPhone|安卓|Mate\s*\d+|Pura\s*\d+|nova/i,
  tablet: /平板|MatePad|iPad/i,
  display: /显示器|屏幕/,
  accessory: /鼠标|键盘|耳机|手表|打印机|手写笔/,
  other: /./,
};

export function bindRoles(def: SceneDefinition, s: ConversationState, cand: { candidate: Candidate; configurationId?: string } | undefined): { bindings: SceneBinding[]; missing: string[] } {
  const bindings: SceneBinding[] = [];
  const missing: string[] = [];
  const existing = (s.items["existingDevices"]?.value ?? "").split("；").map((x) => x.trim()).filter(Boolean);
  let usedCandidate = false;
  for (const role of def.roles) {
    const exist = existing.find((d) => DEVICE_CLASS_RE[role.deviceClass].test(d));
    if (role.from === "recommended" || (role.from === "either" && !exist && !usedCandidate)) {
      if (cand && role.deviceClass === "laptop" && !usedCandidate) {
        const cfg = cand.candidate.configurations.find((c) => c.configurationId === cand.configurationId);
        bindings.push({ roleId: role.roleId, kind: "candidate", productRef: { productId: cand.candidate.productId, ...(cand.configurationId ? { configurationId: cand.configurationId } : {}) }, label: `${cand.candidate.model}${cfg ? `（${cfg.label}）` : ""}` });
        usedCandidate = true;
        continue;
      }
      if (role.required) missing.push(`${role.label}（需要由推荐的产品担任，当前没有可绑定的候选）`);
      continue;
    }
    if (exist) {
      bindings.push({ roleId: role.roleId, kind: "existing", label: exist });
      continue;
    }
    if (role.required) missing.push(`${role.label}（需要你已有的${role.deviceClass === "phone" ? "手机" : role.deviceClass === "tablet" ? "平板" : "设备"}，目前没有记录）`);
  }
  return { bindings, missing };
}

export function resolveParams(def: SceneDefinition, wanted: Record<string, unknown> = {}): { params: Record<string, string | number | boolean>; rejected: string[] } {
  const params: Record<string, string | number | boolean> = {};
  const rejected: string[] = [];
  for (const p of def.params) {
    const v = wanted[p.name];
    if (v === undefined) {
      params[p.name] = p.default;
      continue;
    }
    let ok = false;
    if (p.type === "enum") ok = typeof v === "string" && (p.allowed ?? []).includes(v);
    else if (p.type === "number") ok = typeof v === "number" && (p.min === undefined || v >= p.min) && (p.max === undefined || v <= p.max);
    else ok = typeof v === "boolean";
    if (ok) params[p.name] = v as string | number | boolean;
    else {
      params[p.name] = p.default;
      rejected.push(`参数 ${p.name} 的取值不在场景允许范围内，已使用默认值`);
    }
  }
  for (const k of Object.keys(wanted)) if (!def.params.some((p) => p.name === k)) rejected.push(`场景没有参数 ${k}，已忽略`);
  return { params, rejected };
}

/* ------------------------------ 能力检查 ------------------------------ */

const CAP_KEYWORDS: Record<string, string[]> = Object.fromEntries(TECH_TERMS.flatMap((t) => [[t.id, t.capabilityKeywords], [t.label, t.capabilityKeywords]]));

/** 兜底：A 未注入检查器时，仅依据已加载的事实做关键词核对。只会给出 supported（有明确说明）或 unknown。 */
export function fallbackCapability(facts: FactRecord[], capabilityId: string): { status: CapabilityStatus; factIds: string[]; note: string } {
  const kws = CAP_KEYWORDS[capabilityId] ?? [capabilityId];
  const hit = facts.filter((f) => f.reviewStatus === "verified" && f.category !== "limitation" && kws.some((k) => `${f.field} ${f.value}`.includes(k)));
  if (hit.length) return { status: "supported", factIds: hit.map((f) => f.factId), note: "资料明确提到该能力" };
  return { status: "unknown", factIds: [], note: "资料中没有明确说明，不视为支持" };
}

export async function checkCapabilities(
  def: SceneDefinition,
  bindings: SceneBinding[],
  s: ConversationState,
  checker: CapabilityChecker | undefined,
  signal?: AbortSignal,
): Promise<SceneInstance["capabilityResults"]> {
  const out: SceneInstance["capabilityResults"] = [];
  for (const cap of def.capabilities) {
    const b = bindings.find((x) => x.roleId === cap.roleId);
    if (!b) {
      out.push({ capabilityId: cap.capabilityId, roleId: cap.roleId, status: "unknown", factIds: [], note: "该角色没有绑定设备" });
      continue;
    }
    // 用户已有设备：我们没有它的资料，不能声称支持
    if (b.kind === "existing" || b.kind === "generic" || !b.productRef) {
      out.push({ capabilityId: cap.capabilityId, roleId: cap.roleId, status: "unknown", factIds: [], note: "这是你自带的设备，没有资料可核对该能力，不视为支持" });
      continue;
    }
    if (checker) {
      try {
        const r = await checker.check({ productRef: b.productRef, capabilityId: cap.capabilityId, signal });
        out.push({ capabilityId: cap.capabilityId, roleId: cap.roleId, status: r.status, factIds: r.factIds, note: r.note });
        continue;
      } catch (e) {
        out.push({ capabilityId: cap.capabilityId, roleId: cap.roleId, status: "unknown", factIds: [], note: `能力检查失败：${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
    }
    const cand = s.candidates.find((c) => c.productId === b.productRef!.productId);
    const r = fallbackCapability(cand?.facts ?? [], cap.capabilityId);
    out.push({ capabilityId: cap.capabilityId, roleId: cap.roleId, status: r.status, factIds: r.factIds, note: r.note });
  }
  return out;
}

/** 能力结论 → 展示方式。unknown / unsupported / conflict 永远不显示为实际支持。 */
export function presentationOf(def: SceneDefinition, results: SceneInstance["capabilityResults"], missingRoles: string[]): { presentation: SceneInstance["presentation"]; disclosures: string[] } {
  const disclosures: string[] = [];
  const allSupported = results.length > 0 && results.every((r) => r.status === "supported");
  if (missingRoles.length) {
    if (def.principleFallback) return { presentation: "principle_only", disclosures: [UNSUPPORTED_DISCLOSURE, `缺少设备：${missingRoles.join("；")}`] };
    return { presentation: "unavailable", disclosures: [`缺少设备：${missingRoles.join("；")}`] };
  }
  if (allSupported) {
    disclosures.push(disclosureFor(def.evidenceMode));
    return { presentation: "device_flow", disclosures };
  }
  const bad = results.filter((r) => r.status !== "supported");
  const why = bad.map((r) => `${r.capabilityId}：${r.status === "unsupported" ? "资料显示不支持" : r.status === "conflict" ? "资料存在冲突" : "资料未说明"}`).join("；");
  if (def.principleFallback) return { presentation: "principle_only", disclosures: [UNSUPPORTED_DISCLOSURE, DIAGRAM_DISCLOSURE, why] };
  return { presentation: "unavailable", disclosures: [`该场景需要的能力未被资料证实：${why}`] };
}

export const signatureOf = (def: SceneDefinition, bindings: SceneBinding[], params: Record<string, unknown>, results: SceneInstance["capabilityResults"]) =>
  hash({
    s: def.sceneId,
    v: def.version,
    b: bindings.map((b) => [b.roleId, b.kind, b.productRef?.productId, b.productRef?.configurationId, b.kind === "existing" ? norm(b.label) : ""]),
    p: params,
    c: results.map((r) => [r.capabilityId, r.status]),
  });

/* ------------------------------ 选择与排序 ------------------------------ */

export interface SceneSelection {
  def: SceneDefinition;
  matched: string[];
  score: number;
  reason: string;
}

/** 按用户任务选场景。同一技术最多选一个；总数有上限；复杂度可被 maxComplexity 限制。 */
export async function selectScenes(
  s: ConversationState,
  catalog: SceneCatalog,
  opts: { limit?: number; maxComplexity?: number; excludeSceneIds?: string[] } = {},
): Promise<SceneSelection[]> {
  const all = await catalog.list();
  const need = sceneNeeds(s);
  const limit = opts.limit ?? 3;
  const ranked = all
    .filter((d) => !(opts.excludeSceneIds ?? []).includes(d.sceneId))
    .filter((d) => (opts.maxComplexity ? d.complexity <= opts.maxComplexity : true))
    .map((d) => ({ d, ...scoreScene(d, need) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.complexity - b.d.complexity || a.d.sceneId.localeCompare(b.d.sceneId));
  const out: SceneSelection[] = [];
  const usedCaps = new Set<string>();
  for (const r of ranked) {
    const caps = r.d.capabilities.map((c) => c.capabilityId);
    // 避免“每项技术都展示一次”：与已选场景完全重叠的技术不再选
    if (caps.length && caps.every((c) => usedCaps.has(c))) continue;
    caps.forEach((c) => usedCaps.add(c));
    out.push({ def: r.d, matched: r.matched, score: r.score, reason: `对应你的需求：${r.matched.join("、")}` });
    if (out.length >= limit) break;
  }
  return out;
}

export function pickBindingCandidate(s: ConversationState): { candidate: Candidate; configurationId?: string } | undefined {
  const ref = s.items["productScope"]?.refs?.[0];
  if (ref) {
    const c = s.candidates.find((x) => x.productId === ref.productId);
    return c ? { candidate: c, configurationId: ref.configurationId } : undefined;
  }
  return undefined;
}
