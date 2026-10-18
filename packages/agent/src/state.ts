/**
 * 对话状态：创建、需求项写入（含来源/历史/冲突）、指纹、版本提交与影响分析。
 * 所有函数只改传入的 state（调用方在入口处 clone），不做 IO。
 */
import type { ProductRef } from "@hwpc/contracts";
import {
  ConversationStateSchema,
  isCriticalKey,
  isRefineKey,
  SINGLE_VALUE_KEYS,
  type ChangeImpact,
  type Conflict,
  type ConversationState,
  type ReqKey,
  type RequirementItem,
  type Source,
} from "./types.js";
import { hash, norm } from "./util.js";

export class ConsultantError extends Error {
  constructor(
    public readonly code:
      | "invalid_state"
      | "confirm_rejected"
      | "generation_blocked"
      | "invalid_request"
      | "state_corrupt",
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ConsultantError";
  }
}

export const nowIso = (now: () => Date) => now().toISOString();

export function createState(taskId: string, at: string): ConversationState {
  return {
    schema: "hwpc.consultant.v2",
    taskId,
    createdAt: at,
    updatedAt: at,
    stage: "collecting",
    turns: [],
    requirementVersion: 1,
    currentFingerprint: reqFingerprint({}),
    items: {},
    conflicts: [],
    questions: [],
    candidates: [],
    productMentions: [],
    searchLog: [],
    userClaims: [],
    factQnA: [],
    requirementSnapshots: [],
    evidence: [],
    summaries: [],
    confirmations: [],
    artifacts: [],
    assessments: [],
    plans: [],
    sceneInstances: [],
    experienceEvents: [],
    feedback: [],
    behaviorSuggestions: [],
    explorations: [],
    impactLog: [],
    decisions: [],
    nextAction: { type: "blocked", reason: "尚未开始" },
    audit: [],
  };
}

/** 序列化 / 恢复。恢复时用 schema 校验，损坏的状态直接拒绝。 */
export function serializeState(s: ConversationState): string {
  return JSON.stringify(s);
}
export function restoreState(raw: unknown): ConversationState {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const r = ConversationStateSchema.safeParse(data);
  if (!r.success) throw new ConsultantError("state_corrupt", `对话状态无法恢复: ${r.error.issues[0]?.message ?? "schema 不匹配"}`, r.error.issues);
  return r.data;
}

/* ------------------------------ 指纹 ------------------------------ */

/** 需求指纹：不含来源/轮次，只含会改变交付结果的取值。styleNotes（表达偏好）不参与。 */
export function reqFingerprint(items: Record<string, RequirementItem> | Record<string, never>): string {
  const body: Record<string, unknown> = {};
  for (const [k, it] of Object.entries(items as Record<string, RequirementItem>)) {
    // 表达偏好不改变交付范围，不参与指纹（修改后新文本仍须重新核验）。
    // 细化类需求（环境、频率、偏好、疑问、顾虑、表达偏好）不改变范围，不参与指纹。
    if (isRefineKey(k as ReqKey)) continue;
    body[k] = {
      v: norm(it.value),
      r: it.refs?.map((x) => `${x.productId}/${x.configurationId ?? ""}`).sort(),
      c: it.status === "conflict" ? 1 : 0,
    };
  }
  return hash(body);
}

export const turnNo = (s: ConversationState) => Math.max(0, s.turns.length - 1);

export function addTurn(s: ConversationState, role: "user" | "assistant" | "system", text: string, at: string, kind: "message" | "confirm" | "summary_edit" | "revision" | "event" = "message"): number {
  const turn = s.turns.length;
  s.turns.push({ turn, role, kind, text, at });
  s.updatedAt = at;
  return turn;
}

let auditSeq = 0;
export function audit(s: ConversationState, at: string, e: { type: ConversationState["audit"][number]["type"]; purpose?: string; detail?: string }) {
  auditSeq += 1;
  s.audit.push({ seq: s.audit.length + 1, at, requirementVersion: s.requirementVersion, ...e });
  return auditSeq;
}

/* ------------------------------ 需求项 ------------------------------ */

const sameRefs = (a?: ProductRef[], b?: ProductRef[]) => {
  const f = (x?: ProductRef[]) => (x ?? []).map((r) => `${r.productId}/${r.configurationId ?? ""}`).sort().join("|");
  return f(a) === f(b);
};

