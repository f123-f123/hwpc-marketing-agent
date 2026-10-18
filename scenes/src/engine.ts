/**
 * 场景运行引擎：纯函数、无框架依赖、无计时器、无随机数。
 * 同一份引擎被工作台界面和导出的个人 HTML 共同使用。
 *
 * 不变量（测试覆盖）：
 *  - 状态只因用户动作改变；重放同一份历史得到同一个结果（可恢复、可校验）。
 *  - 设备能力未被证据证实为 yes 时，动作不可执行，不会走到成功结局。
 *  - 保存记录与场景版本/状态版本不兼容时拒绝套用，不静默改变历史方案。
 */
import {
  CAPABILITY_EVIDENCE_LEVELS,
  type ActionDef,
  type CapabilityValue,
  type Condition,
  type DeviceBinding,
  type EvidenceItem,
  type Expr,
  type HistoryEntry,
  type SavedRun,
  type SceneConfig,
  type SceneDefinition,
  type SceneRun,
  type SceneView,
  type ViewAction,
} from "./types";

/* ------------------------------ 表达式 ------------------------------ */

interface Ctx {
  state: Record<string, string | boolean>;
  param?: string;
  cap: (role: string, cap: string) => CapabilityValue;
  bound: (role: string) => boolean;
}

type Val = string | boolean | number | null;

function evalExpr(e: Expr, c: Ctx): Val {
  if (e === null || typeof e !== "object") return e;
  if ("ref" in e) {
    const r = e.ref;
    if (r === "param") return c.param ?? null;
    if (r.startsWith("state.")) return c.state[r.slice(6)] ?? null;
    if (r.startsWith("cap.")) {
      const [, role, cap] = r.split(".");
      return c.cap(role ?? "", cap ?? "");
    }
    if (r.startsWith("bound.")) return c.bound(r.slice(6));
    return null;
  }
  const a = e.args.map((x) => evalExpr(x, c));
  switch (e.op) {
    case "eq": return a[0] === a[1];
    case "ne": return a[0] !== a[1];
    case "and": return a.every(Boolean);
    case "or": return a.some(Boolean);
    case "not": return !a[0];
    case "in": return a.slice(1).includes(a[0] as Val);
    case "gt": return Number(a[0]) > Number(a[1]);
    case "lt": return Number(a[0]) < Number(a[1]);
  }
}
const truthy = (e: Expr | undefined, c: Ctx) => (e === undefined ? true : Boolean(evalExpr(e, c)));

/** 收集表达式里的引用，供静态检查使用。 */
export function collectRefs(e: Expr, out: string[] = []): string[] {
  if (e && typeof e === "object") {
    if ("ref" in e) out.push(e.ref);
    else e.args.forEach((x) => collectRefs(x, out));
  }
  return out;
}

/* ------------------------------ 配置校验 ------------------------------ */

export function validateConfig(def: SceneDefinition, config: SceneConfig): string[] {
  const errs: string[] = [];
  if (config.sceneId !== def.sceneId) errs.push(`配置的场景 ${config.sceneId} 与定义 ${def.sceneId} 不一致`);
  if (config.sceneVersion !== def.version) errs.push(`配置面向场景版本 ${config.sceneVersion}，定义是版本 ${def.version}`);
  const evidence = new Map(config.evidence.map((x) => [x.evidenceId, x]));
  const roleIds = new Set(def.deviceRoles.map((r) => r.roleId));
  const capIds = new Set(def.capabilities.map((c) => `${c.roleId}.${c.capId}`));
  const seen = new Set<string>();
  for (const b of config.bindings) {
    if (seen.has(b.bindingId)) errs.push(`重复的设备绑定 ${b.bindingId}`);
    seen.add(b.bindingId);
    if (!roleIds.has(b.roleId)) errs.push(`设备 ${b.bindingId} 的角色 ${b.roleId} 不在场景中`);
    if (b.source === "simulated") {
      const p = def.simulatedPresets.find((x) => x.presetId === b.presetId && x.roleId === b.roleId);
      if (!p) errs.push(`模拟设备 ${b.bindingId} 没有对应的预设`);
      else
        for (const [cap, v] of Object.entries(p.capabilities))
          if (b.capabilities[cap]?.value !== v) errs.push(`模拟设备 ${b.bindingId} 的能力 ${cap} 与预设不一致`);
    } else if (!b.productRef) errs.push(`产品设备 ${b.bindingId} 缺少 productRef`);
    for (const [cap, rec] of Object.entries(b.capabilities)) {
      if (!capIds.has(`${b.roleId}.${cap}`)) errs.push(`设备 ${b.bindingId} 声明了场景未定义的能力 ${cap}`);
      for (const id of rec.evidenceIds) if (!evidence.has(id)) errs.push(`设备 ${b.bindingId} 引用了不存在的证据 ${id}`);
    }
  }
  for (const r of def.deviceRoles) if (!config.bindings.some((b) => b.roleId === r.roleId)) errs.push(`角色 ${r.roleId} 没有可选设备`);
  return errs;
}

