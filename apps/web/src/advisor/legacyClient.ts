/**
 * 旧接口适配器（legacy-api）：把现有 /api/tasks 系列映射成 AdvisorSnapshot。
 *
 * 现有 API 没有：需求摘要与确认、对话恢复、互动方案、HTML 导出、版本化图片访问。
 * 适配器不伪造这些能力：capabilities 对应项为 false，界面据此禁用或如实说明。
 * 特别地，旧后端在信息齐全后会直接生成作品，前端无法在其前面加"确认门"，
 * 因此作品会标注"未经需求确认流程生成"。
 */
import {
  API_PATHS,
  ApiErrorBodySchema,
  ConnectionStatusSchema,
  CreateTaskResponseSchema,
  AcceptedResponseSchema,
  ExportResponseSchema,
  GetEventsResponseSchema,
  ResultVersionSchema,
  TaskSnapshotSchema,
  type ConnectionStatus,
  type ExecutionEvent,
  type TaskSnapshot,
} from "@hwpc/contracts";
import type { FeedbackRecord, PlanProgress } from "@hwpc/scenes";
import { AdvisorApiError, type AdvisorClient, type ConfirmResult, type SubmitAnswersRequest, type SummaryEdit, type SummaryRef } from "./client";
import type { AdvisorSnapshot, Capabilities, Phase, ProgressStep, RequirementItem, WorkView } from "./types";

const LAST_KEY = "hwpc.legacy.last-task";
const CAPS: Capabilities = {
  requirementConfirmation: false,
  conversationRestore: false,
  amendMessages: false,
  freeTextAcrossQuestions: false,
  interactivePlan: false,
  versionedImages: false,
  historyVersions: true,
  resume: false,
  personalPlan: false,
  serverProgress: false,
  feedbackToBackend: false,
};

const PLATFORM = { wechat_article: "公众号", xiaohongshu: "小红书", store_moments: "门店朋友圈", store_poster: "门店海报" } as const;
const SCENARIO: Record<string, string> = {
  back_to_school: "开学季", business_office: "职场办公", content_creation: "内容创作", family_upgrade: "家庭换新",
  enterprise_procurement: "企业采购", store_visit: "门店到访", new_launch: "新品首发", holiday: "节日营销", other: "其他",
};

interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}
async function call<T>(url: string, schema: Parser<T>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new AdvisorApiError("network", "无法连接后端服务，请确认服务已启动。", true);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new AdvisorApiError("bad_response", `后端返回了无法解析的内容（HTTP ${res.status}）`, true);
  }
  if (!res.ok) {
    const e = ApiErrorBodySchema.safeParse(json);
    if (e.success) throw new AdvisorApiError(e.data.error.code, e.data.error.message, res.status >= 500);
    throw new AdvisorApiError("http_error", `请求失败（HTTP ${res.status}）`, true);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AdvisorApiError("contract_mismatch", "后端返回的数据与契约不一致", false);
  return parsed.data;
}

export async function fetchConnectionStatus(): Promise<ConnectionStatus> {
  return call(API_PATHS.status, ConnectionStatusSchema);
}

const unsupported = (what: string) =>
  new AdvisorApiError("unsupported", `当前后端接口尚未提供“${what}”，需要主 Agent 同步契约（见 integration-notes.md）。`, false);

export class LegacyAdvisorClient implements AdvisorClient {
  readonly kind = "legacy-api" as const;
  private status: ConnectionStatus | null = null;

  async createSession(text: string): Promise<AdvisorSnapshot> {
    const r = await call(API_PATHS.tasks, CreateTaskResponseSchema, { method: "POST", body: JSON.stringify({ input: { rawRequest: text } }) });
    localStorage.setItem(LAST_KEY, r.taskId);
    const snap = await this.getSnapshot(r.taskId);
    if (!snap) throw new AdvisorApiError("not_found", "任务创建后无法读取", true);
    return snap;
  }