export type SetResult = "created" | "same" | "promoted" | "replaced" | "conflict_opened" | "kept_existing" | "appended";

export interface SetOpts {
  source: Source;
  status?: "confirmed" | "tentative";
  refs?: ProductRef[];
  /** 用户明确要求更改（改成/换成/回答了针对该项的问题/摘要修改）。 */
  explicit?: boolean;
  reason?: "user_modification" | "explicit_change" | "conflict_resolution" | "refined" | "summary_edit";
}

export function setItem(s: ConversationState, key: ReqKey, value: string, opts: SetOpts): SetResult {
  const v = value.trim();
  if (!v) return "kept_existing";
  const status = opts.status ?? (opts.source.kind === "user" ? "confirmed" : "tentative");
  const existing = s.items[key];
  const mk = (): RequirementItem => ({
    key,
    value: v,
    refs: opts.refs,
    status,
    source: opts.source,
    critical: isCriticalKey(key),
    setAtVersion: s.requirementVersion,
    history: existing?.history ?? [],
  });

  if (!existing) {
    s.items[key] = mk();
    return "created";
  }

  const multi = !SINGLE_VALUE_KEYS.includes(key);
  if (multi) {
    if (existing.source.kind !== "user" && opts.source.kind !== "user" && norm(existing.value) !== norm(v)) {
      pushHistory(s, existing, opts.reason ?? "refined", opts.source);
      s.items[key] = { ...mk(), history: existing.history };
      return "replaced";
    }
    const parts = existing.value.split("；");
    if (parts.some((p) => norm(p) === norm(v))) {
      if (opts.source.kind === "user" && existing.status !== "confirmed") {
        existing.status = "confirmed";
        existing.source = opts.source;
        return "promoted";
      }
      return "same";
    }
    // 系统/默认值被用户值取代；用户值之间累积。
    if (existing.source.kind !== "user" && opts.source.kind === "user") {
      pushHistory(s, existing, opts.reason ?? "refined", opts.source);
      s.items[key] = { ...mk(), history: existing.history };
      return "replaced";
    }
    if (opts.source.kind !== "user" && existing.source.kind === "user") return "kept_existing";
    existing.value = [...parts, v].join("；");
    if (opts.source.kind === "user") {
      existing.status = "confirmed";
      existing.source = opts.source;
    }
    return "appended";
  }

  // 单值键
  if (norm(existing.value) === norm(v) && sameRefs(existing.refs, opts.refs)) {
    if (opts.source.kind === "user" && existing.status !== "confirmed") {
      existing.status = "confirmed";
      existing.source = opts.source;
      if (opts.refs) existing.refs = opts.refs;
      return "promoted";
    }
    return "same";
  }
  if (existing.status === "conflict") {
    const c = s.conflicts.find((x) => x.status === "open" && x.keys.includes(key) && x.kind === "value_clash");
    if (opts.explicit && opts.source.kind === "user") {
      if (c) closeConflict(c, `用户明确选择：${v}`, opts.source.turn);
      pushHistory(s, existing, "conflict_resolution", opts.source);
      s.items[key] = { ...mk(), history: existing.history };
      return "replaced";
    }
    if (c && !c.options.some((o) => norm(o.value) === norm(v))) c.options.push({ value: v, label: v, turn: opts.source.turn });
    return "kept_existing";
  }
  if (opts.source.kind !== "user") {
    if (existing.source.kind === "user" && existing.status === "confirmed") return "kept_existing";
    pushHistory(s, existing, "refined", opts.source);
    s.items[key] = { ...mk(), history: existing.history };
    return "replaced";
  }
  // 用户给出不同的值
  if (existing.source.kind !== "user" || existing.status === "tentative" || opts.explicit) {
    pushHistory(s, existing, opts.reason ?? (opts.explicit ? "explicit_change" : "refined"), opts.source);
    s.items[key] = { ...mk(), history: existing.history };
    return "replaced";
  }
  // 用户先前明确说过 X，现在无变更提示地说 Y → 矛盾，需要针对性澄清。
  openConflict(s, {
    kind: "value_clash",
    keys: [key],
    options: [
      { value: existing.value, label: existing.value, turn: existing.source.turn },
      { value: v, label: v, turn: opts.source.turn },
    ],
    description: `「${labelOfKey(key)}」前后表达不一致：之前是「${existing.value}」，现在提到「${v}」`,
    turn: opts.source.turn,
  });
  existing.status = "conflict";
  existing.alternatives = [...(existing.alternatives ?? []), { value: v, turn: opts.source.turn }];
  return "conflict_opened";
}

