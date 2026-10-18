import type { NeedEdit } from "./advisor.js";
import {
  isCriticalNeedKey,
  NEED_KEY_LABEL,
  type NeedConfirmation,
  type NeedEntry,
  type NeedKey,
  type NeedSummary,
  type NeedVersionRecord,
} from "./needs.js";
import { hashOf, normalizeText } from "./util.js";

/** 同一时刻只保留一个值的需求维度；其余维度允许累积多条。 */
export const SINGLE_VALUE_NEED_KEYS: readonly NeedKey[] = ["environment", "budget"];

const sig = (e: NeedEntry) => `${e.key}|${e.value}|${e.status}|${e.hard ? 1 : 0}`;

export function needFingerprint(entries: NeedEntry[]): string {
  return hashOf(entries.map(sig).sort());
}
export function criticalFingerprint(entries: NeedEntry[]): string {
  return hashOf(entries.filter((e) => isCriticalNeedKey(e.key)).map(sig).sort());
}

export function emptyNeedVersion(now: string): NeedVersionRecord {
  return { version: 1, fingerprint: needFingerprint([]), criticalFingerprint: criticalFingerprint([]), createdAt: now, reason: "会话开始", entries: [] };
}

export interface ApplyNeedEditsInput {
  current: NeedVersionRecord;
  edits: NeedEdit[];
  /** 这批编辑所依据的用户原话。status=known 的 quote 必须出自它。 */
  userText: string;
  turn: number;
  now: string;
  reason: string;
  historyReason: "user_change" | "correction" | "feedback" | "system_revision";
  /** 编辑来源：用户直接编辑摘要时，value 即为用户本人所填，视为 known。 */
  actor: "engine" | "user_direct";
  newEntryId: () => string;
}

export interface NeedEditNote {
  edit: NeedEdit;
  code: "quote_not_found" | "quote_missing" | "unknown_entry" | "invalid_hard" | "noop";
  text: string;
}

export interface ApplyNeedEditsResult {
  next: NeedVersionRecord;
  changed: boolean;
  changedKeys: NeedKey[];
  criticalChanged: boolean;
  /** 被降级或拒绝的编辑，供审计与展示。 */
  notes: NeedEditNote[];
}

/**
 * 应用需求编辑，产出新版本记录（纯函数，不修改入参）。
 * 关键规则：
 * - 状态 known 必须有用户原话依据；引擎给出的 known 若 quote 缺失或不在用户原话中，降级为 inferred。
 * - 只有 actor=user_direct（用户在摘要里直接改）可以不带 quote 地写 known。
 * - hardConstraints 下的条目恒为 hard。
 */
