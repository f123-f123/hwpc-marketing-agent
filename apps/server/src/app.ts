import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  API_ERROR_HTTP_STATUS,
  API_PATHS,
  AnswerRequestSchema,
  CreateTaskRequestSchema,
  DataServiceError,
  ExportQuerySchema,
  MarketingTaskInputSchema,
  ModelServiceError,
  ProductSearchQuerySchema,
  ReviseRequestSchema,
  type ApiErrorCode,
  type ConnectionStatus,
  type DataService,
  type ExportResponse,
  type ModelService,
  AnswersRequestSchema, ComposePlanRequestSchema, ConfirmRequestSchema, CreateSessionRequestSchema,
  ExploreRequestSchema, FeedbackRequestSchema, MessageRequestSchema, NeedEditRequestSchema,
  SceneActionRequestSchema, SessionExportQuerySchema,
  verifyRecoveryPack,
} from "@hwpc/contracts";
import { renderExport } from "./export.js";
import { renderRecoveryHtml } from "./recoveryHtml.js";
import { TaskError, type TaskManager } from "./tasks.js";
import { SessionError } from "./errors.js";
import { StorageError } from "./store.js";
import { AuthError } from "./marketing/auth.js";
import { registerMarketingRoutes, type MarketingModule } from "./marketing/routes.js";
import { MarketingError } from "./marketing/service.js";
import type { SessionManager } from "./sessions.js";

export interface AppDeps {
  data: DataService;
  model: ModelService;
  tasks: TaskManager;
  sessions?: SessionManager;
  /** 门店推文模块（登录、任务、稿件、发布）。 */
  marketing?: MarketingModule;
  dataMode?: "auto" | "mock" | "local" | "ima";
  corsOrigin: string;
  /** 配置的资料模式，用于计算 activeDataOrigin。 */
  version?: string;
}

function fail(c: Context, code: ApiErrorCode, message: string, details?: unknown) {
  return c.json({ error: { code, message, details } }, API_ERROR_HTTP_STATUS[code] as 400);
}

const ResumeRequestSchema = z.object({ baseRevision: z.number().int().nonnegative().optional() });

class ValidationFailure extends Error {
  constructor(public zod: z.ZodError) {
    super("请求不合法");
  }
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("/api/*", cors({ origin: deps.corsOrigin }));