function pushHistory(s: ConversationState, it: RequirementItem, reason: RequirementItem["history"][number]["reason"], by: Source) {
  it.history.push({
    value: it.value,
    refs: it.refs,
    source: it.source,
    replacedAtTurn: by.turn,
    replacedAtVersion: s.requirementVersion,
    reason,
  });
}

export function openConflict(
  s: ConversationState,
  c: { kind: Conflict["kind"]; keys: ReqKey[]; ruleId?: string; options: Conflict["options"]; description: string; turn: number },
): Conflict {
  const dup = s.conflicts.find((x) => x.status === "open" && x.kind === c.kind && x.ruleId === c.ruleId && x.keys.join() === c.keys.join());
  if (dup) return dup;
  const n = s.conflicts.length + 1;
  const conflict: Conflict = { conflictId: `cf-${n}`, status: "open", openedTurn: c.turn, ...c };
  s.conflicts.push(conflict);
  return conflict;
}

export function closeConflict(c: Conflict, resolution: string, turn: number) {
  c.status = "resolved";
  c.resolution = resolution;
  c.resolvedTurn = turn;
}

export function removeFromMulti(s: ConversationState, key: ReqKey, part: string, by: Source) {
  const it = s.items[key];
  if (!it) return;
  const keep = it.value.split("；").filter((p) => norm(p) !== norm(part));
  if (keep.length === it.value.split("；").length) return;
  pushHistory(s, it, "user_modification", by);
  if (keep.length === 0) delete s.items[key];
  else it.value = keep.join("；");
}

export const KEY_LABEL: Record<ReqKey, string> = {
  tasks: "实际任务",
  environment: "使用环境",
  frequency: "使用频率",
  budget: "预算",
  existingDevices: "已有设备",
  requiredSoftware: "必要软件",
  hardConstraints: "硬条件",
  unacceptable: "不可接受项",
  preferences: "偏好",
  techQuestions: "技术疑问",
  concerns: "顾虑",
  outputKind: "输出类型",
  audience: "目标客户",
  problem: "主要问题",
  goal: "营销目标",
  scenario: "使用场景",
  productScope: "产品范围",
  platform: "发布渠道",
  deliveryFormat: "交付形式",
  mustEmphasize: "必须强调",
  mustAvoid: "必须避免",
  activity: "活动限制",
  styleNotes: "表达偏好",
};
export const labelOfKey = (k: ReqKey) => KEY_LABEL[k];

/* ------------------------------ 版本提交与影响 ------------------------------ */

const EFFECT: Record<ReqKey, string> = {
  tasks: "实际任务变化，候选筛选、评估标准和场景安排需要重做",
  environment: "使用环境变化，仅调整排序、解释与场景安排",
  frequency: "使用频率变化，仅调整排序与解释",
  budget: "预算变化，候选范围可能变化，需要重新筛选并重新确认",
  existingDevices: "已有设备变化，场景中的设备绑定需要重新检查；此前体验进度不能直接沿用",
  requiredSoftware: "必要软件变化，候选筛选需要重做",
  hardConstraints: "硬条件变化，候选筛选需要重做并重新确认",
  unacceptable: "不可接受项变化，候选筛选需要重做并重新确认",
  preferences: "偏好细化，仅调整排序与解释",
  techQuestions: "技术疑问变化，需要新增或更换场景来解答",
  concerns: "顾虑变化，需要在方案中给出对应说明或场景",
  outputKind: "输出类型变化，所需信息与交付内容随之变化",
  audience: "内容切入点与卖点顺序需按新人群重选；旧稿不再适配",
  problem: "用户问题变化，内容策略需重新制定",
  goal: "营销目标变化，行动引导与结构需重写",
  scenario: "使用场景变化，切入点、卖点优先级与配图方案需重选",
  productScope: "产品范围变化，事实、图片与互动内容需重新检索并核验；旧核验不再适用",
  platform: "渠道变化，标题、结构、语气、配图数量与行动引导需重写；旧稿不再适配",
  deliveryFormat: "交付形式变化，互动方案需增删；平台图文要求仍然保留",
  mustEmphasize: "需重新选择内容并检查是否有对应资料依据",
  mustAvoid: "需重新选择内容并确认已避开相关话题",
  activity: "活动限制变化，需检查行动引导与价格/权益表达",
  styleNotes: "仅影响表达方式，可在已确认范围内调整，但新文本必须重新核验",
};