/** 能力的有效取值：yes/no 必须有可作为能力依据的证据；模拟设备按预设计。 */
export function effectiveCap(b: DeviceBinding | undefined, cap: string, evidence: Map<string, EvidenceItem>): { value: CapabilityValue; evidence: EvidenceItem[] } {
  if (!b) return { value: "unknown", evidence: [] };
  const rec = b.capabilities[cap];
  if (!rec) return { value: "unknown", evidence: [] };
  const ev = rec.evidenceIds.map((id) => evidence.get(id)).filter((x): x is EvidenceItem => !!x);
  if (rec.value === "unknown") return { value: "unknown", evidence: ev };
  if (b.source === "simulated") return { value: rec.value, evidence: ev };
  const ok = ev.some((x) => CAPABILITY_EVIDENCE_LEVELS.includes(x.level));
  return { value: ok ? rec.value : "unknown", evidence: ev };
}

/* ------------------------------ 运行 ------------------------------ */

function ctxFor(def: SceneDefinition, config: SceneConfig, run: SceneRun, param?: string): Ctx {
  const ev = new Map(config.evidence.map((x) => [x.evidenceId, x]));
  const bindingOf = (role: string) => config.bindings.find((b) => b.bindingId === run.bindings[role]);
  return {
    state: run.state,
    param,
    cap: (role, cap) => effectiveCap(bindingOf(role), cap, ev).value,
    bound: (role) => !!run.bindings[role],
  };
}

export function initialState(def: SceneDefinition, config: SceneConfig): Record<string, string | boolean> {
  const s: Record<string, string | boolean> = {};
  for (const v of def.stateVars) s[v.key] = v.initial;
  for (const [k, val] of Object.entries(config.initial ?? {})) {
    const decl = def.stateVars.find((v) => v.key === k);
    if (decl?.virtualEnv) s[k] = val;
  }
  return s;
}

export function createRun(def: SceneDefinition, config: SceneConfig): SceneRun {
  return { bindings: {}, state: initialState(def, config), history: [], lastFeedback: [] };
}

type Applicability = { kind: "pending" | "applicable" | "not_applicable" | "unverified"; reasons: string[]; nextSteps: string[] };

function capConditions(def: SceneDefinition): Extract<Condition, { kind: "capability" }>[] {
  return def.conditions.filter((c): c is Extract<Condition, { kind: "capability" }> => c.kind === "capability");
}

