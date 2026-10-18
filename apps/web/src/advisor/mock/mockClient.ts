/**
 * 界面模拟服务（MOCK-UI）。
 *
 * 用途：契约尚未提供需求确认、对话恢复、互动方案、HTML 导出时，让前端能够开发与验证。
 * 它在浏览器里模拟"服务端"：会话记录保存在 localStorage（代表服务端存储），
 * 刷新后据此重放恢复，界面本身不保存确认状态。
 * 它不调用任何模型或资料源，产生的一切进度都标记 simulated=true。
 *
 * 这不是一套新的跨模块接口：形状见 ../client.ts，将作为接口需求提交给主 Agent。
 */
import type { ResultVersion } from "@hwpc/contracts";
import type { FeedbackEvent, FeedbackRecord, PersonalPlan, PlanProgress } from "@hwpc/scenes";
import { buildMockPlan } from "./planBuilder";
import {
  AdvisorApiError,
  type AdvisorClient,
  type ConfirmResult,
  type SubmitAnswersRequest,
  type SummaryEdit,
  type SummaryRef,
} from "../client";
import type { AdvisorSnapshot, Capabilities, ProgressStep, WorkVersionMeta, WorkView } from "../types";
import { replay, type Derived, type Input } from "./replay";
import { buildMockInteractive, buildMockWork, type Scope } from "./workBuilder";

const STORE_KEY = "hwpc.mock-ui.sessions.v1";
const LAST_KEY = "hwpc.mock-ui.last-session";

interface WorkRecord {
  version: number;
  requirementVersion: number;
  reason: "initial" | "revision";
  instruction?: string;
  scope: Scope;
  battery: "omit" | "force";
  audience: string;
  interactive: boolean;
  createdAt: string;
  basisSummaryId: string;
}

interface Job {
  kind: "retrieval" | "work";
  step: number;
}

interface SessionRecord {
  id: string;
  revision: number;
  inputs: Input[];
  works: WorkRecord[];
  progress: ProgressStep[];
  job: Job | null;
  dev: { failRetrieval?: boolean; failWork?: boolean };
  /** 体验进度与反馈：模拟服务端之外的"浏览器本地缓存"，如实标注，不称服务端持久化。 */
  planProgress?: Record<string, PlanProgress>;
  feedbackLog?: FeedbackRecord[];
}

const RETRIEVAL_STEPS = [
  "确认候选型号范围（按你的人群与渠道）",
  "查看候选型号的携带与接口资料",
  "查看续航资料及其来源差异",
  "检查可用图片与适用型号",
];
const WORK_STEPS = ["整理已确认需求与可用事实", "按平台结构编排图文", "逐条核验产品事实与图片型号", "合规检查与互动方案核验"];

const CAPS: Capabilities = {
  requirementConfirmation: true,
  conversationRestore: true,
  amendMessages: true,
  freeTextAcrossQuestions: true,
  interactivePlan: true,
  versionedImages: true,
  historyVersions: true,
  resume: true,
  personalPlan: true,
  serverProgress: false,
  feedbackToBackend: false,
};

const now = () => new Date().toISOString();

/** 开发辅助：只在 MOCK-UI 下由界面暴露，用来触发异常路径。 */
export interface MockDevControls {
  setFailNextRetrieval(sessionId: string, v: boolean): void;
  setFailNextWork(sessionId: string, v: boolean): void;
  simulateOtherWindowEdit(sessionId: string): void;
  speed: { value: number };
}

function load(): Record<string, SessionRecord> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, SessionRecord>;
  } catch {
    return {};
  }
}

export class MockAdvisorClient implements AdvisorClient, MockDevControls {
  readonly kind = "mock-ui" as const;
  readonly speed = { value: 1 };
  private sessions: Record<string, SessionRecord> = load();
  /** 进程内存里真正在跑的任务；刷新后丢失，用来模拟"任务中断"。 */
  private live = new Map<string, number>();
  private listeners = new Set<(id: string) => void>();