export function applyNeedEdits(input: ApplyNeedEditsInput): ApplyNeedEditsResult {
  const { current, edits, userText, turn, now } = input;
  let entries = structuredClone(current.entries);
  const notes: NeedEditNote[] = [];
  const changedKeys = new Set<NeedKey>();
  const userNorm = normalizeText(userText);
  const nextVersion = current.version + 1;

  for (const edit of edits) {
    if (edit.op === "remove") {
      const idx = entries.findIndex((e) => e.entryId === edit.entryId);
      if (idx < 0) {
        notes.push({ edit, code: "unknown_entry", text: `要删除的条目 ${edit.entryId} 不存在` });
        continue;
      }
      changedKeys.add(entries[idx]!.key);
      entries.splice(idx, 1);
      continue;
    }

    let status = edit.status;
    let by: "user" | "system" | "default" = status === "default" ? "default" : status === "known" ? "user" : "system";
    let quote = edit.quote;
    if (status === "known" && input.actor === "engine") {
      if (!quote?.trim()) {
        notes.push({ edit, code: "quote_missing", text: `“${edit.value}”缺少用户原话依据，已按“推断”处理` });
        status = "inferred";
        by = "system";
      } else if (!userNorm.includes(normalizeText(quote))) {
        notes.push({ edit, code: "quote_not_found", text: `“${edit.value}”的引用不在用户本轮原话中，已按“推断”处理` });
        status = "inferred";
        by = "system";
        quote = undefined;
      }
    }
    if (status === "known" && input.actor === "user_direct") quote = quote?.trim() || edit.value;

    const hard = edit.key === "hardConstraints";
    let targetIdx = -1;
    if (edit.entryId) {
      targetIdx = entries.findIndex((e) => e.entryId === edit.entryId);
      if (targetIdx < 0) {
        notes.push({ edit, code: "unknown_entry", text: `要替换的条目 ${edit.entryId} 不存在` });
        continue;
      }
      if (entries[targetIdx]!.key !== edit.key) {
        notes.push({ edit, code: "unknown_entry", text: `条目 ${edit.entryId} 不属于 ${edit.key}` });
        continue;
      }
    } else if (SINGLE_VALUE_NEED_KEYS.includes(edit.key)) {
      targetIdx = entries.findIndex((e) => e.key === edit.key);
    } else {
      // 多值键：完全相同的值只更新状态，不重复新增
      targetIdx = entries.findIndex((e) => e.key === edit.key && normalizeText(e.value) === normalizeText(edit.value));
    }

    const origin = { by, turn, quote: quote?.slice(0, 500), note: edit.note };
    if (targetIdx >= 0) {
      const old = entries[targetIdx]!;
      const same = old.value === edit.value && old.status === status && old.hard === hard;
      if (same) {
        notes.push({ edit, code: "noop", text: "与现有内容相同，未变化" });
        continue;
      }
      entries[targetIdx] = {
        ...old,
        value: edit.value,
        structured: edit.structured,
        status,
        hard,
        origin,
        setAtVersion: nextVersion,
        history: [
          ...old.history,
          { value: old.value, status: old.status, origin: old.origin, replacedAtVersion: nextVersion, reason: input.historyReason },
        ],
      };
    } else {
      entries.push({
        entryId: input.newEntryId(),
        key: edit.key,
        value: edit.value,
        structured: edit.structured,
        status,
        hard,
        origin,
        setAtVersion: nextVersion,
        history: [],
      });
    }
    changedKeys.add(edit.key);
  }

  const fp = needFingerprint(entries);
  const changed = fp !== current.fingerprint;
  const keys = [...changedKeys];
  const next: NeedVersionRecord = changed
    ? { version: nextVersion, fingerprint: fp, criticalFingerprint: criticalFingerprint(entries), createdAt: now, reason: input.reason, entries }
    : current;
  return {
    next,
    changed,
    changedKeys: keys,
    criticalChanged: changed && next.criticalFingerprint !== current.criticalFingerprint,
    notes,
  };
}

/**
 * 当前有效确认：未被作废，且绑定的完整指纹等于当前需求指纹。
 * 任何需求变化都会使确认失效（关键变化让方案过期，非关键变化让方案待复核），
 * 因此“已确认”永远指向用户确实看过的那一版。
 */
export function validConfirmation(record: NeedVersionRecord, confirmations: NeedConfirmation[]): NeedConfirmation | undefined {
  return [...confirmations].reverse().find((c) => c.status === "valid" && c.fingerprint === record.fingerprint && c.needVersion === record.version);
}

export function buildNeedSummary(record: NeedVersionRecord, confirmations: NeedConfirmation[]): NeedSummary {
  const order: NeedKey[] = ["task", "environment", "budget", "existingDevices", "requiredSoftware", "hardConstraints", "preferences", "concerns"];
  const groups = order
    .map((key) => ({
      key,
      label: NEED_KEY_LABEL[key],
      entries: record.entries.filter((e) => e.key === key).map((e) => ({ entryId: e.entryId, value: e.value, status: e.status, hard: e.hard })),
    }))
    .filter((g) => g.entries.length > 0);
  const assumptions = record.entries
    .filter((e) => e.status !== "known")
    .map((e) => ({
      entryId: e.entryId,
      status: e.status,
      text: `${NEED_KEY_LABEL[e.key]}：${e.value}（${{ inferred: "系统推断", default: "系统默认", pending: "待你确认", known: "" }[e.status]}）`,
    }));
  const blockers: string[] = [];
  const tasks = record.entries.filter((e) => e.key === "task");
  if (tasks.length === 0) blockers.push("还不清楚你主要想用它做什么");
  else if (tasks.every((t) => t.status === "pending")) blockers.push("你的主要用途还在待确认");
  const confirmed = validConfirmation(record, confirmations) !== undefined;
  return {
    needVersion: record.version,
    fingerprint: record.fingerprint,
    criticalFingerprint: record.criticalFingerprint,
    groups,
    assumptions,
    blockers,
    confirmable: blockers.length === 0,
    confirmed,
  };
}