export function applicability(def: SceneDefinition, config: SceneConfig, run: SceneRun): Applicability {
  const missingRole = def.deviceRoles.filter((r) => !run.bindings[r.roleId]);
  if (missingRole.length) return { kind: "pending", reasons: [`还需要选择：${missingRole.map((r) => r.label).join("、")}`], nextSteps: [] };
  const c = ctxFor(def, config, run);
  const unmet: string[] = [];
  const unknown: string[] = [];
  const steps: string[] = [];
  for (const cond of capConditions(def)) {
    const v = c.cap(cond.role, cond.cap);
    if (v === "no") (unmet.push(`${cond.label}：${cond.onUnmet.missing}`), steps.push(cond.onUnmet.nextStep));
    else if (v === "unknown") (unknown.push(`${cond.label}：${cond.onUnknown.missing}`), steps.push(cond.onUnknown.nextStep));
  }
  if (unmet.length) return { kind: "not_applicable", reasons: unmet, nextSteps: [...new Set(steps)] };
  if (unknown.length) return { kind: "unverified", reasons: unknown, nextSteps: [...new Set(steps)] };
  return { kind: "applicable", reasons: [], nextSteps: [] };
}

function actionStatus(def: SceneDefinition, config: SceneConfig, run: SceneRun, a: ActionDef, param?: string): { enabled: boolean; reason?: string; nextStep?: string } {
  const app = applicability(def, config, run);
  if (app.kind === "pending") return { enabled: false, reason: app.reasons[0] };
  if (app.kind === "not_applicable") return { enabled: false, reason: "当前设备组合不满足这个功能的条件，所以不能继续演示。", nextStep: app.nextSteps[0] };
  if (app.kind === "unverified") return { enabled: false, reason: "资料没有证实当前设备具备所需条件，不能把它演示成可用。", nextStep: app.nextSteps[0] };
  const c = ctxFor(def, config, run, param);
  for (const id of a.requires ?? []) {
    const cond = def.conditions.find((x) => x.condId === id);
    if (cond?.kind === "state" && !truthy(cond.expr, c)) return { enabled: false, reason: cond.onUnmet.missing, nextStep: cond.onUnmet.nextStep };
  }
  if (a.guard && !truthy(a.guard, c)) return { enabled: false, reason: a.blockedReason ?? "当前状态下这一步不可用" };
  return { enabled: true };
}

export interface StepResult {
  ok: boolean;
  run: SceneRun;
  reason?: string;
}

/** 执行一条历史项；非法项返回 ok=false，不改变 run。 */
export function applyEntry(def: SceneDefinition, config: SceneConfig, run: SceneRun, entry: HistoryEntry): StepResult {
  if (entry.type === "bind") {
    const b = config.bindings.find((x) => x.bindingId === entry.bindingId && x.roleId === entry.roleId);
    if (!b) return { ok: false, run, reason: `设备 ${entry.bindingId} 不属于角色 ${entry.roleId}` };
    if (run.bindings[entry.roleId] === entry.bindingId) return { ok: true, run };
    // 换设备等于重新开始一次尝试：保留其它角色的选择，清除之前的操作与结果。
    const keep = run.history.filter((h): h is Extract<HistoryEntry, { type: "bind" }> => h.type === "bind" && h.roleId !== entry.roleId);
    const bindings = { ...run.bindings, [entry.roleId]: entry.bindingId };
    return { ok: true, run: { bindings, state: initialState(def, config), history: [...keep, entry], lastFeedback: [] } };
  }
  const a = def.actions.find((x) => x.actionId === entry.actionId);
  if (!a) return { ok: false, run, reason: `场景没有动作 ${entry.actionId}` };
  if (a.options && !a.options.some((o) => o.value === entry.param)) return { ok: false, run, reason: `动作 ${a.actionId} 的参数 ${entry.param ?? ""} 不合法` };
  const st = actionStatus(def, config, run, a, entry.param);
  if (!st.enabled) return { ok: false, run, reason: st.reason };
  const c = ctxFor(def, config, run, entry.param);
  const state = { ...run.state };
  for (const ef of a.effects) if (truthy(ef.when, c)) state[ef.key] = evalExpr(ef.value, c) as string | boolean;
  const next: SceneRun = { ...run, state, history: [...run.history, entry], lastFeedback: [] };
  const c2 = ctxFor(def, config, next, entry.param);
  next.lastFeedback = a.feedback.filter((f) => truthy(f.when, c2)).map((f) => ({ tone: f.tone, text: f.text }));
  return { ok: true, run: next };
}

