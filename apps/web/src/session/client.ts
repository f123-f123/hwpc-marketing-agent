import { API_PATHS, SessionSnapshotSchema, type SessionSnapshot } from "@hwpc/contracts";

export class SessionHttpError extends Error {
  constructor(message: string, public snapshot?: SessionSnapshot) { super(message); }
}

async function request(path: string, body?: unknown): Promise<SessionSnapshot> {
  const response = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: { message?: string; details?: { snapshot?: unknown } } };
    const latest = SessionSnapshotSchema.safeParse(error.error?.details?.snapshot);
    throw new SessionHttpError(error.error?.message ?? `请求失败 (${response.status})`, latest.success ? latest.data : undefined);
  }
  const parsed = SessionSnapshotSchema.safeParse(data);
  if (!parsed.success) throw new SessionHttpError("后端会话响应与公共契约不一致");
  return parsed.data;
}

export const sessionClient = {
  create: (text: string) => request(API_PATHS.sessions, { text }),
  get: (id: string) => request(API_PATHS.session(id)),
  message: (s: SessionSnapshot, text: string) => request(API_PATHS.sessionMessages(s.sessionId), { text, baseRevision: s.revision }),
  answers: (s: SessionSnapshot, answers: { questionId: string; answer: string }[], freeText?: string) =>
    request(API_PATHS.sessionAnswers(s.sessionId), { answers, freeText, baseRevision: s.revision }),
  confirm: async (s: SessionSnapshot) => {
    const response = await fetch(API_PATHS.sessionConfirm(s.sessionId), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ needVersion: s.needs.version, fingerprint: s.needs.summary.fingerprint, baseRevision: s.revision }),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = data as { error?: { message?: string; details?: { snapshot?: unknown } } };
      const latest = SessionSnapshotSchema.safeParse(error.error?.details?.snapshot);
      throw new SessionHttpError(error.error?.message ?? "确认失败", latest.success ? latest.data : undefined);
    }
    const result = data as { snapshot?: unknown };
    return SessionSnapshotSchema.parse(result.snapshot);
  },
  compose: (s: SessionSnapshot) => request(API_PATHS.sessionPlan(s.sessionId), { baseRevision: s.revision }),
  explore: (s: SessionSnapshot, sceneId: string, version: number) => request(API_PATHS.sessionExplore(s.sessionId), { sceneId, version, baseRevision: s.revision }),
  action: (s: SessionSnapshot, instanceId: string, actionId: string) => request(API_PATHS.sessionAction(s.sessionId, instanceId), { actionId, baseRevision: s.revision }),
  feedback: (s: SessionSnapshot, body: Record<string, unknown>) => request(API_PATHS.sessionFeedback(s.sessionId), { ...body, baseRevision: s.revision }),
  resume: (s: SessionSnapshot) => request(`${API_PATHS.session(s.sessionId)}/resume`, { baseRevision: s.revision }),
};
