import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, SessionSnapshot } from "@hwpc/contracts";
import { ApiError, api, type FeedbackInput } from "../api/client";
import { KEYS, readText, remove, writeText } from "../lib/storage";

export interface Notice {
  tone: "danger" | "neutral";
  text: string;
}

export interface SessionActions {
  create: (text: string) => Promise<SessionSnapshot | null>;
  send: (text: string) => Promise<SessionSnapshot | null>;
  answer: (answers: { questionId: string; answer: string }[]) => Promise<SessionSnapshot | null>;
  confirm: () => Promise<SessionSnapshot | null>;
  compose: () => Promise<SessionSnapshot | null>;
  resume: () => Promise<SessionSnapshot | null>;
  explore: (sceneId: string, version: number) => Promise<SessionSnapshot | null>;
  action: (instanceId: string, actionId: string) => Promise<SessionSnapshot | null>;
  feedback: (input: FeedbackInput) => Promise<SessionSnapshot | null>;
  reset: () => void;
  retry: () => void;
  dismiss: () => void;
  fail: (text: string) => void;
}

/**
 * 会话状态：界面只持有后端快照，不在前端推演业务状态。
 * 每个动作返回新快照；失败返回 null（调用方据此决定是否保留用户输入）。
 */
export function useSession() {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const adopt = useCallback((s: SessionSnapshot) => {
    setSnap(s);
    writeText(KEYS.session, s.sessionId);
  }, []);

  const restore = useCallback(async () => {
    // 支持 ?session=<id> 直接打开某个本地会话，便于演示与排查。
    const queryId = new URLSearchParams(window.location.search).get("session");
    const id = queryId ?? readText(KEYS.session);
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      adopt(await api.get(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // 会话已不存在（被清理或换了存储目录）：忘掉它，回到首页，而不是一直报错。
        remove(KEYS.session);
        setNotice({ tone: "neutral", text: "上次的咨询记录已不存在，可以开始新的咨询。" });
      } else {
        setNotice({ tone: "danger", text: e instanceof Error ? e.message : "恢复会话失败" });
      }
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const run = useCallback(
    async (call: (s: SessionSnapshot | null) => Promise<SessionSnapshot>): Promise<SessionSnapshot | null> => {
      setBusy(true);
      setNotice(null);
      try {
        const next = await call(snapRef.current);
        adopt(next);
        return next;
      } catch (e) {
        if (e instanceof ApiError && e.snapshot) adopt(e.snapshot);
        setNotice({ tone: "danger", text: e instanceof Error ? e.message : "请求失败" });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const withSnap = useCallback(
    (fn: (s: SessionSnapshot) => Promise<SessionSnapshot>) =>
      run((s) => {
        if (!s) return Promise.reject(new Error("当前没有进行中的咨询"));
        return fn(s);
      }),
    [run],
  );

  const actions: SessionActions = {
    create: (text) => run(() => api.create(text)),
    send: (text) => withSnap((s) => api.message(s, text)),
    answer: (answers) => withSnap((s) => api.answers(s, answers)),
    confirm: () => withSnap((s) => api.confirm(s)),
    compose: () => withSnap((s) => api.compose(s)),
    resume: () => withSnap((s) => api.resume(s)),
    explore: (sceneId, version) => withSnap((s) => api.explore(s, sceneId, version)),
    action: (instanceId, actionId) => withSnap((s) => api.action(s, instanceId, actionId)),
    feedback: (input) => withSnap((s) => api.feedback(s, input)),
    reset: () => {
      setSnap(null);
      setNotice(null);
      remove(KEYS.session);
      remove(KEYS.activeInstance);
      if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    },
    retry: () => void restore(),
    dismiss: () => setNotice(null),
    fail: (text) => setNotice({ tone: "danger", text }),
  };

  return { snap, loading, busy, notice, actions };
}

/** 本地服务的连接状态（首页展示能力与限制用）。 */
export function useBackendStatus() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      setStatus(await api.status());
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "无法连接本地服务");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { status, error, reload: load };
}