export function replay(def: SceneDefinition, config: SceneConfig, history: HistoryEntry[]): { run: SceneRun; error?: string } {
  let run = createRun(def, config);
  for (const h of history) {
    const r = applyEntry(def, config, run, h);
    if (!r.ok) return { run, error: r.reason ?? "记录与当前场景不兼容" };
    run = r.run;
  }
  return { run };
}

/* ------------------------------ 保存与恢复 ------------------------------ */

export function toSaved(def: SceneDefinition, run: SceneRun, at: string): SavedRun {
  return { sceneId: def.sceneId, sceneVersion: def.version, stateVersion: def.persistence.stateVersion, history: run.history, updatedAt: at };
}

export type RestoreResult = { ok: true; run: SceneRun } | { ok: false; reason: string; code: "scene_mismatch" | "version_mismatch" | "state_version_unsupported" | "replay_failed" };

/** 恢复：只接受同一场景同一版本、且状态版本兼容的记录；其余一律拒绝，由调用方决定如何呈现。 */
export function restore(def: SceneDefinition, config: SceneConfig, saved: SavedRun): RestoreResult {
  if (saved.sceneId !== def.sceneId) return { ok: false, code: "scene_mismatch", reason: "保存记录属于另一个场景" };
  if (saved.sceneVersion !== def.version)
    return { ok: false, code: "version_mismatch", reason: `保存记录来自场景版本 ${saved.sceneVersion}，当前为 ${def.version}，不会静默套用` };
  if (saved.stateVersion !== def.persistence.stateVersion && !def.persistence.accepts.includes(saved.stateVersion))
    return { ok: false, code: "state_version_unsupported", reason: `不支持的状态版本 ${saved.stateVersion}` };
  const r = replay(def, config, saved.history);
  if (r.error) return { ok: false, code: "replay_failed", reason: `记录无法按当前场景重放：${r.error}` };
  return { ok: true, run: r.run };
}

/* ------------------------------ 视图 ------------------------------ */

const DEMO_LABEL = {
  flow_demo: "功能流程演示",
  principle_illustration: "原理 / 参数示意",
  measured_test: "实机测试",
} as const;