  async getSnapshot(sessionId: string): Promise<AdvisorSnapshot | null> {
    let task: TaskSnapshot;
    try {
      task = await call(API_PATHS.task(sessionId), TaskSnapshotSchema);
    } catch (e) {
      if (e instanceof AdvisorApiError && e.code === "not_found") return null;
      throw e;
    }
    const [events, status] = await Promise.all([
      call(`${API_PATHS.events(sessionId)}?after=0`, GetEventsResponseSchema),
      this.status ? Promise.resolve(this.status) : fetchConnectionStatus().catch(() => null),
    ]);
    if (status) this.status = status;
    return this.toSnapshot(task, events.events, status);
  }

  async sendMessage(sessionId: string, text: string, _base: number): Promise<AdvisorSnapshot> {
    const snap = await this.getSnapshot(sessionId);
    if (snap?.phase === "delivered") {
      await call(API_PATHS.revisions(sessionId), AcceptedResponseSchema, { method: "POST", body: JSON.stringify({ instruction: text }) });
      return (await this.getSnapshot(sessionId))!;
    }
    throw unsupported("多轮自由对话");
  }

  async submitAnswers(sessionId: string, req: SubmitAnswersRequest): Promise<AdvisorSnapshot> {
    const body = { answers: req.answers.map((a) => ({ questionId: a.questionId, answer: a.optionValue ?? a.text ?? "" })).filter((a) => a.answer) };
    if (!body.answers.length) throw unsupported("一个回答覆盖多个问题");
    await call(API_PATHS.answers(sessionId), AcceptedResponseSchema, { method: "POST", body: JSON.stringify(body) });
    return (await this.getSnapshot(sessionId))!;
  }

  async editMessage(): Promise<AdvisorSnapshot> {
    throw unsupported("修改前面的表达");
  }
  async confirmSummary(_s: string, _r: SummaryRef): Promise<ConfirmResult> {
    throw unsupported("需求确认");
  }
  async reviseSummary(_s: string, _r: SummaryRef, _e: SummaryEdit[]): Promise<AdvisorSnapshot> {
    throw unsupported("修改需求摘要");
  }
  async continueDiscussion(): Promise<AdvisorSnapshot> {
    throw unsupported("继续讨论");
  }
  async requestWorkRevision(sessionId: string, instruction: string, _v: number): Promise<AdvisorSnapshot> {
    await call(API_PATHS.revisions(sessionId), AcceptedResponseSchema, { method: "POST", body: JSON.stringify({ instruction }) });
    return (await this.getSnapshot(sessionId))!;
  }
  async requestRequirementChange(): Promise<AdvisorSnapshot> {
    throw unsupported("关键需求变更后重新确认");
  }
  async resume(sessionId: string): Promise<AdvisorSnapshot> {
    const s = await this.getSnapshot(sessionId);
    if (!s) throw new AdvisorApiError("not_found", "任务不存在", false);
    return s;
  }

  async getPlan(): Promise<null> {
    return null;
  }
  async loadProgress(_s: string, planVersion: number): Promise<PlanProgress> {
    return { planId: "", planVersion, records: {}, feedback: [], storage: "none", updatedAt: new Date(0).toISOString() };
  }
  async saveProgress(_s: string, p: PlanProgress): Promise<PlanProgress> {
    return p;
  }
  async sendFeedback(): Promise<FeedbackRecord> {
    throw unsupported("体验反馈");
  }

  async getWork(sessionId: string, version: number): Promise<WorkView> {
    const exp = await call(`${API_PATHS.exportResult(sessionId)}?format=json&version=${version}`, ExportResponseSchema);
    const result = ResultVersionSchema.parse(JSON.parse(exp.content));
    const snap = await this.getSnapshot(sessionId);
    const meta = snap?.versions.find((v) => v.version === version);
    if (!meta) throw new AdvisorApiError("not_found", `版本 ${version} 不存在`, false);
    return { version, meta, result };
  }

  /** 旧接口的图片地址不带版本，只在最新版本使用；历史版本返回 null，避免加载到新版本的图片。 */
  imageUrl(sessionId: string, version: number, imageId: string): string | null {
    const latest = this.latestVersionCache.get(sessionId);
    return latest === version ? API_PATHS.image(sessionId, imageId) : null;
  }
  private latestVersionCache = new Map<string, number>();