function diffKeys(a: Record<string, RequirementItem>, b: Record<string, RequirementItem>): ReqKey[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: ReqKey[] = [];
  for (const k of keys) {
    if (isRefineKey(k as ReqKey)) continue;
    const x = a[k];
    const y = b[k];
    if (!x || !y || norm(x.value) !== norm(y.value) || !sameRefs(x.refs, y.refs)) out.push(k as ReqKey);
  }
  return out;
}

export function analyzeImpact(s: ConversationState, changedKeys: ReqKey[]): ChangeImpact {
  const critical = changedKeys.some(isCriticalKey);
  const staleArtifactIds = s.artifacts.filter((a) => a.status === "current").map((a) => a.artifactId);
  return {
    changedKeys,
    critical,
    effects: changedKeys.map((key) => ({ key, effect: EFFECT[key] })),
    invalidatedConfirmationIds: s.confirmations.filter((c) => c.status === "valid").map((c) => c.confirmationId),
    staleArtifactIds,
    needsReRetrieval: changedKeys.some((k) => k === "productScope" || k === "platform" || k === "scenario" || k === "audience" || k === "mustEmphasize"),
    needsReConfirmation: changedKeys.length > 0,
    needsReVerification: true,
  };
}

/**
 * 在一轮处理结束后调用。若需求指纹变化：
 * - 当前版本尚未形成过摘要：原地更新；
 * - 已形成过摘要/确认：版本号 +1，使确认失效，旧作品标记 stale（保留追溯），旧摘要 superseded。
 */
export function commit(s: ConversationState, at: string): ChangeImpact | undefined {
  const fp = reqFingerprint(s.items);
  if (fp === s.currentFingerprint) return undefined;
  // 只有存在可确认的摘要（现在只在需求就绪时才会生成摘要）后，改动才产生新版本。
  const locked = s.summaries.some((x) => x.requirementVersion === s.requirementVersion);
  if (!locked) {
    s.currentFingerprint = fp;
    return undefined;
  }
  const last = [...s.requirementSnapshots].reverse().find((x) => x.version === s.requirementVersion);
  const changed = diffKeys(last?.items ?? {}, s.items);
  const impact = analyzeImpact(s, changed);
  const from = s.requirementVersion;
  const to = from + 1;

  for (const c of s.confirmations) {
    if (c.status === "valid") {
      c.status = "invalidated";
      c.invalidatedAt = at;
      c.invalidatedReason = `需求从 v${from} 变更为 v${to}（${changed.map(labelOfKey).join("、") || "内容约束"}）`;
    }
  }
  for (const sm of s.summaries) if (sm.status !== "superseded") sm.status = "superseded";
  for (const a of s.artifacts) {
    if (a.status === "current") {
      a.status = "stale";
      a.staleReason = `需求已从 v${from} 更新到 v${to}：${changed.map(labelOfKey).join("、")}`;
    }
  }
  s.requirementVersion = to;
  s.currentFingerprint = fp;
  s.impactLog.push({ ...impact, at, fromVersion: from, toVersion: to });
  if (s.stage !== "blocked") s.stage = "collecting";
  for (const q of s.questions) if (q.status === "open" && q.kind === "gap_handling") q.status = "superseded";
  return impact;
}

/** 当前需求项里被置于冲突状态的键、仍然开放的冲突。 */
export const openConflicts = (s: ConversationState) => s.conflicts.filter((c) => c.status === "open");

export function itemValue(s: ConversationState, key: ReqKey): string | undefined {
  return s.items[key]?.value;
}