export function buildView(def: SceneDefinition, config: SceneConfig, run: SceneRun): SceneView {
  const ev = new Map(config.evidence.map((x) => [x.evidenceId, x]));
  const c = ctxFor(def, config, run);
  const app = applicability(def, config, run);

  const roles = def.deviceRoles.map((r) => ({
    roleId: r.roleId,
    label: r.label,
    chosen: run.bindings[r.roleId],
    options: config.bindings
      .filter((b) => b.roleId === r.roleId)
      .map((b) => ({
        bindingId: b.bindingId,
        label: b.label,
        source: b.source,
        sourceLabel: b.source === "simulated" ? "虚拟示意设备（非真实型号）" : "候选产品（能力以资料证据为准）",
        caps: def.capabilities
          .filter((cp) => cp.roleId === r.roleId)
          .map((cp) => {
            const e = effectiveCap(b, cp.capId, ev);
            return { capId: cp.capId, label: cp.label, value: e.value, evidenceTitles: e.evidence.map((x) => x.title) };
          }),
      })),
  }));

  const conditions = def.conditions.map((cond) => {
    if (cond.kind === "capability") {
      const b = config.bindings.find((x) => x.bindingId === run.bindings[cond.role]);
      if (!b) return { condId: cond.condId, label: cond.label, kind: "capability" as const, status: "pending" as const };
      const e = effectiveCap(b, cond.cap, ev);
      const status = e.value === "yes" ? ("met" as const) : e.value === "no" ? ("unmet" as const) : ("unknown" as const);
      const miss = status === "unmet" ? cond.onUnmet : status === "unknown" ? cond.onUnknown : undefined;
      return { condId: cond.condId, label: cond.label, kind: "capability" as const, status, missing: miss?.missing, nextStep: miss?.nextStep, evidenceTitles: e.evidence.map((x) => x.title) };
    }
    const met = app.kind === "pending" ? false : truthy(cond.expr, c);
    return {
      condId: cond.condId,
      label: cond.label,
      kind: "state" as const,
      status: app.kind === "pending" ? ("pending" as const) : met ? ("met" as const) : ("unmet" as const),
      missing: met ? undefined : cond.onUnmet.missing,
      nextStep: met ? undefined : cond.onUnmet.nextStep,
    };
  });

  const actions: ViewAction[] = def.actions.map((a) => {
    const st = actionStatus(def, config, run, a);
    return {
      actionId: a.actionId,
      label: a.label,
      hint: a.hint,
      options: a.options,
      enabled: st.enabled,
      blocked: st.enabled ? undefined : { reason: st.reason ?? "", nextStep: st.nextStep },
    };
  });

  const screens = def.stage.screens.map((s) => ({
    screenId: s.screenId,
    label: s.label,
    items: s.items.filter((i) => truthy(i.when, c)).map((i) => ({ itemId: i.itemId, label: i.label, tone: i.tone ?? "neutral" })),
    notes: (s.notes ?? []).filter((n) => truthy(n.when, c)).map((n) => n.text),
  }));

  let outcome: SceneView["outcome"] = { kind: "in_progress", title: "进行中", text: "按左侧动作继续操作，观察状态变化。", nextSteps: [], checklist: [] };
  if (app.kind === "pending") outcome = { kind: "pending", title: "先选择设备", text: app.reasons.join("；"), nextSteps: [], checklist: [] };
  else if (app.kind === "not_applicable")
    outcome = { kind: "not_applicable", title: "当前设备组合不适用", text: app.reasons.join("；"), nextSteps: app.nextSteps, checklist: [] };
  else if (app.kind === "unverified")
    outcome = { kind: "unverified", title: "资料尚未证实，不能演示为可用", text: app.reasons.join("；"), nextSteps: app.nextSteps, checklist: [] };
  else {
    const failed = def.failures.find((f) => truthy(f.when, c));
    if (failed) outcome = { kind: "failed", title: failed.title, text: failed.text, nextSteps: failed.nextSteps ?? [], checklist: [] };
    else if (truthy(def.completion.when, c))
      outcome = { kind: "completed", title: def.completion.title, text: def.completion.text, nextSteps: def.completion.nextSteps ?? [], checklist: def.realWorldChecklist };
  }

  const evidenceUsed = new Map<string, EvidenceItem>();
  for (const id of Object.values(run.bindings)) {
    const b = config.bindings.find((x) => x.bindingId === id);
    for (const rec of Object.values(b?.capabilities ?? {})) for (const eid of rec.evidenceIds) if (ev.has(eid)) evidenceUsed.set(eid, ev.get(eid)!);
  }

  const allSim = Object.values(run.bindings).every((id) => config.bindings.find((b) => b.bindingId === id)?.source === "simulated");
  return {
    sceneId: def.sceneId,
    version: def.version,
    title: def.title,
    task: def.task,
    demo: {
      type: def.demoType,
      label: DEMO_LABEL[def.demoType],
      boundary: def.demoBoundary,
      virtualOnly: allSim || def.demoType !== "measured_test",
      scopeNote: "这里的设备状态是虚拟的，与你的真实设备无关；本页不控制、也不读取任何真实硬件。",
    },
    roles,
    conditions,
    applicability: app,
    steps: def.steps.map((s) => ({ stepId: s.stepId, label: s.label, done: app.kind === "pending" ? false : truthy(s.doneWhen, c) })),
    actions,
    stage: { screens },
    env: def.stateVars.filter((v) => v.virtualEnv).map((v) => ({ key: v.key, label: v.label, value: String(run.state[v.key]) })),
    outcome,
    feedback: run.lastFeedback,
    sources: { designBasis: def.designBasis, evidence: [...evidenceUsed.values()], assets: def.assets },
  };
}

/* ------------------------------ 静态检查与可达状态 ------------------------------ */

