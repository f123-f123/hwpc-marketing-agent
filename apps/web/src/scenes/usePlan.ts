import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  restore,
  toSaved,
  type FeedbackEvent,
  type FeedbackKind,
  type FeedbackRecord,
  type HistoryEntry,
  type PersonalPlan,
  type PlanExperience,
  type PlanPosition,
  type PlanProgress,
  type ProgressExport,
  type RestoreResult,
} from "@hwpc/scenes";
import { getScene } from "@hwpc/scenes";
import type { AdvisorClient } from "../advisor/client";

/**
 * 个人方案的体验状态：位置、各任务的操作历史、反馈。
 * 保存经 AdvisorClient.saveProgress；storage 字段如实说明保存位置，界面据此显示，
 * 不会把浏览器本地缓存说成服务端持久化。
 */

export interface Restored {
  histories: Record<string, HistoryEntry[]>;
  /** 因场景版本/状态版本不兼容而未恢复的任务，如实告诉用户。 */
  skipped: { experienceId: string; reason: string }[];
}

export function restoreAll(plan: PersonalPlan, progress: PlanProgress): Restored {
  const histories: Record<string, HistoryEntry[]> = {};
  const skipped: Restored["skipped"] = [];
  for (const e of plan.experiences) {
    const saved = progress.records[e.experienceId];
    if (!saved) continue;
    const def = getScene(e.sceneId, e.sceneVersion);
    if (!def) {
      skipped.push({ experienceId: e.experienceId, reason: `场景 ${e.sceneId} v${e.sceneVersion} 不在当前场景清单中` });
      continue;
    }
    const r: RestoreResult = restore(def, e.config, saved);
    if (r.ok) histories[e.experienceId] = r.run.history;
    else skipped.push({ experienceId: e.experienceId, reason: r.reason });
  }
  return { histories, skipped };
}