  app.onError((err, c) => {
    if (err instanceof ValidationFailure) return fail(c, "validation_error", "请求不合法", err.zod.issues);
    if (err instanceof TaskError) return fail(c, err.code, err.message);
    if (err instanceof SessionError) return fail(c, err.code, err.message, err.details);
    if (err instanceof DataServiceError) return fail(c, "data_unavailable", err.message, { code: err.code, origin: err.origin });
    if (err instanceof ModelServiceError) return fail(c, "model_unavailable", err.message, { code: err.code });
    if (err instanceof AuthError) return fail(c, err.code, err.message);
    if (err instanceof MarketingError) return fail(c, err.code, err.message);
    if (err instanceof z.ZodError) return fail(c, "validation_error", "请求不合法", err.issues);
    if (err instanceof StorageError) return err.kind === "invalid_id" ? fail(c, "not_found", err.message) : fail(c, "storage_error", err.message);
    if (err instanceof SyntaxError) return fail(c, "validation_error", "请求体不是合法 JSON");
    console.error("[server] 未处理异常:", err instanceof Error ? err.message : err);
    return fail(c, "internal_error", "服务内部错误");
  });

  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const r = schema.safeParse(await c.req.json());
    if (!r.success) throw new ValidationFailure(r.error);
    return r.data;
  };

  /** 请求体可以为空（旧客户端不发 body）。 */
  const optionalBody = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const text = await c.req.text();
    const r = schema.safeParse(text.trim() ? JSON.parse(text) : {});
    if (!r.success) throw new ValidationFailure(r.error);
    return r.data;
  };

  app.get(API_PATHS.health, (c) => c.json({ ok: true, version: deps.version ?? "0.1.0" }));

  app.get(API_PATHS.status, async (c) => {
    const [sources, model] = await Promise.all([deps.data.getStatus(), deps.model.getStatus()]);
    const active = deps.dataMode === "auto" || !deps.dataMode
      ? sources.find((s) => s.origin === "ima" && s.state === "connected") ?? sources.find((s) => s.origin === "local" && s.state === "connected")
      : sources.find((s) => s.origin === deps.dataMode && s.state === "connected");
    const status: ConnectionStatus = {
      activeDataOrigin: active?.origin ?? "mock",
      sources,
      model,
      mockInUse: !active || active.origin === "mock" || model.provider === "mock",
      serverTime: new Date().toISOString(),
    };
    return c.json(status);
  });

  app.get(API_PATHS.productSearch, async (c) => {
    const q = ProductSearchQuerySchema.safeParse({ q: c.req.query("q") });
    if (!q.success) return fail(c, "validation_error", "缺少查询参数 q", q.error.issues);
    return c.json(await deps.data.searchProducts(q.data.q));
  });

  if (deps.sessions) {
    const s = deps.sessions;
    app.get(API_PATHS.capabilities, (c) => c.json(s.capabilities()));
    app.get(API_PATHS.scenes, (c) => c.json(s.catalog()));
    app.get("/api/scenes/:id/:version", (c) => c.json(s.scene(c.req.param("id"), Number(c.req.param("version")))));
    app.get(API_PATHS.sessions, (c) => {
      const list = s.list();
      return c.json({ sessions: list.filter((x) => "updatedAt" in x), unreadable: list.filter((x) => "unreadable" in x).map((x) => ({ sessionId: x.sessionId, reason: x.unreadable })) });
    });
    app.post(API_PATHS.sessions, async (c) => c.json(await s.create((await body(c, CreateSessionRequestSchema)).text), 201));
    app.get("/api/sessions/:id", (c) => c.json(s.get(c.req.param("id"))));
    app.post("/api/sessions/:id/messages", async (c) => { const b = await body(c, MessageRequestSchema); return c.json(await s.message(c.req.param("id"), b.text, b.baseRevision)); });
    app.post("/api/sessions/:id/answers", async (c) => { const b = await body(c, AnswersRequestSchema); return c.json(await s.answer(c.req.param("id"), b.answers, b.freeText, b.baseRevision)); });
    app.post("/api/sessions/:id/needs", async (c) => { const b = await body(c, NeedEditRequestSchema); return c.json(await s.editNeeds(c.req.param("id"), b.edits, b.baseRevision)); });
    app.post("/api/sessions/:id/confirm", async (c) => { const b = await body(c, ConfirmRequestSchema); return c.json(await s.confirm(c.req.param("id"), b.needVersion, b.fingerprint, b.baseRevision)); });
    app.post("/api/sessions/:id/plan", async (c) => { const b = await body(c, ComposePlanRequestSchema); return c.json(await s.compose(c.req.param("id"), b.baseRevision)); });
    app.post("/api/sessions/:id/explore", async (c) => { const b = await body(c, ExploreRequestSchema); return c.json(await s.explore(c.req.param("id"), b.sceneId, b.version, b.baseRevision)); });
    app.post("/api/sessions/:id/instances/:instanceId/actions", async (c) => { const b = await body(c, SceneActionRequestSchema); return c.json(await s.action(c.req.param("id"), c.req.param("instanceId"), b.actionId, b.baseRevision)); });
    app.post("/api/sessions/:id/feedback", async (c) => c.json(await s.feedback(c.req.param("id"), await body(c, FeedbackRequestSchema))));
    app.post("/api/sessions/:id/resume", async (c) => { const b = await optionalBody(c, ResumeRequestSchema); return c.json(await s.resume(c.req.param("id"), b.baseRevision)); });
    app.get("/api/sessions/:id/export", (c) => {
      const q = SessionExportQuerySchema.safeParse({ format: c.req.query("format"), planVersion: c.req.query("planVersion") });
      if (!q.success) return fail(c, "validation_error", "导出参数不合法", q.error.issues);
      const pack = s.export(c.req.param("id"), q.data.planVersion);
      if (q.data.format === "recovery_json") return c.json(pack);
      return c.html(renderRecoveryHtml(pack));
    });
    app.post(API_PATHS.recoveryVerify, async (c) => c.json(verifyRecoveryPack(await c.req.json())));
  }

  app.post(API_PATHS.tasks, async (c) => {
    const { input } = await body(c, CreateTaskRequestSchema);
    const snap = deps.tasks.create(MarketingTaskInputSchema.parse(input));
    return c.json({ taskId: snap.taskId, status: snap.status }, 202);
  });

  app.get("/api/tasks/:id", (c) => c.json(deps.tasks.get(c.req.param("id"))));

  app.get("/api/tasks/:id/events", (c) => {
    const after = Number(c.req.query("after") ?? 0);
    if (!Number.isInteger(after) || after < 0) return fail(c, "validation_error", "after 必须是非负整数");
    return c.json(deps.tasks.events(c.req.param("id"), after));
  });

  app.post("/api/tasks/:id/answers", async (c) => {
    const { answers } = await body(c, AnswerRequestSchema);
    const snap = deps.tasks.answer(c.req.param("id"), answers);
    return c.json({ taskId: snap.taskId, status: snap.status }, 202);
  });

  app.post("/api/tasks/:id/revisions", async (c) => {
    const { instruction, inputPatch } = await body(c, ReviseRequestSchema);
    const snap = deps.tasks.revise(c.req.param("id"), instruction, inputPatch);
    return c.json({ taskId: snap.taskId, status: snap.status }, 202);
  });

  app.get("/api/tasks/:id/export", (c) => {
    const q = ExportQuerySchema.safeParse({ format: c.req.query("format"), version: c.req.query("version") });
    if (!q.success) return fail(c, "validation_error", "导出参数不合法", q.error.issues);
    const v = deps.tasks.getVersion(c.req.param("id"), q.data.version);
    const { content, ext } = renderExport(v, q.data.format);
    const res: ExportResponse = {
      taskId: c.req.param("id"),
      version: v.version,
      format: q.data.format,
      filename: `article-v${v.version}${v.isMock ? "-MOCK" : ""}.${ext}`,
      content,
      isMock: v.isMock,
      deliveryStatus: v.verification.deliveryStatus,
    };
    return c.json(res);
  });

  // 图片统一经服务端读取，凭证不出服务端。imageId 必须属于该任务的资料包。
  app.get("/api/tasks/:id/images/:imageId", async (c) => {
    const v = deps.tasks.getVersion(c.req.param("id"));
    const image = v.materialPack.images.find((i) => i.imageId === c.req.param("imageId"));
    if (!image) return fail(c, "not_found", "图片不在该任务资料包中");
    const content = await deps.data.readImage(image);
    return new Response(content.bytes as unknown as ConstructorParameters<typeof Response>[0], {
      headers: { "content-type": content.mimeType, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" },
    });
  });

  if (deps.marketing) registerMarketingRoutes(app, deps.marketing, body);

  app.notFound((c) => fail(c, "not_found", "接口不存在"));
  return app;
}
