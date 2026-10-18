import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdvisorApiError, type AdvisorClient, type ConfirmResult, type SummaryEdit, type SummaryRef } from "./client";
import { LegacyAdvisorClient, lastLegacyTaskId } from "./legacyClient";
import { getMockClient, lastMockSessionId, type MockAdvisorClient } from "./mock/mockClient";
import type { PersonalPlan } from "@hwpc/scenes";
import type { AdvisorSnapshot, WorkView } from "./types";

export type BackendKind = "mock-ui" | "legacy-api";

export interface Notice {
  id: number;
  tone: "info" | "warn" | "error";
  text: string;
}

export function initialBackend(): BackendKind {
  const q = new URLSearchParams(window.location.search).get("backend");
  return q === "api" ? "legacy-api" : "mock-ui";
}

const clients: Partial<Record<BackendKind, AdvisorClient>> = {};
function clientFor(kind: BackendKind): AdvisorClient {
  clients[kind] ??= kind === "mock-ui" ? getMockClient() : new LegacyAdvisorClient();
  return clients[kind]!;
}

export function useAdvisor() {
  const [backend, setBackendState] = useState<BackendKind>(initialBackend);
  const client = useMemo(() => clientFor(backend), [backend]);
  const [snap, setSnap] = useState<AdvisorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [work, setWork] = useState<WorkView | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PersonalPlan | null>(null);
  const [planVersion, setPlanVersion] = useState<number | null>(null);
  const [activity, setActivity] = useState<"talk" | "experience">("talk");
  const noticeId = useRef(0);
  const sessionRef = useRef<string | null>(null);

  const say = useCallback((tone: Notice["tone"], text: string) => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, tone, text });
  }, []);

  const apply = useCallback((s: AdvisorSnapshot | null) => {
    setSnap(s);
    sessionRef.current = s?.sessionId ?? null;
  }, []);

  /* 刷新恢复：只读取后端记录。 */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    apply(null);
    setWork(null);
    setSelectedVersion(null);
    const id = backend === "mock-ui" ? lastMockSessionId() : lastLegacyTaskId();
    (async () => {
      try {
        const s = id ? await client.getSnapshot(id) : null;
        if (alive) apply(s);
      } catch (e) {
        if (alive) say("error", e instanceof Error ? e.message : "恢复会话失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, backend, apply, say]);

  /* 更新来源：mock 订阅推送，旧接口轮询。 */
  useEffect(() => {
    if (!snap) return;
    const id = snap.sessionId;
    const refresh = async () => {
      try {
        const s = await client.getSnapshot(id);
        if (s && sessionRef.current === id) setSnap(s);
      } catch {
        /* 轮询失败不打断界面，下一次再试 */
      }
    };
    if (client.kind === "mock-ui") {
      return (client as MockAdvisorClient).subscribe((sid) => sid === id && void refresh());
    }
    if (snap.phase === "producing" || snap.phase === "retrieving") {
      const t = window.setInterval(refresh, 1000);
      return () => window.clearInterval(t);
    }
    return undefined;
  }, [client, snap?.sessionId, snap?.phase]);

  /* 作品版本：默认查看最新版本；选择历史版本时读取该版本。 */
  const latestVersion = snap?.versions.at(-1)?.version ?? null;
  const versionKey = snap ? snap.versions.map((v) => `${v.version}:${v.currentRequirement}`).join(",") : "";
  useEffect(() => {
    if (latestVersion === null) {
      setSelectedVersion(null);
      setWork(null);
      return;
    }
    setSelectedVersion((cur) => (cur === null || !snap?.versions.some((v) => v.version === cur) ? latestVersion : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestVersion, snap?.sessionId]);

  const sid = snap?.sessionId;
  useEffect(() => {
    if (!sid || selectedVersion === null) return;
    let alive = true;
    setWorkError(null);
    client
      .getWork(sid, selectedVersion)
      .then((w) => alive && setWork(w))
      .catch((e: unknown) => alive && (setWork(null), setWorkError(e instanceof Error ? e.message : "读取作品失败")));
    return () => {
      alive = false;
    };
  }, [client, sid, selectedVersion, versionKey]);

  /* 个人方案：与作品版本同步；选择历史版本时取该版本的方案。 */
  const hasPlanCap = !!snap?.capabilities.personalPlan;
  useEffect(() => {
    if (!sid || !hasPlanCap || latestVersion === null) {
      setPlan(null);
      return;
    }
    let alive = true;
    const v = planVersion ?? latestVersion;
    client
      .getPlan(sid, v)
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [client, sid, hasPlanCap, latestVersion, planVersion, versionKey]);

  /* 统一的动作包装：过期时刷新快照并说明。 */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        if (e instanceof AdvisorApiError) {
          say(e.code.startsWith("stale") ? "warn" : "error", e.message);
          if (e.code.startsWith("stale") && sessionRef.current) {
            const s = await client.getSnapshot(sessionRef.current).catch(() => null);
            if (s) setSnap(s);
          }
        } else say("error", e instanceof Error ? e.message : "操作失败");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [client, say],
  );

  const actions = useMemo(
    () => ({
      start: async (text: string) => {
        const s = await run(() => client.createSession(text));
        if (s) apply(s);
      },
      send: async (text: string) => {
        if (!snap) return;
        const s = await run(() => client.sendMessage(snap.sessionId, text, snap.revision));
        if (s) apply(s);
      },
      answer: async (answers: { questionId: string; optionValue?: string; text?: string }[], freeText?: string) => {
        if (!snap) return;
        const s = await run(() => client.submitAnswers(snap.sessionId, { answers, freeText, baseRevision: snap.revision }));
        if (s) apply(s);
      },
      edit: async (messageId: string, text: string) => {
        if (!snap) return;
        const s = await run(() => client.editMessage(snap.sessionId, messageId, text, snap.revision));
        if (s) {
          apply(s);
          say("info", "已按修改后的表达重新整理后续内容。");
        }
      },
      confirm: async (ref: SummaryRef): Promise<ConfirmResult | undefined> => {
        if (!snap) return undefined;
        const r = await run(() => client.confirmSummary(snap.sessionId, ref));
        if (!r) return undefined;
        apply(r.snapshot);
        if (r.status === "rejected") say(r.reason === "stale_summary" ? "warn" : "error", r.message);
        else if (r.duplicate) say("info", "这版需求已经确认过，没有重复触发制作。");
        return r;
      },
      reviseSummary: async (ref: SummaryRef, edits: SummaryEdit[]) => {
        if (!snap) return;
        const s = await run(() => client.reviseSummary(snap.sessionId, ref, edits));
        if (s) apply(s);
      },
      continueDiscussion: async (ref: SummaryRef) => {
        if (!snap) return;
        const s = await run(() => client.continueDiscussion(snap.sessionId, ref));
        if (s) apply(s);
      },
      reviseWork: async (instruction: string, baseVersion: number) => {
        if (!snap) return;
        const s = await run(() => client.requestWorkRevision(snap.sessionId, instruction, baseVersion));
        if (s) {
          apply(s);
          setSelectedVersion(null);
        }
      },
      changeRequirement: async (note: string, baseVersion: number) => {
        if (!snap) return;
        const s = await run(() => client.requestRequirementChange(snap.sessionId, note, baseVersion));
        if (s) apply(s);
      },
      resume: async () => {
        if (!snap) return;
        const s = await run(() => client.resume(snap.sessionId));
        if (s) apply(s);
      },
      newSession: () => {
        localStorage.removeItem(backend === "mock-ui" ? "hwpc.mock-ui.last-session" : "hwpc.legacy.last-task");
        apply(null);
        setWork(null);
        setPlan(null);
        setSelectedVersion(null);
        setActivity("talk");
      },
      switchBackend: (k: BackendKind) => {
        const url = new URL(window.location.href);
        if (k === "legacy-api") url.searchParams.set("backend", "api");
        else url.searchParams.delete("backend");
        window.history.replaceState(null, "", url);
        setBackendState(k);
      },
      dismissNotice: () => setNotice(null),
      switchActivity: setActivity,
    }),
    [client, snap, run, apply, say, backend],
  );

  return { backend, client, snap, loading, busy, notice, selectedVersion, setSelectedVersion, work, workError, plan, planVersion, setPlanVersion, activity, actions };
}
