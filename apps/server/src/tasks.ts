import { randomUUID } from "node:crypto";
import {
  canTransition,
  ExecutionEventSchema,
  type ClarificationAnswer,
  type ClarificationQuestion,
  type ExecutionEvent,
  type MarketingTaskInput,
  type MarketingWorkflow,
  type ResultVersion,
  type ResultVersionReason,
  type StageId,
  type TaskSnapshot,
  type TaskStatus,
  type WorkflowCheckpoint,
  type WorkflowEventInput,
  type WorkflowOutcome,
  parseResultVersion,
} from "@hwpc/contracts";

export class TaskError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_state" | "validation_error",
    message: string,
  ) {
    super(message);
  }
}

interface TaskRecord {
  taskId: string;
  status: TaskStatus;
  currentStage?: StageId;
  input: MarketingTaskInput;
  createdAt: string;
  updatedAt: string;
  pendingQuestions: ClarificationQuestion[];
  checkpoint?: WorkflowCheckpoint;
  versions: ResultVersion[];
  events: ExecutionEvent[];
  error?: { code: string; message: string };
}

const now = () => new Date().toISOString();

/** 内存任务存储 + 异步执行器。进程重启后任务丢失（单次演示可接受）。 */
export class TaskManager {
  private tasks = new Map<string, TaskRecord>();

  constructor(private workflow: MarketingWorkflow) {}

  create(input: MarketingTaskInput): TaskSnapshot {
    const t: TaskRecord = {
      taskId: randomUUID(),
      status: "queued",
      input,
      createdAt: now(),
      updatedAt: now(),
      pendingQuestions: [],
      versions: [],
      events: [],
    };
    this.tasks.set(t.taskId, t);
    this.execute(t, "initial", (ctx) => this.workflow.run(input, ctx));
    return this.snapshot(t);
  }

  get(taskId: string): TaskSnapshot {
    return this.snapshot(this.require(taskId));
  }

  getVersion(taskId: string, version?: number): ResultVersion {
    const t = this.require(taskId);
    const v = version ? t.versions.find((x) => x.version === version) : t.versions.at(-1);
    if (!v) throw new TaskError("not_found", version ? `版本 ${version} 不存在` : "任务尚无结果");
    return v;
  }

  events(taskId: string, after = 0): { events: ExecutionEvent[]; lastSeq: number } {
    const t = this.require(taskId);
    return { events: t.events.filter((e) => e.seq > after), lastSeq: t.events.at(-1)?.seq ?? 0 };
  }

  answer(taskId: string, answers: ClarificationAnswer[]): TaskSnapshot {
    const t = this.require(taskId);
    if (t.status !== "awaiting_clarification" || !t.checkpoint) {
      throw new TaskError("invalid_state", `当前状态 ${t.status} 不接受回答`);
    }
    const known = new Set(t.pendingQuestions.map((q) => q.questionId));
    const unknown = answers.filter((a) => !known.has(a.questionId));
    if (unknown.length) throw new TaskError("validation_error", `未知的问题编号: ${unknown.map((a) => a.questionId).join(", ")}`);
    const missing = [...known].filter((id) => !answers.some((a) => a.questionId === id));
    if (missing.length) throw new TaskError("validation_error", `缺少回答: ${missing.join(", ")}`);
    const checkpoint = t.checkpoint;
    this.execute(t, "clarification", (ctx) => this.workflow.resume(checkpoint, answers, ctx));
    return this.snapshot(t);
  }

  revise(taskId: string, instruction: string, inputPatch?: Record<string, unknown>): TaskSnapshot {
    const t = this.require(taskId);
    const prev = t.versions.at(-1);
    if (t.status !== "completed" || !prev) throw new TaskError("invalid_state", `当前状态 ${t.status} 不接受修改要求`);
    const input = { ...t.input, ...(inputPatch ?? {}) } as MarketingTaskInput;
    t.input = input;
    this.execute(t, "revision", (ctx) => this.workflow.revise(prev, input, instruction, ctx), instruction);
    return this.snapshot(t);
  }

  /* ---------------- 内部 ---------------- */

  private require(taskId: string): TaskRecord {
    const t = this.tasks.get(taskId);
    if (!t) throw new TaskError("not_found", `任务 ${taskId} 不存在`);
    return t;
  }

  private setStatus(t: TaskRecord, to: TaskStatus) {
    if (!canTransition(t.status, to)) throw new Error(`非法状态转换 ${t.status} -> ${to}`);
    t.status = to;
    t.updatedAt = now();
  }

  private push(t: TaskRecord, e: WorkflowEventInput) {
    const ev = ExecutionEventSchema.parse({ ...e, simulated: e.simulated ?? false, seq: t.events.length + 1, taskId: t.taskId, at: now() });
    t.events.push(ev);
    if (ev.stage) t.currentStage = ev.stage;
    t.updatedAt = ev.at;
  }

  /** 同步切到 running，再异步执行工作流；错误一律落到 failed 并写入事件。 */
  private execute(
    t: TaskRecord,
    reason: ResultVersionReason,
    run: (ctx: { taskId: string; emit: (e: WorkflowEventInput) => void }) => Promise<WorkflowOutcome>,
    instruction?: string,
  ) {
    this.setStatus(t, "running");
    t.pendingQuestions = [];
    t.error = undefined;
    const ctx = { taskId: t.taskId, emit: (e: WorkflowEventInput) => this.push(t, e) };
    void (async () => {
      try {
        const outcome = await run(ctx);
        if (outcome.kind === "needs_clarification") {
          t.pendingQuestions = outcome.questions;
          t.checkpoint = outcome.checkpoint;
          this.push(t, { type: "clarification_requested", message: `需要补充 ${outcome.questions.length} 项信息` });
          this.setStatus(t, "awaiting_clarification");
          return;
        }
        const rv = parseResultVersion({
          ...outcome.result,
          version: t.versions.length + 1,
          createdAt: now(),
          reason,
          instruction,
        });
        t.versions.push(rv);
        t.checkpoint = undefined;
        this.push(t, { type: "task_completed", message: `已生成版本 ${rv.version}`, detail: { deliveryStatus: rv.verification.deliveryStatus } });
        this.setStatus(t, "completed");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const code = e instanceof Error && e.name !== "Error" ? e.name : "workflow_error";
        t.error = { code, message };
        this.push(t, { type: "task_failed", message });
        this.setStatus(t, "failed");
      }
    })();
  }

  private snapshot(t: TaskRecord): TaskSnapshot {
    return {
      taskId: t.taskId,
      status: t.status,
      currentStage: t.currentStage,
      input: t.input,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      pendingQuestions: t.pendingQuestions,
      latestVersion: t.versions.at(-1),
      versions: t.versions.map((v) => ({ version: v.version, createdAt: v.createdAt, reason: v.reason })),
      eventCount: t.events.length,
      error: t.error,
    };
  }
}