export function usePlan(client: AdvisorClient, sessionId: string, plan: PersonalPlan | null) {
  const [histories, setHistories] = useState<Record<string, HistoryEntry[]>>({});
  const [position, setPosition] = useState<PlanPosition>({ activity: "scenes", yaw: 0, pitch: 0 });
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [storage, setStorage] = useState<PlanProgress["storage"]>("none");
  const [skipped, setSkipped] = useState<Restored["skipped"]>([]);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const planKey = plan ? `${plan.planId}@${plan.planVersion}` : "";
  const hist = useRef(histories);
  hist.current = histories;
  const pos = useRef(position);
  pos.current = position;
  const fb = useRef(feedback);
  fb.current = feedback;

  useEffect(() => {
    setReady(false);
    if (!plan) return;
    let alive = true;
    client
      .loadProgress(sessionId, plan.planVersion)
      .then((p) => {
        if (!alive) return;
        const r = restoreAll(plan, p);
        setHistories(r.histories);
        setSkipped(r.skipped);
        setPosition(p.position ?? { activity: "scenes", yaw: 0, pitch: 0 });
        setFeedback(p.feedback);
        setStorage(p.storage);
        setReady(true);
      })
      .catch(() => alive && (setStorage("none"), setReady(true)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId, planKey]);

  const persist = useCallback(
    async (h: Record<string, HistoryEntry[]>, p: PlanPosition, f: FeedbackRecord[]) => {
      if (!plan) return;
      const records: PlanProgress["records"] = {};
      for (const e of plan.experiences) {
        const def = getScene(e.sceneId, e.sceneVersion);
        const hs = h[e.experienceId];
        if (def && hs && hs.length) records[e.experienceId] = toSaved(def, { bindings: {}, state: {}, history: hs, lastFeedback: [] }, new Date().toISOString());
      }
      try {
        const saved = await client.saveProgress(sessionId, { planId: plan.planId, planVersion: plan.planVersion, records, position: p, feedback: f, storage, updatedAt: new Date().toISOString() });
        setStorage(saved.storage);
        setSaveError(null);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "保存失败");
      }
    },
    [client, sessionId, plan, storage],
  );

  const setHistory = useCallback(
    (experienceId: string, h: HistoryEntry[]) => {
      const next = { ...hist.current, [experienceId]: h };
      setHistories(next);
      void persist(next, pos.current, fb.current);
    },
    [persist],
  );
  const setPos = useCallback(
    (p: PlanPosition) => {
      setPosition(p);
      void persist(hist.current, p, fb.current);
    },
    [persist],
  );
  /** 视角拖动很频繁：只更新内存，由 commitView 在松手/离开时保存。 */
  const setViewLive = useCallback((yaw: number, pitch: number) => setPosition((p) => ({ ...p, yaw, pitch })), []);

  const send = useCallback(
    async (exp: PlanExperience, kind: FeedbackKind, ctx: FeedbackEvent["context"], note?: string): Promise<FeedbackRecord | null> => {
      if (!plan) return null;
      const event: FeedbackEvent = {
        feedbackId: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        planId: plan.planId,
        planVersion: plan.planVersion,
        experienceId: exp.experienceId,
        sceneId: exp.sceneId,
        sceneVersion: exp.sceneVersion,
        context: ctx,
        note: note?.trim() || undefined,
        at: new Date().toISOString(),
      };
      let rec: FeedbackRecord;
      try {
        rec = await client.sendFeedback(sessionId, event);
      } catch (e) {
        rec = { event, status: "unsupported", ack: e instanceof Error ? e.message : "当前后端不接收体验反馈" };
      }
      const next = [...fb.current, rec];
      setFeedback(next);
      void persist(hist.current, pos.current, next);
      return rec;
    },
    [client, sessionId, plan, persist],
  );

  const doneIds = useMemo(() => {
    if (!plan) return [] as string[];
    return plan.experiences.filter((e) => (histories[e.experienceId]?.length ?? 0) > 0).map((e) => e.experienceId);
  }, [plan, histories]);

  const exportProgress = useCallback((): ProgressExport | null => {
    if (!plan) return null;
    const records: ProgressExport["records"] = {};
    for (const e of plan.experiences) {
      const def = getScene(e.sceneId, e.sceneVersion);
      const hs = histories[e.experienceId];
      if (def && hs?.length) records[e.experienceId] = toSaved(def, { bindings: {}, state: {}, history: hs, lastFeedback: [] }, new Date().toISOString());
    }
    return { format: "hwpc-plan-progress", formatVersion: 1, planId: plan.planId, planVersion: plan.planVersion, exportedAt: new Date().toISOString(), from: "workbench", records, feedback: feedback.map((f) => f.event) };
  }, [plan, histories, feedback]);

  const importProgress = useCallback(
    (data: unknown): { ok: boolean; message: string } => {
      if (!plan) return { ok: false, message: "还没有方案" };
      const d = data as Partial<ProgressExport> | null;
      if (!d || d.format !== "hwpc-plan-progress" || d.formatVersion !== 1) return { ok: false, message: "不是可识别的进度记录" };
      if (d.planId !== plan.planId) return { ok: false, message: "这份记录属于另一个方案，未导入" };
      if (d.planVersion !== plan.planVersion) return { ok: false, message: `这份记录来自方案 v${d.planVersion}，当前为 v${plan.planVersion}，未导入` };
      const r = restoreAll(plan, { planId: plan.planId, planVersion: plan.planVersion, records: d.records ?? {}, feedback: [], storage: "none", updatedAt: "" });
      const next = { ...hist.current, ...r.histories };
      setHistories(next);
      setSkipped(r.skipped);
      void persist(next, pos.current, fb.current);
      const n = Object.keys(r.histories).length;
      return { ok: true, message: `已恢复 ${n} 个任务的进度${r.skipped.length ? `；${r.skipped.length} 个因场景版本不兼容未恢复` : ""}。导入的是一份独立副本，不会同步原记录的后续变化。` };
    },
    [plan, persist],
  );

  return { ready, histories, position, feedback, storage, skipped, saveError, doneIds, setHistory, setPos, setViewLive, send, exportProgress, importProgress };
}