  /* ---------------- 订阅：模拟服务端推送后的轮询效果 ---------------- */
  subscribe(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(id: string) {
    this.listeners.forEach((f) => f(id));
  }
  private save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(this.sessions));
  }
  private require(id: string): SessionRecord {
    const s = this.sessions[id];
    if (!s) throw new AdvisorApiError("not_found", "会话不存在", false);
    return s;
  }
  private commit(s: SessionRecord) {
    s.revision += 1;
    this.save();
    this.emit(s.id);
  }
  private wait(ms: number) {
    return new Promise<void>((r) => setTimeout(r, Math.max(30, ms / this.speed.value)));
  }

  /* ---------------- 开发辅助 ---------------- */
  setFailNextRetrieval(id: string, v: boolean) {
    const s = this.require(id);
    s.dev.failRetrieval = v;
    this.save();
  }
  setFailNextWork(id: string, v: boolean) {
    const s = this.require(id);
    s.dev.failWork = v;
    this.save();
  }
  /** 模拟另一个窗口改了需求：产生新的摘要版本，旧摘要标识随之失效。 */
  simulateOtherWindowEdit(id: string) {
    const s = this.require(id);
    const d = replay(id, s.inputs);
    if (d.stage !== "summary") throw new AdvisorApiError("invalid_state", "当前没有待确认的摘要", false);
    s.inputs.push({ kind: "summary_edit", edits: [{ key: "constraints", value: "不写价格与优惠；不拿竞品做对比" }], at: now(), source: "other_window" });
    this.commit(s);
  }

  /* ---------------- AdvisorClient ---------------- */

  async createSession(text: string): Promise<AdvisorSnapshot> {
    await this.wait(120);
    const id = `ms-${Math.random().toString(36).slice(2, 10)}`;
    const s: SessionRecord = { id, revision: 1, inputs: [{ kind: "msg", text, at: now() }], works: [], progress: [], job: null, dev: {} };
    this.sessions[id] = s;
    localStorage.setItem(LAST_KEY, id);
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async getSnapshot(sessionId: string): Promise<AdvisorSnapshot | null> {
    const s = this.sessions[sessionId];
    if (!s) return null;
    return this.snapshot(s);
  }

  private guard(s: SessionRecord, baseRevision: number) {
    if (baseRevision !== s.revision) throw new AdvisorApiError("stale_revision", "页面内容已过期，已为你刷新到最新状态。", true);
  }

  async sendMessage(sessionId: string, text: string, baseRevision: number): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    this.guard(s, baseRevision);
    await this.wait(80);
    const d = replay(s.id, s.inputs);
    if (d.phase === "producing" || d.phase === "retrieving") throw new AdvisorApiError("invalid_state", "正在处理中，请等待完成后再补充。", true);
    if (d.phase === "delivered") {
      s.inputs.push({ kind: "work_revision", instruction: text, at: now() });
    } else {
      s.inputs.push({ kind: "msg", text, at: now() });
    }
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async submitAnswers(sessionId: string, req: SubmitAnswersRequest): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    this.guard(s, req.baseRevision);
    await this.wait(80);
    s.inputs.push({ kind: "answers", items: req.answers, freeText: req.freeText, at: now() });
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async editMessage(sessionId: string, messageId: string, text: string, baseRevision: number): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    this.guard(s, baseRevision);
    const d = replay(s.id, s.inputs);
    const m = d.messages.find((x) => x.messageId === messageId);
    if (!m || !m.editable) throw new AdvisorApiError("invalid_state", "这条表达已不能修改（已进入制作或已被确认使用）。", false);
    const idx = Number(messageId.split("-")[1]);
    this.cancelJob(s);
    s.inputs = [...s.inputs.slice(0, idx), { kind: "msg", text, at: now() }];
    s.progress = [];
    // 修改发生在已经生成的作品之前时，作品记录按保留的输入裁剪。
    const kept = replay(s.id, s.inputs);
    s.works = s.works.filter((w) => w.requirementVersion <= kept.requirementVersion && kept.workReq[w.version] !== undefined);
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async confirmSummary(sessionId: string, ref: SummaryRef): Promise<ConfirmResult> {
    const s = this.require(sessionId);
    await this.wait(100);
    const d = replay(s.id, s.inputs);
    const cur = d.summary;
    const reject = (reason: Extract<ConfirmResult, { status: "rejected" }>["reason"], message: string): ConfirmResult => {
      this.emit(s.id);
      return { status: "rejected", reason, message, snapshot: this.snapshot(s) };
    };
    if (!cur) return reject("not_pending", "当前没有待确认的摘要。");
    if (ref.summaryId !== cur.summaryId || ref.requirementVersion !== cur.requirementVersion) {
      return reject("stale_summary", `你确认的是旧版本摘要（第 ${ref.requirementVersion} 版），当前已是第 ${cur.requirementVersion} 版。请查看最新摘要后再确认。`);
    }
    if (cur.status === "confirmed") return { status: "accepted", duplicate: true, snapshot: this.snapshot(s) };
    if (cur.status !== "pending_confirmation") return reject("not_pending", "这版摘要已不是待确认状态。");
    if (cur.blockers.length) return reject("blocked", cur.blockers.join("；"));
    s.inputs.push({ kind: "confirm", summaryId: cur.summaryId, at: now() });
    this.pump(s);
    this.commit(s);
    return { status: "accepted", duplicate: false, snapshot: this.snapshot(s) };
  }

  async reviseSummary(sessionId: string, ref: SummaryRef, edits: SummaryEdit[]): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    await this.wait(80);
    const d = replay(s.id, s.inputs);
    if (!d.summary || d.summary.summaryId !== ref.summaryId) throw new AdvisorApiError("stale_summary", "摘要已有新版本，请先查看最新摘要。", true);
    s.inputs.push({ kind: "summary_edit", edits, at: now(), source: "user" });
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async continueDiscussion(sessionId: string, ref: SummaryRef): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    const d = replay(s.id, s.inputs);
    if (!d.summary || d.summary.summaryId !== ref.summaryId) throw new AdvisorApiError("stale_summary", "摘要已有新版本。", true);
    s.inputs.push({ kind: "continue", at: now() });
    this.commit(s);
    return this.snapshot(s);
  }

  async requestWorkRevision(sessionId: string, instruction: string, baseWorkVersion: number): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    const d = replay(s.id, s.inputs);
    const latest = s.works.at(-1);
    if (!latest || latest.version !== baseWorkVersion) throw new AdvisorApiError("stale_version", "你正在看的版本不是最新版本，请先切换到最新版本。", true);
    if (d.requirementVersion !== d.confirmedRequirementVersion) throw new AdvisorApiError("invalid_state", "需求有未确认的新版本，请先确认或继续讨论。", true);
    await this.wait(80);
    s.inputs.push({ kind: "work_revision", instruction, at: now() });
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async requestRequirementChange(sessionId: string, note: string, baseWorkVersion: number): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    const latest = s.works.at(-1);
    if (!latest || latest.version < baseWorkVersion) throw new AdvisorApiError("stale_version", "版本信息已过期。", true);
    await this.wait(80);
    s.inputs.push({ kind: "requirement_change", note, at: now() });
    this.commit(s);
    return this.snapshot(s);
  }

  async resume(sessionId: string): Promise<AdvisorSnapshot> {
    const s = this.require(sessionId);
    s.inputs.push({ kind: "resume", at: now() });
    s.job = null;
    this.pump(s);
    this.commit(s);
    return this.snapshot(s);
  }

  async getPlan(sessionId: string, planVersion?: number): Promise<PersonalPlan | null> {
    const s = this.require(sessionId);
    const d = replay(s.id, s.inputs);
    if (!d.confirmedRequirementVersion) return null;
    const latest = s.works.at(-1);
    if (!latest) return null;
    const v = planVersion ?? latest.version;
    const w = s.works.find((x) => x.version === v);
    if (!w) throw new AdvisorApiError("not_found", `方案版本 ${v} 不存在`, false);
    const confirmed = w.requirementVersion === d.requirementVersion && d.confirmedRequirementVersion === d.requirementVersion;
    // 历史方案按其当时的需求重建：用该版本记录的范围，而不是当前需求。
    const k = { ...d.knowns, scope: w.scope === "compare" ? ("compare" as const) : ("air14" as const), battery: w.battery };
    return buildMockPlan(s.id, v, w.requirementVersion, k, confirmed);
  }

  async loadProgress(sessionId: string, planVersion: number): Promise<PlanProgress> {
    const s = this.require(sessionId);
    return (
      s.planProgress?.[String(planVersion)] ?? {
        planId: `plan-${sessionId}`, planVersion, records: {}, feedback: [], storage: "browser_local", updatedAt: new Date(0).toISOString(),
      }
    );
  }

  async saveProgress(sessionId: string, p: PlanProgress): Promise<PlanProgress> {
    const s = this.require(sessionId);
    const saved: PlanProgress = { ...p, storage: "browser_local", updatedAt: now() };
    (s.planProgress ??= {})[String(p.planVersion)] = saved;
    this.save(); // 不递增 revision：体验进度不改变对话快照
    return saved;
  }

  async sendFeedback(sessionId: string, event: FeedbackEvent): Promise<FeedbackRecord> {
    const s = this.require(sessionId);
    await this.wait(60);
    // 模拟后端：只记录并回执。推荐不会因此被前端或本模拟服务改变——是否调整由 B 判断。
    const rec: FeedbackRecord = {
      event,
      status: "queued",
      ack: "已记录这条反馈。当前是界面模拟，没有顾问评估它；推荐保持不变。真实后端会由顾问判断它对推荐的影响。",
    };
    (s.feedbackLog ??= []).push(rec);
    this.save();
    return rec;
  }

  async getWork(sessionId: string, version: number): Promise<WorkView> {
    const s = this.require(sessionId);
    const w = s.works.find((x) => x.version === version);
    if (!w) throw new AdvisorApiError("not_found", `版本 ${version} 不存在`, false);
    const d = replay(s.id, s.inputs);
    const result = buildMockWork({
      sessionId: s.id, version: w.version, audience: w.audience, reason: w.reason === "initial" ? "initial" : "revision",
      instruction: w.instruction, requirementVersion: w.requirementVersion, scope: w.scope, battery: w.battery,
    });
    result.createdAt = w.createdAt;
    result.verification.checkedAt = w.createdAt;
    const basis = d.summaries.find((x) => x.summaryId === w.basisSummaryId);
    return {
      version,
      meta: this.workMeta(s, d, w, result),
      result,
      interactive: w.interactive && w.battery === "omit" ? buildMockInteractive(w.scope) : undefined,
      basisSummary: basis,
    };
  }

  imageUrl(sessionId: string, version: number, imageId: string): string | null {
    const s = this.sessions[sessionId];
    const w = s?.works.find((x) => x.version === version);
    if (!w) return null;
    const label = `${imageId}｜作品 v${version}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="100%" height="100%" fill="#e8ecf3"/><text x="50%" y="46%" font-size="34" text-anchor="middle" fill="#55607a" font-family="sans-serif">MOCK 占位图</text><text x="50%" y="58%" font-size="26" text-anchor="middle" fill="#55607a" font-family="sans-serif">${label.replace(/[<>&"]/g, "")}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  /* ---------------- 任务调度（模拟） ---------------- */

  private cancelJob(s: SessionRecord) {
    const t = this.live.get(s.id);
    if (t !== undefined) clearTimeout(t);
    this.live.delete(s.id);
    s.job = null;
  }

  private pump(s: SessionRecord) {
    if (this.live.has(s.id)) return;
    const d = replay(s.id, s.inputs);
    if (d.needsRetrieval) this.startJob(s, "retrieval");
    else if (d.needsWork) this.startJob(s, "work");
  }

  private startJob(s: SessionRecord, kind: Job["kind"]) {
    const labels = kind === "retrieval" ? RETRIEVAL_STEPS : WORK_STEPS;
    s.job = { kind, step: 0 };
    s.progress = labels.map((purpose, i) => ({
      stepId: `${kind}-${i}`, purpose, state: i === 0 ? "running" : ("running" as const), origin: kind === "retrieval" ? "mock" : "model", simulated: true,
    }));
    // 只有当前步骤是 running，后续步骤尚未开始：用 pending 表达为不显示。
    s.progress = s.progress.slice(0, 1);
    const tick = () => {
      const cur = this.sessions[s.id];
      if (!cur || !cur.job) return;
      const j = cur.job;
      const fail = (kind === "retrieval" && cur.dev.failRetrieval) || (kind === "work" && cur.dev.failWork);
      const last = cur.progress[cur.progress.length - 1];
      if (fail && j.step === 1) {
        if (last) (last.state = "failed"), (last.resultNote = kind === "retrieval" ? "资料来源无响应（模拟）" : "制作进程中断（模拟）");
        if (kind === "retrieval") cur.dev.failRetrieval = false;
        else cur.dev.failWork = false;
        cur.job = null;
        this.live.delete(cur.id);
        if (kind === "retrieval") cur.inputs.push({ kind: "retrieval_done", at: now(), failed: true });
        else cur.inputs.push({ kind: "work_done", version: cur.works.length + 1, at: now(), failed: true });
        this.commit(cur);
        return;
      }
      if (last) (last.state = "done"), (last.resultNote = this.noteFor(kind, j.step));
      j.step += 1;
      if (j.step >= labels.length) {
        cur.job = null;
        this.live.delete(cur.id);
        this.finish(cur, kind);
        this.commit(cur);
        return;
      }
      cur.progress.push({ stepId: `${kind}-${j.step}`, purpose: labels[j.step]!, state: "running", origin: kind === "retrieval" ? "mock" : "model", simulated: true });
      this.commit(cur);
      this.live.set(cur.id, window.setTimeout(tick, 700 / this.speed.value));
    };
    this.live.set(s.id, window.setTimeout(tick, 700 / this.speed.value));
  }

  private noteFor(kind: Job["kind"], step: number): string {
    if (kind === "retrieval") return ["找到 2 个候选型号", "读取 9 条事实", "发现 1 处来源冲突", "找到 5 张图片，其中 4 张适用于 Air 14"][step] ?? "完成";
    return ["使用已确认第 N 版需求", "已编排 2 张图 + 4 段", "事实与图片型号逐条核对", "未发现绝对化用语"][step] ?? "完成";
  }

  private finish(s: SessionRecord, kind: Job["kind"]) {
    if (kind === "retrieval") {
      s.inputs.push({ kind: "retrieval_done", at: now() });
      return;
    }
    const d = replay(s.id, s.inputs);
    const need = d.needsWork;
    if (!need) return;
    const version = s.works.length + 1;
    const scope: Scope = d.knowns.scope === "compare" ? "compare" : "air14";
    s.works.push({
      version,
      requirementVersion: need.reqVersion,
      reason: need.reason,
      instruction: need.instruction,
      scope,
      battery: d.knowns.battery ?? "omit",
      audience: d.knowns.audience ?? "大学新生",
      interactive: d.knowns.deliverable === "platform_plus_interactive",
      createdAt: now(),
      basisSummaryId: d.summaries.find((x) => x.requirementVersion === need.reqVersion)?.summaryId ?? "",
    });
    s.inputs.push({ kind: "work_done", version, at: now() });
  }

  /* ---------------- 快照 ---------------- */

  private workMeta(s: SessionRecord, d: Derived, w: WorkRecord, result: ResultVersion): WorkVersionMeta {
    const current = d.confirmedRequirementVersion === d.requirementVersion && w.requirementVersion === d.requirementVersion && s.works.at(-1)?.version === w.version;
    let staleReason: string | undefined;
    if (!current) {
      staleReason =
        w.requirementVersion !== d.requirementVersion
          ? `该版本基于需求第 ${w.requirementVersion} 版，当前需求已是第 ${d.requirementVersion} 版`
          : s.works.at(-1)?.version !== w.version
            ? "已有更新的作品版本"
            : "当前需求尚未确认";
    }
    return {
      version: w.version,
      requirementVersion: w.requirementVersion,
      createdAt: w.createdAt,
      reason: w.reason === "initial" ? "initial" : "revision",
      currentRequirement: current,
      staleReason,
      deliveryStatus: result.verification.deliveryStatus,
      isMock: true,
    };
  }

  private snapshot(s: SessionRecord): AdvisorSnapshot {
    const d = replay(s.id, s.inputs);
    const interrupted = !!s.job && !this.live.has(s.id);
    const versions = s.works.map((w) => {
      const r = buildMockWork({
        sessionId: s.id, version: w.version, audience: w.audience, reason: w.reason === "initial" ? "initial" : "revision",
        instruction: w.instruction, requirementVersion: w.requirementVersion, scope: w.scope, battery: w.battery,
      });
      return this.workMeta(s, d, w, r);
    });
    let phase = d.phase;
    let error = d.failed;
    if (interrupted) {
      phase = "interrupted";
      error = { code: "task_interrupted", message: "页面刷新或服务重启导致任务中断（模拟）。你的需求与对话都在，可以继续。", recoverable: true };
    }
    const running = !!s.job && this.live.has(s.id);
    return {
      sessionId: s.id,
      revision: s.revision,
      requirementVersion: d.requirementVersion,
      phase: running && s.job?.kind === "work" ? "producing" : running && s.job?.kind === "retrieval" ? "retrieving" : phase,
      messages: d.messages,
      requirements: d.requirements,
      questions: d.phase === "discussing" ? d.questions : [],
      gaps: d.gaps,
      progress: s.progress,
      candidates: d.candidates,
      summary: d.summary,
      versions,
      confirmedRequirementVersion: d.confirmedRequirementVersion,
      planVersions: s.works.map((w) => ({
        planVersion: w.version,
        requirementVersion: w.requirementVersion,
        createdAt: w.createdAt,
        current: this.workMeta(s, d, w, buildMockWork({ sessionId: s.id, version: w.version, audience: w.audience, reason: "initial", requirementVersion: w.requirementVersion, scope: w.scope, battery: w.battery })).currentRequirement,
      })),
      capabilities: CAPS,
      backend: {
        kind: "mock-ui",
        label: "界面模拟服务（MOCK-UI）",
        dataOrigin: "mock",
        modelProvider: "mock",
        modelSimulated: true,
        mockInUse: true,
        notes: ["对话、摘要确认、互动方案由前端模拟，未调用真实模型或知识库。", "会话记录保存在浏览器本地，用于模拟服务端恢复。"],
      },
      error,
    };
  }
}

let singleton: MockAdvisorClient | null = null;
export function getMockClient(): MockAdvisorClient {
  singleton ??= new MockAdvisorClient();
  return singleton;
}
export function lastMockSessionId(): string | null {
  return localStorage.getItem(LAST_KEY);
}