export function lintDefinition(def: SceneDefinition): string[] {
  const errs: string[] = [];
  const roles = new Set(def.deviceRoles.map((r) => r.roleId));
  const caps = new Set(def.capabilities.map((c) => `${c.roleId}.${c.capId}`));
  const stateKeys = new Set(def.stateVars.map((v) => v.key));
  const condIds = new Set(def.conditions.map((c) => c.condId));
  const dup = (ids: string[], what: string) => {
    const s = new Set<string>();
    for (const i of ids) (s.has(i) && errs.push(`${what} ${i} 重复`), s.add(i));
  };
  dup(def.actions.map((a) => a.actionId), "动作");
  dup(def.conditions.map((a) => a.condId), "条件");
  dup(def.stateVars.map((a) => a.key), "状态量");
  const checkRefs = (e: Expr | undefined, where: string, allowParam: boolean) => {
    if (e === undefined) return;
    for (const r of collectRefs(e)) {
      if (r === "param") (!allowParam && errs.push(`${where} 不能使用 param`));
      else if (r.startsWith("state.")) (!stateKeys.has(r.slice(6)) && errs.push(`${where} 引用了未定义的状态 ${r}`));
      else if (r.startsWith("cap.")) (!caps.has(r.slice(4)) && errs.push(`${where} 引用了未定义的能力 ${r}`));
      else if (r.startsWith("bound.")) (!roles.has(r.slice(6)) && errs.push(`${where} 引用了未定义的角色 ${r}`));
      else errs.push(`${where} 含未知引用 ${r}`);
    }
  };
  for (const c of def.conditions) {
    if (c.kind === "capability") {
      if (!caps.has(`${c.role}.${c.cap}`)) errs.push(`条件 ${c.condId} 引用了未定义的能力`);
    } else checkRefs(c.expr, `条件 ${c.condId}`, false);
  }
  for (const a of def.actions) {
    checkRefs(a.guard, `动作 ${a.actionId} 的 guard`, true);
    for (const id of a.requires ?? []) {
      const cond = def.conditions.find((x) => x.condId === id);
      if (!condIds.has(id)) errs.push(`动作 ${a.actionId} 引用了未定义的条件 ${id}`);
      else if (cond?.kind !== "state") errs.push(`动作 ${a.actionId} 的 requires 只能引用状态类条件（设备能力由引擎统一强制）`);
    }
    for (const ef of a.effects) {
      if (!stateKeys.has(ef.key)) errs.push(`动作 ${a.actionId} 写入了未定义的状态 ${ef.key}`);
      checkRefs(ef.value, `动作 ${a.actionId} 的 effect`, true);
      checkRefs(ef.when, `动作 ${a.actionId} 的 effect.when`, true);
    }
    for (const f of a.feedback) checkRefs(f.when, `动作 ${a.actionId} 的 feedback`, true);
  }
  for (const s of def.steps) checkRefs(s.doneWhen, `步骤 ${s.stepId}`, false);
  checkRefs(def.completion.when, "完成条件", false);
  for (const f of def.failures) checkRefs(f.when, `失败 ${f.outcomeId}`, false);
  for (const sc of def.stage.screens) {
    for (const i of sc.items) checkRefs(i.when, `画面 ${sc.screenId}`, false);
    for (const n of sc.notes ?? []) checkRefs(n.when, `画面 ${sc.screenId} 注记`, false);
  }
  for (const k of def.persistence.savedKeys) if (!stateKeys.has(k)) errs.push(`savedKeys 含未定义的状态 ${k}`);
  if (!def.persistence.accepts.every((v) => v < def.persistence.stateVersion)) errs.push("accepts 只能列出更旧的状态版本");
  if (!def.designBasis.length && !def.genericModule) errs.push("没有资料依据的场景必须标记为通用模块（genericModule）");
  if (def.genericModule && !def.title.includes("通用")) errs.push("通用模块的标题必须包含“通用”");
  if (def.demoType === "measured_test") errs.push("没有实测记录机制，场景不能声明为实机测试");
  for (const a of def.assets) if (a.isProductImage && a.kind !== "product_image") errs.push(`素材 ${a.assetId} 不是产品图片却标记为产品图片`);
  if (!def.serves.problemTags.length || !def.serves.techTags.length) errs.push("场景必须声明服务的用户问题和技术标签");
  return errs;
}

