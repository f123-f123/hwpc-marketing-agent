import {
  API_PATHS,
  ConfirmResponseSchema,
  ConnectionStatusSchema,
  SessionSnapshotSchema,
  type ConnectionStatus,
  type FeedbackKind,
  type SessionSnapshot,
} from "@hwpc/contracts";

/** 只依赖 safeParse 的最小形状，web 包不需要直接依赖 zod。 */
export interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/** 后端返回的业务错误。snapshot 存在时表示服务端附带了最新快照（如过期写入），界面应直接采用。 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly snapshot?: SessionSnapshot,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_MESSAGE = "无法连接本地服务，请确认后端已启动（npm run dev）";

/** 读取响应体；不是 JSON（代理报错页、空响应）时返回 undefined，而不是把解析异常抛给用户。 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toApiError(response: Response, body: unknown): ApiError {
  const err = (body as { error?: { code?: string; message?: string; details?: { snapshot?: unknown } } } | undefined)?.error;
  const latest = SessionSnapshotSchema.safeParse(err?.details?.snapshot);
  const fallback = response.status >= 500 && !err ? NETWORK_MESSAGE : `请求失败（HTTP ${response.status}）`;
  return new ApiError(err?.message ?? fallback, response.status, err?.code, latest.success ? latest.data : undefined);
}

/**
 * 调用后端并按契约校验响应。传 body 时默认 POST；需要其他方法时传 method。
 * 登录状态放在 HttpOnly Cookie 里，同源请求会自动带上。
 */
export async function call<T>(path: string, schema: Schema<T>, body?: unknown, method?: "POST" | "PUT" | "PATCH" | "DELETE"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      path,
      body === undefined && !method
        ? undefined
        : { method: method ?? "POST", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) },
    );
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0);
  }
  const data = await readBody(response);
  if (!response.ok) throw toApiError(response, data);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError("后端响应与公共契约不一致，请确认前后端版本一致", response.status);
  return parsed.data;
}

const snapshot = (path: string, body?: unknown) => call(path, SessionSnapshotSchema, body);

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  instanceId?: string;
  conditionKey?: string;
}

export const api = {
  status: (): Promise<ConnectionStatus> => call(API_PATHS.status, ConnectionStatusSchema),
  create: (text: string) => snapshot(API_PATHS.sessions, { text }),
  get: (id: string) => snapshot(API_PATHS.session(id)),
  message: (s: SessionSnapshot, text: string) => snapshot(API_PATHS.sessionMessages(s.sessionId), { text, baseRevision: s.revision }),
  answers: (s: SessionSnapshot, answers: { questionId: string; answer: string }[]) =>
    snapshot(API_PATHS.sessionAnswers(s.sessionId), { answers, baseRevision: s.revision }),
  confirm: async (s: SessionSnapshot) =>
    (
      await call(API_PATHS.sessionConfirm(s.sessionId), ConfirmResponseSchema, {
        needVersion: s.needs.version,
        fingerprint: s.needs.summary.fingerprint,
        baseRevision: s.revision,
      })
    ).snapshot,
  compose: (s: SessionSnapshot) => snapshot(API_PATHS.sessionPlan(s.sessionId), { baseRevision: s.revision }),
  explore: (s: SessionSnapshot, sceneId: string, version: number) =>
    snapshot(API_PATHS.sessionExplore(s.sessionId), { sceneId, version, baseRevision: s.revision }),
  action: (s: SessionSnapshot, instanceId: string, actionId: string) =>
    snapshot(API_PATHS.sessionAction(s.sessionId, instanceId), { actionId, baseRevision: s.revision }),
  feedback: (s: SessionSnapshot, input: FeedbackInput) => snapshot(API_PATHS.sessionFeedback(s.sessionId), { ...input, baseRevision: s.revision }),
  resume: (s: SessionSnapshot) => snapshot(`${API_PATHS.session(s.sessionId)}/resume`, { baseRevision: s.revision }),
  exportUrl: (s: SessionSnapshot) => `${API_PATHS.sessionExport(s.sessionId)}?format=recovery_html`,
};