  async exportText(sessionId: string, version: number, format: "markdown" | "text" | "json") {
    return call(`${API_PATHS.exportResult(sessionId)}?format=${format}&version=${version}`, ExportResponseSchema);
  }

  private toSnapshot(task: TaskSnapshot, events: ExecutionEvent[], status: ConnectionStatus | null): AdvisorSnapshot {
    const i = task.input;
    const req = (key: RequirementItem["key"], label: string, value: string | undefined, basis?: string): RequirementItem => ({
      key, label, value: value ?? null, provenance: value ? "user_said" : "pending", basis,
    });
    const requirements: RequirementItem[] = [
      req("audience", "面向人群", i.audience),
      req("problem", "主要问题", undefined),
      req("goal", "营销目标", i.contentGoal),
      req("productScope", "产品范围", i.productQuery),
      req("channel", "发布渠道", i.platform ? PLATFORM[i.platform] : undefined),
      req("direction", "核心方向", i.scenario ? SCENARIO[i.scenario] : undefined),
      req("constraints", "限制", i.extraRequirements),
    ];
    const phase: Phase =
      task.status === "failed" ? "failed" : task.status === "awaiting_clarification" ? "discussing" : task.status === "completed" ? "delivered" : "producing";
    const progress: ProgressStep[] = events
      .filter((e) => e.type === "stage_started" || e.type === "stage_completed" || e.type === "stage_failed" || e.type === "data_access")
      .map((e) => ({
        stepId: `ev-${e.seq}`,
        purpose: e.message,
        state: e.type === "stage_failed" ? "failed" : e.type === "stage_started" ? "running" : "done",
        origin: e.type === "data_access" ? (status?.activeDataOrigin ?? "mock") : "model",
        simulated: e.simulated,
      }));
    const mock = status ? status.mockInUse : true;
    if (task.latestVersion) this.latestVersionCache.set(task.taskId, task.latestVersion.version);
    const latest = task.versions.at(-1)?.version;
    return {
      sessionId: task.taskId,
      revision: task.eventCount * 1000 + task.versions.length,
      requirementVersion: 0,
      phase,
      messages: [
        { messageId: "m-0", role: "user", text: i.rawRequest ?? i.productQuery ?? "（任务输入）", at: task.createdAt, editable: false },
      ],
      requirements,
      questions: task.pendingQuestions.map((q) => ({
        questionId: q.questionId,
        category: q.kind === "conflict_confirmation" || q.kind === "claim_confirmation" ? "material" : "preference",
        prompt: q.prompt,
        options: q.options ?? [],
        allowFreeText: q.allowFreeText,
      })),
      gaps: [],
      planVersions: [],
      progress,
      candidates: [],
      versions: task.versions.map((v) => ({
        version: v.version,
        requirementVersion: 0,
        createdAt: v.createdAt,
        reason: v.reason,
        // 旧接口无需求版本概念：只有最新版本被视为当前版本。
        currentRequirement: v.version === latest,
        staleReason: v.version === latest ? undefined : "已有更新的作品版本",
        deliveryStatus: task.latestVersion && v.version === task.latestVersion.version ? task.latestVersion.verification.deliveryStatus : "needs_confirmation",
        isMock: mock,
      })),
      capabilities: CAPS,
      backend: {
        kind: "legacy-api",
        label: "现有后端接口（旧版契约）",
        dataOrigin: status?.activeDataOrigin ?? "mock",
        modelProvider: status?.model.provider ?? "mock",
        modelSimulated: status ? status.model.provider === "mock" : true,
        mockInUse: mock,
        notes: [
          "现有接口没有需求摘要与确认、对话恢复、互动方案、HTML 导出。",
          "信息齐全后后端会直接生成作品，前端无法在其前面加确认门。",
        ],
      },
      error: task.error ? { code: task.error.code, message: task.error.message, recoverable: false } : undefined,
    };
  }
}

export function lastLegacyTaskId(): string | null {
  return localStorage.getItem(LAST_KEY);
}