/** 不允许出现在任何可见文本中的表达：假的“已连接你的设备”，以及对真实时延/速度的断言。 */
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /已连接你的/, why: "不得显示“已连接你的设备”" },
  { re: /\d+(\.\d+)?\s*(ms|毫秒|秒钟?|分钟)/i, why: "不得写具体耗时（没有实测依据）" },
  { re: /\d+(\.\d+)?\s*(MB\/s|Mbps|GB\/s)/i, why: "不得写传输速度（没有实测依据）" },
  { re: /(秒传|极速|瞬间|无缝|秒连)/, why: "不得使用速度类或绝对化表达" },
  { re: /(你的真实设备已|真机已)/, why: "不得暗示控制了真实硬件" },
];

export function viewTexts(v: SceneView): string[] {
  return [
    v.title, v.task, v.demo.boundary, v.demo.scopeNote, v.outcome.title, v.outcome.text, ...v.outcome.nextSteps, ...v.outcome.checklist,
    ...v.feedback.map((f) => f.text), ...v.conditions.flatMap((c) => [c.label, c.missing ?? "", c.nextStep ?? ""]),
    ...v.applicability.reasons, ...v.applicability.nextSteps,
    ...v.stage.screens.flatMap((s) => [s.label, ...s.items.map((i) => i.label), ...s.notes]),
    ...v.actions.flatMap((a) => [a.label, a.hint ?? "", a.blocked?.reason ?? "", a.blocked?.nextStep ?? "", ...(a.options ?? []).map((o) => o.label)]),
    ...v.steps.map((s) => s.label),
  ];
}

export interface ReachReport {
  states: number;
  completedReachable: boolean;
  /** 在设备不满足条件时仍到达 completed 的路径（必须为空）。 */
  falseSuccess: string[];
  violations: string[];
}

/**
 * 对一个配置做全可达状态检查：从所有设备选择出发，对每个动作与选项展开，
 * 在每个可达状态检查视图文本、成功分支与适用性的一致性。状态空间由枚举/布尔量界定，必然有限。
 */
export function exploreReachable(def: SceneDefinition, config: SceneConfig, limit = 20000): ReachReport {
  const rep: ReachReport = { states: 0, completedReachable: false, falseSuccess: [], violations: [] };
  const key = (r: SceneRun) => JSON.stringify([r.bindings, r.state]);
  const seen = new Set<string>();
  const queue: SceneRun[] = [createRun(def, config)];
  while (queue.length && seen.size < limit) {
    const run = queue.shift()!;
    const k = key(run);
    if (seen.has(k)) continue;
    seen.add(k);
    rep.states += 1;
    const view = buildView(def, config, run);
    for (const t of viewTexts(view)) for (const f of FORBIDDEN) if (f.re.test(t)) rep.violations.push(`${f.why}：“${t.slice(0, 40)}”（${k.slice(0, 80)}）`);
    const app = applicability(def, config, run);
    if (view.outcome.kind === "completed") {
      rep.completedReachable = true;
      if (app.kind !== "applicable") rep.falseSuccess.push(k);
    }
    const bounded = (e: SceneRun) => {
      const kk = key(e);
      if (!seen.has(kk)) queue.push(e);
    };
    for (const role of def.deviceRoles)
      for (const b of config.bindings.filter((x) => x.roleId === role.roleId)) {
        const r = applyEntry(def, config, run, { type: "bind", roleId: role.roleId, bindingId: b.bindingId });
        if (r.ok) bounded({ ...r.run, history: [] });
      }
    for (const a of def.actions)
      for (const p of a.options ? a.options.map((o) => o.value) : [undefined]) {
        const r = applyEntry(def, config, run, { type: "act", actionId: a.actionId, param: p });
        if (r.ok) bounded({ ...r.run, history: [] });
      }
  }
  return rep;
}
