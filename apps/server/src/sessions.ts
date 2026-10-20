import { randomUUID } from "node:crypto";
import {
  QaAnswerSchema,
  applyNeedEdits,
  buildNeedSummary,
  checkApplicability,
  declareCapabilities,
  emptyNeedVersion,
  illustrativeApplicability,
  sceneContentHash,
  sceneKey,
  sealRecoveryPack,
  validConfirmation,
  validateSceneConfig,
  MAX_OPEN_QUESTIONS,
  type AdvisorEngine,
  type AdvisorProposal,
  type AdvisorView,
  type CapabilityReport,
  type CandidateAssessment,
  type ConfirmRejectReason,
  type DataService,
  type DeviceKnowledgeService,
  type ExperiencePage,
  type ExperienceRecord,
  type FactRecord,
  type FeedbackKind,
  type FeedbackRecord,
  type ImpactRecord,
  type InstanceView,
  type ModelService,
  type NeedEdit,
  type NeedKey,
  type NeedsStatus,
  type PersonalPlan,
  type PlanProposal,
  type PlanVerification,
  type QaEngine,
  type QaTurn,
  type QuestionProposal,
  type RecoveryPack,
  type RecoveryPayload,
  type RuntimeFacts,
  type RuntimeProfile,
  type SceneCatalog,
  type SceneCatalogItem,
  type SceneDefinition,
  type SceneInstance,
  type SessionQuestion,
  type SessionRecord,
  type SessionSnapshot,
  type SessionMessage,
} from "@hwpc/contracts";
import { SessionError } from "./errors.js";
import { applyNeedChangeImpact, applySceneInvalidationImpact } from "./impact.js";
import type { LoadedSession, SessionStore } from "./store.js";
import { buildExperiencePage } from "./page/build.js";
import { NO_FILLERS, applySlotResults, collectSlotResults, hasFillableSlots, type PageFillers } from "./page/fill.js";

export interface SessionServiceDeps {
  store: SessionStore;
  engine: AdvisorEngine;
  data: DataService;
  model: ModelService;
  catalog: SceneCatalog;
  knowledge: DeviceKnowledgeService;
  profile: RuntimeProfile;
  facts: RuntimeFacts;
  /** 当前实际使用的资料来源，用于快照如实展示。 */
  dataOrigin: "local" | "ima" | "mock";
  /** 答疑智能体（体验页侧边提问），与顾问引擎相互独立。 */
  qa: QaEngine;
  /** 体验页内容位填充器。 */
  fillers: PageFillers;
}

const now = () => new Date().toISOString();
const newId = () => randomUUID();

/* ------------------------------ 写入门控（revision + 原子保存） ------------------------------ */

function loadForWrite(deps: SessionServiceDeps, sessionId: string, baseRevision: number | undefined): SessionRecord {
  const rec = deps.store.load(sessionId);
  if (!rec) throw new SessionError("not_found", `会话 ${sessionId} 不存在`);
  if (baseRevision !== undefined && rec.revision !== baseRevision) {
    throw new SessionError("stale_revision", `写操作基于过期快照（当前 revision=${rec.revision}，你提交的 ${baseRevision}）`, {
      snapshot: buildSnapshot(rec, deps),
    });
  }
  return rec;
}

function commit(deps: SessionServiceDeps, rec: SessionRecord): void {
  // 写入前再比对一次存储里的 revision：读入之后若有其他写入落盘，本次写入基于过期数据，必须拒绝而不是覆盖。
  const stored = deps.store.load(rec.sessionId);
  if (stored && stored.revision !== rec.revision) {
    throw new SessionError("stale_revision", `会话已被其他操作更新（当前 revision=${stored.revision}），本次写入已放弃`, {
      snapshot: buildSnapshot(stored, deps),
    });
  }
  rec.revision += 1;
  rec.updatedAt = now();
  try {
    deps.store.save(rec);
  } catch (e) {
    throw new SessionError("storage_error", `会话保存失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const usableItem = (item: SceneCatalogItem | undefined): item is SceneCatalogItem =>
  item !== undefined && item.status !== "invalidated" && item.integrity !== "hash_mismatch";

/* ------------------------------ 创建与消息 ------------------------------ */

export async function createSession(text: string, deps: SessionServiceDeps): Promise<SessionSnapshot> {
  const sessionId = newId();
  const t = now();
  const record: SessionRecord = {
    schema: "hwpc.session.v1",
    sessionId,
    createdAt: t,
    updatedAt: t,
    revision: 0,
    usedMock: { engine: deps.engine.isMock, knowledge: false, data: deps.dataOrigin === "mock" },
    messages: [],
    needVersions: [emptyNeedVersion(t)],
    confirmations: [],
    questions: [],
    candidates: [],
    rejectedProductIds: [],
    excludedScenes: [],
    sceneDefinitions: {},
    instances: [],
    experiences: [],
    plans: [],
    planNotes: [],
    feedback: [],
    impacts: [],
    runState: { state: "idle", at: t },
    audit: [{ at: t, type: "session_created", detail: `首条消息: ${text.slice(0, 60)}` }],
    pages: [],
    qa: [],
  };
  deps.store.save(record);
  return handleMessage(sessionId, text, 0, deps);
}


export async function handleMessage(sessionId: string, text: string, baseRevision: number, deps: SessionServiceDeps): Promise<SessionSnapshot> {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const current = rec.needVersions.at(-1)!;
  rec.messages.push({ messageId: newId(), role: "user", text, at: t, needVersion: current.version });
  rec.runState = { state: "idle", at: t };
  rec.audit.push({ at: t, type: "user_message" });

  let proposal: AdvisorProposal;
  try {
    proposal = await deps.engine.respond(makeAdvisorView(rec), text, advisorDeps(deps, rec, t));
  } catch (e) {
    rec.runState = { state: "failed", at: t, error: { code: "engine_error", message: errorText(e) } };
    rec.audit.push({ at: t, type: "engine_failed", detail: errorText(e) });
    commit(deps, rec);
    return buildSnapshot(rec, deps);
  }
  return finishTurn(rec, proposal, text, t, deps);
}

/** 创建会话时使用的同步引擎调用（mock 引擎是同步返回的 Promise，这里统一 await 化）。 */

function advisorDeps(deps: SessionServiceDeps, rec: SessionRecord, t: string): Parameters<AdvisorEngine["respond"]>[2] {
  return {
    data: deps.data,
    model: deps.model,
    catalog: deps.catalog,
    knowledge: deps.knowledge,
    signal: undefined,
    emit: (e) => rec.audit.push({ at: t, type: e.type, detail: e.message }),
  };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function handleAnswers(
  sessionId: string,
  answers: { questionId: string; answer: string }[],
  freeText: string | undefined,
  baseRevision: number,
  deps: SessionServiceDeps,
): Promise<SessionSnapshot> {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const knownIds = new Set(rec.questions.filter((q) => q.status === "open").map((q) => q.questionId));
  for (const a of answers) {
    if (!knownIds.has(a.questionId)) throw new SessionError("validation_error", `问题 ${a.questionId} 不存在或已回答`);
    const q = rec.questions.find((x) => x.questionId === a.questionId)!;
    q.status = "answered";
    q.answer = a.answer;
    q.answeredAt = t;
  }
  const combined = freeText ?? answers.map((a) => a.answer).join("；");
  if (!combined.trim()) throw new SessionError("validation_error", "回答不能为空");
  rec.messages.push({ messageId: newId(), role: "user", text: combined, at: t, needVersion: rec.needVersions.at(-1)!.version });
  rec.audit.push({ at: t, type: "answers_submitted", detail: `${answers.length} 个问题` });

  let proposal: AdvisorProposal;
  try {
    proposal = await deps.engine.answer(makeAdvisorView(rec), answers, advisorDeps(deps, rec, t));
  } catch (e) {
    rec.runState = { state: "failed", at: t, error: { code: "engine_error", message: errorText(e) } };
    commit(deps, rec);
    return buildSnapshot(rec, deps);
  }
  return finishTurn(rec, proposal, combined, t, deps);
}

/* ------------------------------ 一轮提案落地 ------------------------------ */

function finishTurn(rec: SessionRecord, proposal: AdvisorProposal, userText: string, t: string, deps: SessionServiceDeps): SessionSnapshot {
  const { next } = applyProposal(rec, proposal, userText, t, deps, {
    cause: "need_edit",
    historyReason: "system_revision",
    reason: "引擎解读用户输入",
  });

  if (proposal.candidates) {
    rec.candidates = proposal.candidates as CandidateAssessment[];
    for (const c of rec.candidates) c.assessedNeedVersion = next.version;
  }

  const suggested = proposal.suggestedScenes
    .map((s) => (usableItem(deps.catalog.get(s.sceneId, s.version)) ? s : undefined))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  rec.messages.push({
    messageId: newId(),
    role: "advisor",
    text: proposal.reply,
    at: t,
    needVersion: rec.needVersions.at(-1)!.version,
    ...(suggested.length ? { suggestedScenes: suggested } : {}),
  });
  rec.runState = { state: "idle", at: t };
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

interface ApplyProposalOptions {
  cause: ImpactRecord["cause"];
  historyReason: "system_revision" | "feedback" | "user_change" | "correction";
  reason: string;
  feedbackId?: string;
}

/** 把引擎提议的需求编辑落地，并计算影响。返回应用后的需求版本。 */
function applyProposal(
  rec: SessionRecord,
  proposal: Pick<AdvisorProposal, "needEdits" | "questions">,
  userText: string,
  t: string,
  deps: SessionServiceDeps,
  opts: ApplyProposalOptions,
): { next: SessionRecord["needVersions"][number]; changed: boolean; impact?: ImpactRecord } {
  const current = rec.needVersions.at(-1)!;
  const applied = applyNeedEdits({
    current,
    edits: proposal.needEdits as NeedEdit[],
    userText,
    turn: rec.messages.length,
    now: t,
    reason: opts.reason,
    historyReason: opts.historyReason,
    actor: "engine",
    newEntryId: newId,
  });
  for (const note of applied.notes) rec.audit.push({ at: t, type: "need_edit_note", detail: note.text });
  if (!applied.changed) {
    pushQuestions(rec, proposal.questions, current.version, t);
    return { next: current, changed: false };
  }

  rec.needVersions.push(applied.next);
  const newQIds = proposal.questions.slice(0, MAX_OPEN_QUESTIONS).map(() => newId());
  const impact = applyNeedChangeImpact(rec, {
    cause: opts.cause,
    feedbackId: opts.feedbackId,
    at: t,
    fromNeedVersion: current.version,
    toNeedVersion: applied.next.version,
    changedKeys: applied.changedKeys,
    changedEntryIds: applied.next.entries.filter((e) => e.setAtVersion === applied.next.version).map((e) => e.entryId),
    newQuestionIds: newQIds,
    idFactory: newId,
  });
  rec.audit.push({
    at: t,
    type: "need_version_incremented",
    detail: `v${current.version} → v${applied.next.version}；变化: ${applied.changedKeys.join("、")}；影响: ${impact.summary}`,
  });
  if (impact.critical) for (const q of rec.questions) if (q.status === "open") q.status = "superseded";
  proposal.questions.slice(0, MAX_OPEN_QUESTIONS).forEach((qp, i) => {
    rec.questions.push({ ...qp, questionId: newQIds[i]!, status: "open", askedAtNeedVersion: applied.next.version, askedAt: t });
  });
  return { next: applied.next, changed: true, impact };
}

function pushQuestions(rec: SessionRecord, questions: QuestionProposal[], needVersion: number, t: string): void {
  for (const qp of questions.slice(0, MAX_OPEN_QUESTIONS)) {
    rec.questions.push({ ...qp, questionId: newId(), status: "open", askedAtNeedVersion: needVersion, askedAt: t });
  }
}

function makeAdvisorView(rec: SessionRecord): AdvisorView {
  const current = rec.needVersions.at(-1)!;
  return {
    sessionId: rec.sessionId,
    needVersion: current.version,
    entries: current.entries,
    summary: buildNeedSummary(current, rec.confirmations),
    recentMessages: rec.messages.slice(-10).map((m) => ({ role: m.role === "advisor" ? ("advisor" as const) : ("user" as const), text: m.text })),
    openQuestions: rec.questions.filter((q) => q.status === "open").map((q) => ({ questionId: q.questionId, prompt: q.prompt, targetKeys: q.targetKeys.map(String) })),
    candidates: rec.candidates,
    rejectedProductIds: rec.rejectedProductIds,
    excludedSceneIds: rec.excludedScenes.map((s) => s.sceneId),
    confirmed: validConfirmation(current, rec.confirmations) !== undefined,
  };
}

/* ------------------------------ 用户直接编辑需求 ------------------------------ */

export function editNeedsDirect(sessionId: string, edits: NeedEdit[], baseRevision: number, deps: SessionServiceDeps): SessionSnapshot {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const current = rec.needVersions.at(-1)!;
  const applied = applyNeedEdits({
    current,
    edits,
    userText: "",
    turn: rec.messages.length,
    now: t,
    reason: "用户直接修改需求",
    historyReason: "user_change",
    actor: "user_direct",
    newEntryId: newId,
  });
  for (const note of applied.notes) rec.audit.push({ at: t, type: "need_edit_note", detail: note.text });
  if (applied.changed) {
    rec.needVersions.push(applied.next);
    const impact = applyNeedChangeImpact(rec, {
      cause: "need_edit",
      at: t,
      fromNeedVersion: current.version,
      toNeedVersion: applied.next.version,
      changedKeys: applied.changedKeys,
      changedEntryIds: applied.next.entries.filter((e) => e.setAtVersion === applied.next.version).map((e) => e.entryId),
      newQuestionIds: [],
      idFactory: newId,
    });
    rec.audit.push({ at: t, type: "needs_edited_by_user", detail: `v${current.version} → v${applied.next.version}；${impact.summary}` });
  }
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 确认 ------------------------------ */

export function confirmNeeds(
  sessionId: string,
  needVersion: number,
  fingerprint: string,
  baseRevision: number | undefined,
  deps: SessionServiceDeps,
): { duplicate: boolean; snapshot: SessionSnapshot } {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const target = rec.needVersions.find((v) => v.version === needVersion);
  if (!target) throw new SessionError("not_found", `需求版本 ${needVersion} 不存在`);
  if (target.version !== rec.needVersions.at(-1)!.version || target.fingerprint !== fingerprint) {
    throw new SessionError("confirm_rejected", "摘要已更新，不是你看到的那一版", { reason: "stale_summary" as ConfirmRejectReason, snapshot: buildSnapshot(rec, deps) });
  }
  const summary = buildNeedSummary(target, rec.confirmations);
  if (!summary.confirmable) {
    throw new SessionError("confirm_rejected", `不能确认: ${summary.blockers.join("；")}`, { reason: "blocked" as ConfirmRejectReason, snapshot: buildSnapshot(rec, deps) });
  }
  if (target.entries.length === 0) {
    throw new SessionError("confirm_rejected", "没有任何需求内容，无法确认", { reason: "no_content" as ConfirmRejectReason, snapshot: buildSnapshot(rec, deps) });
  }
  const existing = validConfirmation(target, rec.confirmations);
  if (existing) {
    // 幂等：重复确认不改变任何状态，因此不推进 revision。
    rec.audit.push({ at: t, type: "confirm_duplicate", detail: `已有确认 ${existing.confirmationId}` });
    return { duplicate: true, snapshot: buildSnapshot(rec, deps) };
  }
  rec.confirmations.push({
    confirmationId: newId(),
    needVersion: target.version,
    fingerprint: target.fingerprint,
    criticalFingerprint: target.criticalFingerprint,
    confirmedAt: t,
    actor: "user",
    channel: "confirm_action",
    assumptionEntryIds: target.entries.filter((e) => e.status !== "known").map((e) => e.entryId),
    status: "valid",
  });
  rec.audit.push({ at: t, type: "needs_confirmed", detail: `v${needVersion}` });
  commit(deps, rec);
  return { duplicate: false, snapshot: buildSnapshot(rec, deps) };
}

/* ------------------------------ 方案组装（门控：必须有有效确认） ------------------------------ */

export async function composePlan(sessionId: string, baseRevision: number, deps: SessionServiceDeps): Promise<SessionSnapshot> {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const current = rec.needVersions.at(-1)!;
  const conf = validConfirmation(current, rec.confirmations);
  if (!conf) throw new SessionError("needs_confirmation", "当前需求版本没有有效确认，不能组装方案");

  let proposal: PlanProposal;
  try {
    proposal = await deps.engine.composePlan(makeAdvisorView(rec), advisorDeps(deps, rec, t));
  } catch (e) {
    rec.runState = { state: "failed", at: t, error: { code: "engine_error", message: errorText(e) } };
    rec.audit.push({ at: t, type: "engine_failed", detail: errorText(e) });
    commit(deps, rec);
    return buildSnapshot(rec, deps);
  }

  const version = (rec.plans.at(-1)?.version ?? 0) + 1;
  const parentPlanVersion = rec.plans.find((p) => p.status === "current")?.version;
  const newInstances: SceneInstance[] = [];
  const planNotes: string[] = [];

  for (const sp of proposal.scenes) {
    const item = deps.catalog.get(sp.sceneId, sp.version);
    if (!usableItem(item)) {
      planNotes.push(`场景 ${sp.sceneId}@${sp.version} 不可用（未注册、已失效或版本校验失败），已跳过`);
      continue;
    }
    const def = deps.catalog.getDefinition(sp.sceneId, sp.version);
    if (!def) {
      planNotes.push(`场景 ${sp.sceneId}@${sp.version} 缺少定义，已跳过`);
      continue;
    }
    const configVal = validateSceneConfig(def, sp.params);
    if (!configVal.ok) {
      planNotes.push(`场景 ${sp.sceneId}@${sp.version} 配置不合法（${configVal.errors.join("；")}），已跳过`);
      continue;
    }
    // 绑定既可以是候选产品，也可以是“用户已有设备”（如已有机型）。这里不要求它在候选列表里，
    // 而是交给设备知识服务核验身份、类别、功能与关系；查不到就是 unknown，不会被当成支持。
    const knowl = await deps.knowledge.getKnowledge(Object.values(sp.bindings));
    if (knowl.isMock) rec.usedMock.knowledge = true;
    if (def.isMock) rec.usedMock.data = true;
    const appl = checkApplicability({ def, bindings: sp.bindings, products: knowl.products, knowledge: knowl, confirmedConditionKeys: [] });
    if (appl.applicability.result === "not_applicable" || appl.applicability.result === "unknown") {
      planNotes.push(`场景 ${sp.sceneId}@${sp.version} 条件不满足（${appl.applicability.reasons.map((r) => r.text).join("；")}），已跳过`);
      continue;
    }
    const key = sceneKey(sp.sceneId, sp.version);
    if (!rec.sceneDefinitions[key]) rec.sceneDefinitions[key] = def;
    newInstances.push({
      instanceId: newId(),
      sceneId: sp.sceneId,
      sceneVersion: sp.version,
      definitionHash: sceneContentHash(def),
      mode: "personal",
      planVersion: version,
      bindings: sp.bindings,
      params: configVal.values,
      confirmedConditionKeys: [],
      evidenceSnapshot: {
        snapshotId: newId(),
        takenAt: t,
        products: knowl.products,
        capabilities: appl.usedCapabilities,
        relations: appl.usedRelations,
        isMock: knowl.isMock || def.isMock,
      },
      applicability: appl.applicability,
      status: "active",
      createdAt: t,
      illustrativeOnly: false,
    });
  }

  rec.instances.push(...newInstances);
  for (const i of newInstances) {
    const def = rec.sceneDefinitions[sceneKey(i.sceneId, i.sceneVersion)]!;
    const initial = def.states.find((s) => s.initial)!;
    rec.experiences.push({
      instanceId: i.instanceId,
      sceneId: i.sceneId,
      sceneVersion: i.sceneVersion,
      planVersion: i.planVersion,
      currentStateId: initial.stateId,
      visitedStateIds: [initial.stateId],
      reachedOutcomeIds: [],
      completion: "not_started",
      actionLog: [],
      deviceTested: false,
      updatedAt: t,
    });
  }

  const checks: PlanVerification["checks"] = [];
  if (newInstances.length === 0 && proposal.scenes.length > 0) checks.push({ checkId: "no_scenes", ok: false, detail: "所有提议场景均不可用或条件不满足" });
  else checks.push({ checkId: "scenes", ok: true, detail: `纳入 ${newInstances.length} 个场景` });
  if (!proposal.recommendation.primary) checks.push({ checkId: "no_recommendation", ok: false, detail: proposal.recommendation.noRecommendationReason ?? "未给出首选推荐" });
  else checks.push({ checkId: "recommendation", ok: true, detail: `推荐 ${proposal.recommendation.primary.productId}` });

  const plan: PersonalPlan = {
    planId: newId(),
    version,
    needVersion: current.version,
    needFingerprint: current.fingerprint,
    criticalFingerprint: current.criticalFingerprint,
    confirmationId: conf.confirmationId,
    createdAt: t,
    parentPlanVersion,
    candidates: proposal.candidates,
    recommendation: proposal.recommendation,
    scenes: newInstances.map((i, idx) => {
      const sp = proposal.scenes.find((s) => s.sceneId === i.sceneId && s.version === i.sceneVersion)!;
      return { instanceId: i.instanceId, sceneId: i.sceneId, sceneVersion: i.sceneVersion, order: idx, reason: sp.reason, relatedNeedEntryIds: sp.relatedNeedEntryIds };
    }),
    unresolvedQuestionIds: proposal.unresolvedQuestions.map(() => newId()),
    verification: { planVersion: version, checks, ok: checks.every((c) => c.ok), checkedAt: t },
    status: "current",
    needsReview: false,
    isMock: rec.usedMock.engine || rec.usedMock.knowledge || rec.usedMock.data || newInstances.some((i) => i.evidenceSnapshot.isMock),
  };

  for (const old of rec.plans) {
    if (old.status !== "current") continue;
    old.status = "superseded";
    // 旧方案的个人实例随方案一起被取代，否则“打开任务”和“已体验”会落到旧版本上。
    for (const i of rec.instances) {
      if (i.mode === "personal" && i.planVersion === old.version && i.status === "active") {
        i.status = "superseded";
        i.invalidReason = `已由方案 v${version} 取代`;
      }
    }
  }
  rec.plans.push(plan);
  rec.planNotes = planNotes.map((text) => ({ at: t, text }));
  const page = await composePage(rec, plan, deps, t);
  rec.pages.push(page);
  rec.audit.push({ at: t, type: "plan_composed", detail: `v${version}；${newInstances.length} 个场景；体验页 ${page.sections.length} 个版块` });
  rec.runState = { state: "idle", at: t };
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 体验页 ------------------------------ */

/** 方案确定后生成体验页骨架。资料取不到不影响生成：介绍文案位留空，由填充器或占位处理。 */
async function composePage(rec: SessionRecord, plan: PersonalPlan, deps: SessionServiceDeps, t: string): Promise<ExperiencePage> {
  const facts: Record<string, FactRecord[]> = {};
  await Promise.all(
    plan.candidates.map(async (c) => {
      try {
        const pack = await deps.data.getMaterialPack({ taskId: `page-${rec.sessionId}-${plan.version}`, product: c.product, maxImages: 0 });
        facts[c.product.productId] = pack.facts.filter((f) => f.productId === c.product.productId);
      } catch {
        facts[c.product.productId] = [];
      }
    }),
  );
  const sceneTitles = Object.fromEntries(Object.entries(rec.sceneDefinitions).map(([k, d]) => [k, d.title]));
  const page = buildExperiencePage({
    plan,
    needs: rec.needVersions.find((v) => v.version === plan.needVersion)?.entries ?? [],
    sceneTitles,
    facts,
    isMock: plan.isMock,
    now: t,
    newId,
  });
  page.filling = hasFillableSlots(page, deps.fillers);
  return page;
}

/** 把填充器的结果写回指定方案版本的页面；页面已被取代或已填过的位置不动。 */
export function applyPageFill(sessionId: string, planVersion: number, results: Parameters<typeof applySlotResults>[1], deps: SessionServiceDeps): SessionSnapshot {
  const rec = loadForWrite(deps, sessionId, undefined);
  const page = rec.pages.find((p) => p.planVersion === planVersion);
  if (!page) return buildSnapshot(rec, deps);
  const t = now();
  const changed = applySlotResults(page, results, t);
  const wasFilling = page.filling;
  page.filling = false;
  if (!changed && !wasFilling) return buildSnapshot(rec, deps);
  rec.audit.push({ at: t, type: "page_filled", detail: `方案 v${planVersion}：${results.length} 个内容位` });
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 体验页侧边提问（答疑智能体） ------------------------------ */

/**
 * 只记录问答，不改需求、方案和页面。答疑引擎出错时记一条失败的问答，不影响会话其他状态。
 */
export async function askQuestion(sessionId: string, question: string, baseRevision: number, deps: SessionServiceDeps): Promise<SessionSnapshot> {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const plan = rec.plans.find((p) => p.status === "current");
  const page = plan ? rec.pages.find((p) => p.planVersion === plan.version) : undefined;
  if (!plan || !page) throw new SessionError("invalid_state", "还没有生成体验页，请先确认需求并生成方案");
  const t = now();
  const history = rec.qa.filter((q) => q.planVersion === plan.version && !q.failed).slice(-6).map((q) => ({ question: q.question, reply: q.reply }));
  let turn: QaTurn;
  try {
    const answer = QaAnswerSchema.parse(
      await deps.qa.answer({ page, plan, needs: rec.needVersions.find((v) => v.version === plan.needVersion)?.entries ?? [], history }, question, { data: deps.data }),
    );
    turn = { turnId: newId(), at: t, planVersion: plan.version, question, ...answer, isMock: deps.qa.isMock, failed: false };
  } catch (e) {
    turn = { turnId: newId(), at: t, planVersion: plan.version, question, reply: `暂时无法回答：${errorText(e)}`, citations: [], suggestNeedChange: false, isMock: deps.qa.isMock, failed: true };
  }
  rec.qa.push(turn);
  rec.audit.push({ at: t, type: "qa", detail: question.slice(0, 60) });
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 场景实例：说明性浏览 ------------------------------ */

export function exploreScene(sessionId: string, sceneId: string, version: number | undefined, baseRevision: number | undefined, deps: SessionServiceDeps): SessionSnapshot {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const item = version === undefined ? deps.catalog.latest(sceneId) : deps.catalog.get(sceneId, version);
  if (!item || !usableItem(item)) throw new SessionError("scene_unavailable", `场景 ${sceneId}${version ? `@${version}` : ""} 不存在、已失效或版本校验失败`);
  const def = deps.catalog.getDefinition(item.sceneId, item.version);
  if (!def) throw new SessionError("scene_unavailable", `场景 ${item.sceneId}@${item.version} 缺少定义`);

  // 同一场景版本已有说明性实例时直接复用，避免重复堆叠。
  const existing = rec.instances.find((i) => i.mode === "exploratory" && i.sceneId === item.sceneId && i.sceneVersion === item.version && i.status === "active");
  if (existing) return buildSnapshot(rec, deps);

  const configVal = validateSceneConfig(def, {});
  if (!configVal.ok) throw new SessionError("scene_unavailable", `场景默认配置不合法：${configVal.errors.join("；")}`);

  const key = sceneKey(item.sceneId, item.version);
  if (!rec.sceneDefinitions[key]) rec.sceneDefinitions[key] = def;

  const instance: SceneInstance = {
    instanceId: newId(),
    sceneId: item.sceneId,
    sceneVersion: item.version,
    definitionHash: sceneContentHash(def),
    mode: "exploratory",
    bindings: {},
    params: configVal.values,
    confirmedConditionKeys: [],
    evidenceSnapshot: { snapshotId: newId(), takenAt: t, products: [], capabilities: [], relations: [], isMock: def.isMock },
    applicability: illustrativeApplicability(def),
    status: "active",
    createdAt: t,
    illustrativeOnly: true,
  };
  rec.instances.push(instance);
  const initial = def.states.find((s) => s.initial)!;
  rec.experiences.push({
    instanceId: instance.instanceId,
    sceneId: instance.sceneId,
    sceneVersion: instance.sceneVersion,
    currentStateId: initial.stateId,
    visitedStateIds: [initial.stateId],
    reachedOutcomeIds: [],
    completion: "not_started",
    actionLog: [],
    deviceTested: false,
    updatedAt: t,
  });
  rec.audit.push({ at: t, type: "scene_explored", detail: `${item.sceneId}@${item.version}（说明性浏览）` });
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 场景实例：动作 ------------------------------ */

export function applySceneAction(sessionId: string, instanceId: string, actionId: string, baseRevision: number | undefined, deps: SessionServiceDeps): SessionSnapshot {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const instance = rec.instances.find((i) => i.instanceId === instanceId);
  if (!instance) throw new SessionError("not_found", `场景实例 ${instanceId} 不存在`);
  if (instance.status !== "active") throw new SessionError("invalid_state", "该场景实例已失效或被取代，不能继续操作");

  const def = rec.sceneDefinitions[sceneKey(instance.sceneId, instance.sceneVersion)];
  if (!def) throw new SessionError("scene_unavailable", "缺少该实例冻结的场景定义");
  const experience = rec.experiences.find((e) => e.instanceId === instanceId);
  if (!experience) throw new SessionError("invalid_state", "该场景实例没有体验记录");

  // 注册表状态：版本失效或内容被改动时停止操作，不继续宣称可用。
  const item = deps.catalog.get(instance.sceneId, instance.sceneVersion);
  if (item?.integrity === "hash_mismatch") throw new SessionError("scene_unavailable", "场景版本内容与注册表不一致，已停止操作");
  if (item?.status === "invalidated") {
    const impact = applySceneInvalidationImpact(rec, { sceneId: instance.sceneId, version: instance.sceneVersion, reason: item.invalidation?.reason ?? "注册表标记失效" }, t, newId);
    rec.audit.push({ at: t, type: "scene_invalidated", detail: impact?.summary ?? "场景版本已失效" });
    commit(deps, rec);
    throw new SessionError("scene_unavailable", "场景版本已被标记失效，不能继续操作", { snapshot: buildSnapshot(rec, deps) });
  }

  // 个人方案实例：未获证据支持（unknown/unsupported）时不能走成功分支。
  if (instance.mode === "personal") {
    if (instance.applicability.result === "not_applicable" || instance.applicability.result === "unknown") {
      throw new SessionError("scene_unavailable", `该设备组合尚未获得证据支持：${instance.applicability.reasons.map((r) => r.text).join("；")}`);
    }
    if (instance.applicability.result === "conditional") {
      const open = instance.applicability.openConditions.filter((c) => !instance.confirmedConditionKeys.includes(c.conditionKey));
      if (open.length) throw new SessionError("invalid_state", `请先确认使用条件：${open.map((c) => c.text).join("；")}`);
    }
  }

  const action = def.actions.find((a) => a.actionId === actionId);
  if (!action) throw new SessionError("validation_error", `场景 ${instance.sceneId} 没有动作 ${actionId}`);
  if (!action.from.includes(experience.currentStateId)) {
    const label = def.states.find((s) => s.stateId === experience.currentStateId)?.label ?? experience.currentStateId;
    throw new SessionError("invalid_state", `当前状态“${label}”不允许执行“${action.label}”`);
  }

  const fromState = experience.currentStateId;
  experience.currentStateId = action.to;
  if (!experience.visitedStateIds.includes(action.to)) experience.visitedStateIds.push(action.to);
  for (const o of def.outcomes) if (o.reachedInState === action.to && !experience.reachedOutcomeIds.includes(o.outcomeId)) experience.reachedOutcomeIds.push(o.outcomeId);
  experience.completion = def.states.find((s) => s.stateId === action.to)?.terminal ? "walkthrough_completed" : "in_progress";
  experience.actionLog.push({ actionId, from: fromState, to: action.to, at: t });
  experience.updatedAt = t;
  rec.audit.push({ at: t, type: "scene_action", detail: `${instance.sceneId}@${instance.sceneVersion} ${actionId} → ${action.to}` });
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 明确反馈 ------------------------------ */

export interface FeedbackRequestBody {
  kind: FeedbackKind;
  text: string;
  instanceId?: string;
  conditionKey?: string;
  productId?: string;
  needKey?: NeedKey;
  entryId?: string;
}

export async function submitFeedback(sessionId: string, input: FeedbackRequestBody, baseRevision: number, deps: SessionServiceDeps): Promise<SessionSnapshot> {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  const t = now();
  const instance = input.instanceId ? rec.instances.find((i) => i.instanceId === input.instanceId) : undefined;
  if (input.instanceId && !instance) throw new SessionError("not_found", `场景实例 ${input.instanceId} 不存在`);

  const text = input.text.trim();
  if (!text) throw new SessionError("validation_error", "反馈内容不能为空");

  const feedback: FeedbackRecord = {
    feedbackId: newId(),
    at: t,
    kind: input.kind,
    text,
    ...(instance ? { instanceId: instance.instanceId } : {}),
    ...(instance?.planVersion ? { planVersion: instance.planVersion } : {}),
    ...(input.needKey ? { needKey: input.needKey } : {}),
    ...(input.entryId ? { entryId: input.entryId } : {}),
    ...(input.productId ? { candidateId: input.productId } : {}),
    ...(input.conditionKey ? { conditionKey: input.conditionKey } : {}),
  };

  let impact: ImpactRecord | undefined;

  if (input.kind === "reject_candidate") {
    if (!input.productId) throw new SessionError("validation_error", "reject_candidate 需要 productId");
    if (!rec.rejectedProductIds.includes(input.productId)) rec.rejectedProductIds.push(input.productId);
    impact = recordImpact(rec, {
      cause: "feedback",
      feedbackId: feedback.feedbackId,
      critical: false,
      summary: `你明确表示不考虑这一候选；后续推荐会排除它，当前方案需复核。`,
      reviewPlanVersions: markPlansForReview(rec),
    });
  } else if (input.kind === "prefer_candidate") {
    if (!input.productId) throw new SessionError("validation_error", "prefer_candidate 需要 productId");
    const applied = applyNeedEdits({
      current: rec.needVersions.at(-1)!,
      edits: [{ op: "set", key: "preferences", value: text, status: "known", quote: text }],
      userText: text,
      turn: rec.messages.length,
      now: t,
      reason: "用户反馈了明确偏好",
      historyReason: "feedback",
      actor: "user_direct",
      newEntryId: newId,
    });
    if (applied.changed) {
      const current = rec.needVersions.at(-1)!;
      rec.needVersions.push(applied.next);
      impact = applyNeedChangeImpact(rec, {
        cause: "feedback",
        feedbackId: feedback.feedbackId,
        at: t,
        fromNeedVersion: current.version,
        toNeedVersion: applied.next.version,
        changedKeys: applied.changedKeys,
        changedEntryIds: applied.next.entries.filter((e) => e.setAtVersion === applied.next.version).map((e) => e.entryId),
        newQuestionIds: [],
        idFactory: newId,
      });
    }
  } else if (input.kind === "reject_scene") {
    if (!instance) throw new SessionError("validation_error", "reject_scene 需要 instanceId");
    if (!rec.excludedScenes.some((s) => s.sceneId === instance.sceneId)) {
      rec.excludedScenes.push({ sceneId: instance.sceneId, feedbackId: feedback.feedbackId, at: t });
    }
    const affected: string[] = [];
    for (const i of rec.instances) {
      if (i.sceneId === instance.sceneId && i.status === "active") {
        i.status = "superseded";
        i.invalidReason = "用户明确表示不想体验这个场景";
        affected.push(i.instanceId);
      }
    }
    impact = recordImpact(rec, {
      cause: "feedback",
      feedbackId: feedback.feedbackId,
      critical: false,
      summary: `已记录你不想体验“${instance.sceneId}”，该场景不再出现在后续推荐中。`,
      affectedInstanceIds: affected,
      reviewPlanVersions: markPlansForReview(rec),
    });
  } else if (input.kind === "confirm_condition") {
    if (!instance) throw new SessionError("validation_error", "confirm_condition 需要 instanceId");
    if (!input.conditionKey) throw new SessionError("validation_error", "confirm_condition 需要 conditionKey");
    if (!instance.confirmedConditionKeys.includes(input.conditionKey)) instance.confirmedConditionKeys.push(input.conditionKey);
    const def = rec.sceneDefinitions[sceneKey(instance.sceneId, instance.sceneVersion)];
    if (def) {
      const knowl = await deps.knowledge.getKnowledge(Object.values(instance.bindings));
      const reappl = checkApplicability({
        def,
        bindings: instance.bindings,
        products: knowl.products,
        knowledge: knowl,
        confirmedConditionKeys: instance.confirmedConditionKeys,
      });
      instance.applicability = reappl.applicability;
      instance.evidenceSnapshot = {
        ...instance.evidenceSnapshot,
        capabilities: reappl.usedCapabilities,
        relations: reappl.usedRelations,
        isMock: instance.evidenceSnapshot.isMock || knowl.isMock,
      };
    }
    impact = recordImpact(rec, {
      cause: "feedback",
      feedbackId: feedback.feedbackId,
      critical: false,
      summary: "已记录你确认满足的使用条件（你的自述，不是设备验证）。",
      affectedInstanceIds: [instance.instanceId],
    });
  } else if (input.kind === "change_need" && input.needKey && input.entryId) {
    // 用户直接指出要改哪一条：按用户原话替换该条目，不等引擎重新解释。
    const current = rec.needVersions.at(-1)!;
    const applied = applyNeedEdits({
      current,
      edits: [{ op: "set", key: input.needKey, value: text, status: "known", quote: text, entryId: input.entryId }],
      userText: text,
      turn: rec.messages.length,
      now: t,
      reason: "用户明确修改需求",
      historyReason: "feedback",
      actor: "user_direct",
      newEntryId: newId,
    });
    if (applied.changed) {
      rec.needVersions.push(applied.next);
      impact = applyNeedChangeImpact(rec, {
        cause: "feedback",
        feedbackId: feedback.feedbackId,
        at: t,
        fromNeedVersion: current.version,
        toNeedVersion: applied.next.version,
        changedKeys: applied.changedKeys,
        changedEntryIds: applied.next.entries.filter((e) => e.setAtVersion === applied.next.version).map((e) => e.entryId),
        newQuestionIds: [],
        idFactory: newId,
      });
    }
  } else if (input.kind === "note") {
    impact = undefined;
  } else {
    // change_need / new_need / concern：交给引擎解释成需求编辑。
    let proposal: AdvisorProposal | undefined;
    try {
      proposal = await deps.engine.interpretFeedback(makeAdvisorView(rec), { kind: input.kind, text, instanceId: input.instanceId, sceneId: instance?.sceneId }, advisorDeps(deps, rec, t));
    } catch (e) {
      rec.runState = { state: "failed", at: t, error: { code: "engine_error", message: errorText(e) } };
      commit(deps, rec);
      return buildSnapshot(rec, deps);
    }
    const applied = applyProposal(rec, proposal, text, t, deps, {
      cause: "feedback",
      historyReason: "feedback",
      reason: "用户反馈",
      feedbackId: feedback.feedbackId,
    });
    impact = applied.impact;
    if (!applied.changed) {
      impact = recordImpact(rec, {
        cause: "feedback",
        feedbackId: feedback.feedbackId,
        critical: false,
        summary: "已记录你的反馈，需求没有因此改变。",
      });
    }
  }

  if (impact) feedback.impactId = impact.impactId;
  rec.feedback.push(feedback);
  rec.audit.push({ at: t, type: "feedback_recorded", detail: `${input.kind}${impact ? `；${impact.summary}` : ""}` });
  commit(deps, rec);
  return buildSnapshot(rec, deps);
}

function recordImpact(
  rec: SessionRecord,
  input: Partial<ImpactRecord> & Pick<ImpactRecord, "cause" | "summary" | "critical">,
): ImpactRecord {
  const impact: ImpactRecord = {
    impactId: newId(),
    at: now(),
    changedNeedKeys: [],
    invalidatedConfirmationIds: [],
    stalePlanVersions: [],
    reviewPlanVersions: [],
    affectedInstanceIds: [],
    requiresReconfirmation: false,
    requiresReassessment: true,
    newQuestionIds: [],
    ...input,
  };
  rec.impacts.push(impact);
  return impact;
}

function markPlansForReview(rec: SessionRecord): number[] {
  const versions: number[] = [];
  for (const plan of rec.plans) {
    if (plan.status !== "current") continue;
    plan.needsReview = true;
    plan.reviewNote = plan.reviewNote ?? "收到你的明确反馈，方案需要复核";
    versions.push(plan.version);
  }
  return versions;
}

/* ------------------------------ 恢复 ------------------------------ */

export function resumeSession(sessionId: string, baseRevision: number | undefined, deps: SessionServiceDeps): SessionSnapshot {
  const rec = loadForWrite(deps, sessionId, baseRevision);
  if (rec.runState.state === "failed") {
    rec.runState = { state: "idle", at: now() };
    rec.audit.push({ at: now(), type: "session_resumed" });
    commit(deps, rec);
  }
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 导出 / 列表 / 目录 ------------------------------ */

export function exportSession(sessionId: string, deps: SessionServiceDeps, planVersion?: number): RecoveryPack {
  const rec = loadForWrite(deps, sessionId, undefined);
  const plan = planVersion !== undefined ? rec.plans.find((p) => p.version === planVersion) : rec.plans.find((p) => p.status === "current") ?? rec.plans.at(-1);
  if (!plan) throw new SessionError("invalid_state", "还没有可导出的个人方案");
  const needRecord = rec.needVersions.find((v) => v.version === plan.needVersion);
  if (!needRecord) throw new SessionError("storage_error", `方案引用的需求版本 v${plan.needVersion} 不存在`);
  const confirmation = rec.confirmations.find((c) => c.confirmationId === plan.confirmationId);
  if (!confirmation) throw new SessionError("storage_error", "方案引用的确认记录不存在");

  const instanceIds = new Set(plan.scenes.map((s) => s.instanceId));
  const instances = rec.instances.filter((i) => instanceIds.has(i.instanceId));
  const definitions = [...new Map(instances.map((i) => [sceneKey(i.sceneId, i.sceneVersion), rec.sceneDefinitions[sceneKey(i.sceneId, i.sceneVersion)]]))
    .entries()]
    .map(([, d]) => d)
    .filter((d): d is SceneDefinition => d !== undefined);
  const invalidScenes: RecoveryPayload["freshness"]["invalidScenes"] = [];
  for (const i of instances) {
    const item = deps.catalog.get(i.sceneId, i.sceneVersion);
    if (item?.invalidation) invalidScenes.push({ sceneId: item.sceneId, version: item.version, reason: item.invalidation.reason });
  }

  const notices = [
    "这是只读副本：接收方看到的是独立副本，不会同步回原会话，也不能修改原顾客方案。",
    "场景完成只表示走完流程演示，不代表在真实设备上测试通过。",
  ];
  if (plan.isMock) notices.push("本方案含模拟数据（MOCK），不是真实产品资料。");
  if (!plan.verification.ok) notices.push(`方案核验未通过：${plan.verification.checks.filter((c) => !c.ok).map((c) => c.detail).join("；")}`);
  if (plan.status === "stale") notices.push(`该方案已不再对应当前需求：${plan.staleReason ?? "需求已变化"}`);

  const payload: RecoveryPayload = {
    origin: { sessionId: rec.sessionId, exportedAt: now(), sessionRevision: rec.revision },
    access: "read_only_copy",
    isMock: plan.isMock,
    need: { record: needRecord, confirmation },
    plan,
    sceneDefinitions: definitions,
    instances,
    experiences: rec.experiences.filter((e) => instanceIds.has(e.instanceId)),
    feedback: rec.feedback.filter((f) => f.planVersion === undefined || f.planVersion === plan.version),
    freshness: {
      planStatus: plan.status,
      needsReview: plan.needsReview,
      ...(plan.reviewNote ? { note: plan.reviewNote } : {}),
      invalidScenes,
    },
    capabilities: declareCapabilities(deps.profile, deps.facts),
    notices,
  };
  return sealRecoveryPack(payload);
}

export function listSessions(deps: SessionServiceDeps): ({ sessionId: string; updatedAt: string; needVersion: number; needsStatus: NeedsStatus; planVersion?: number; firstUserMessage?: string; isMock: boolean } | { sessionId: string; unreadable: string })[] {
  return deps.store.list().map((entry: LoadedSession) => {
    if (entry.unreadable || !entry.record) return { sessionId: entry.sessionId, unreadable: entry.unreadable ?? "会话文件无法读取" };
    const rec = entry.record;
    const snap = buildSnapshot(rec, deps);
    return {
      sessionId: rec.sessionId,
      updatedAt: rec.updatedAt,
      needVersion: snap.needs.version,
      needsStatus: snap.needs.status,
      ...(snap.plan.current ? { planVersion: snap.plan.current.version } : {}),
      ...(rec.messages.find((m) => m.role === "user") ? { firstUserMessage: rec.messages.find((m) => m.role === "user")!.text.slice(0, 80) } : {}),
      isMock: snap.isMock,
    };
  });
}

/* ------------------------------ 快照 ------------------------------ */

function instanceView(rec: SessionRecord, i: SceneInstance, deps: SessionServiceDeps): InstanceView | undefined {
  const def = rec.sceneDefinitions[sceneKey(i.sceneId, i.sceneVersion)];
  if (!def) return undefined;
  const exp: ExperienceRecord =
    rec.experiences.find((e) => e.instanceId === i.instanceId) ?? {
      instanceId: i.instanceId,
      sceneId: i.sceneId,
      sceneVersion: i.sceneVersion,
      ...(i.planVersion ? { planVersion: i.planVersion } : {}),
      currentStateId: def.states.find((s) => s.initial)!.stateId,
      visitedStateIds: [],
      reachedOutcomeIds: [],
      completion: "not_started" as const,
      actionLog: [],
      deviceTested: false as const,
      updatedAt: i.createdAt,
    };
  const item = deps.catalog.get(i.sceneId, i.sceneVersion);
  const latest = deps.catalog.latest(i.sceneId);
  const registryDrift = item !== undefined && item.contentHash !== i.definitionHash;
  const newerVersion = latest && latest.version > i.sceneVersion && latest.status === "active" ? latest.version : undefined;

  const caveats: string[] = [];
  if (i.mode === "exploratory") caveats.push("这是通用说明性场景，未结合你的确认需求，不是个性化推荐");
  if (i.applicability.result !== "applicable") caveats.push(...i.applicability.reasons.map((r) => r.text));
  if (i.status !== "active") caveats.push(`场景已${i.status === "invalid" ? "失效" : "被取代"}`);
  if (i.applicability.isMock || def.isMock) caveats.push("【MOCK】内含模拟数据，不是真实华为设备功能");
  if (item === undefined) caveats.push("注册表已不再包含该场景版本，仅按冻结副本回放");
  if (registryDrift) caveats.push("注册表中该版本的内容与创建时不一致，操作已停用");

  return {
    instance: i,
    title: def.title,
    summary: def.summary,
    knowledgeScope: def.knowledgeScope,
    competitionEligible: def.competitionEligible,
    definition: def,
    experience: exp,
    ...(item?.invalidation ? { invalidation: item.invalidation } : {}),
    registryDrift,
    ...(newerVersion ? { newerVersion } : {}),
    caveats,
  };
}

function buildSnapshot(rec: SessionRecord, deps: SessionServiceDeps): SessionSnapshot {
  const current = rec.needVersions.at(-1)!;
  const conf = validConfirmation(current, rec.confirmations);
  const invalidated = rec.confirmations.filter((c) => c.status === "invalidated");
  const needsStatus: NeedsStatus = conf
    ? "confirmed"
    : invalidated.some((c) => (c.invalidatedByVersion ?? 0) <= current.version)
      ? "changed_since_confirmation"
      : rec.questions.some((q) => q.status === "open") || current.entries.length === 0
        ? "collecting"
        : "awaiting_confirmation";

  const currentPlan = rec.plans.find((p) => p.status === "current");
  const currentPage = currentPlan ? rec.pages.find((p) => p.planVersion === currentPlan.version) : undefined;
  const canCompose = conf !== undefined && rec.runState.state !== "failed";
  const cannotComposeReason = !conf ? "需要先确认需求" : rec.runState.state === "failed" ? "引擎出错" : undefined;

  const catalog = safeCatalog(deps.catalog);
  const instances = rec.instances.map((i) => instanceView(rec, i, deps)).filter((v): v is InstanceView => v !== undefined);

  return {
    sessionId: rec.sessionId,
    revision: rec.revision,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    run: rec.runState,
    needs: {
      version: current.version,
      status: needsStatus,
      entries: current.entries,
      summary: buildNeedSummary(current, rec.confirmations),
      ...(conf ? { confirmation: conf } : {}),
      invalidatedConfirmations: invalidated,
    },
    conversation: {
      messages: rec.messages as SessionMessage[],
      openQuestions: rec.questions.filter((q) => q.status === "open") as SessionQuestion[],
      resolvedQuestions: rec.questions.filter((q) => q.status !== "open") as SessionQuestion[],
    },
    candidates: {
      assessments: rec.candidates,
      stale: rec.candidates.length > 0 && rec.candidates.some((c) => c.assessedNeedVersion < current.version),
      rejectedProductIds: rec.rejectedProductIds,
    },
    plan: {
      ...(currentPlan ? { current: currentPlan } : {}),
      versions: rec.plans.map((p) => ({ version: p.version, status: p.status, needVersion: p.needVersion, createdAt: p.createdAt })),
      canCompose,
      ...(cannotComposeReason ? { cannotComposeReason } : {}),
      notes: rec.planNotes,
    },
    scenes: { instances, catalog },
    feedback: rec.feedback,
    impacts: rec.impacts,
    ...(currentPage ? { page: currentPage } : {}),
    qa: currentPlan ? rec.qa.filter((q) => q.planVersion === currentPlan.version) : [],
    capabilities: declareCapabilities(deps.profile, deps.facts),
    components: {
      engine: { isMock: rec.usedMock.engine },
      knowledge: { isMock: rec.usedMock.knowledge },
      dataOrigin: deps.dataOrigin,
    },
    isMock:
      rec.usedMock.engine ||
      rec.usedMock.knowledge ||
      rec.usedMock.data ||
      rec.instances.some((i) => i.evidenceSnapshot.isMock) ||
      rec.plans.some((p) => p.isMock) ||
      instances.some((v) => v.definition.isMock),
  };
}

function safeCatalog(catalog: SceneCatalog): SceneCatalogItem[] {
  try {
    return catalog.list();
  } catch {
    return [];
  }
}

export function getSession(sessionId: string, deps: SessionServiceDeps): SessionSnapshot {
  const rec = deps.store.load(sessionId);
  if (!rec) throw new SessionError("not_found", `会话 ${sessionId} 不存在`);
  return buildSnapshot(rec, deps);
}

/* ------------------------------ 会话管理器（HTTP 层使用） ------------------------------ */

/** 没有接入答疑智能体时使用：如实告诉用户未配置，而不是假装回答。 */
const UNCONFIGURED_QA: QaEngine = {
  isMock: false,
  answer: () => Promise.reject(new Error("答疑智能体尚未配置")),
};

export interface SessionManagerOptions {
  store: SessionStore;
  engine?: AdvisorEngine;
  advisor?: AdvisorEngine;
  data: DataService;
  model: ModelService;
  catalog?: SceneCatalog;
  registry?: SceneCatalog;
  knowledge: DeviceKnowledgeService;
  profile?: RuntimeProfile;
  facts?: RuntimeFacts;
  dataOrigin?: "local" | "ima" | "mock";
  /** 答疑智能体；不提供时提问会得到“未配置”的失败回复。 */
  qa?: QaEngine;
  /** 体验页内容填充器；默认不配置（图片位保持占位）。 */
  fillers?: PageFillers;
}

/**
 * 把会话用例封装成服务端可调用的对象。
 * 所有写操作都带 revision 门控；同一会话的异步写操作串行执行，避免读-判-写丢更新。
 */
export class SessionManager {
  private readonly deps: SessionServiceDeps;
  private readonly chain = new Map<string, Promise<unknown>>();

  constructor(opts: SessionManagerOptions) {
    const engine = opts.engine ?? opts.advisor;
    const catalog = opts.catalog ?? opts.registry;
    if (!engine) throw new Error("SessionManager 需要 engine（或 advisor）");
    if (!catalog) throw new Error("SessionManager 需要 catalog（或 registry）");
    this.deps = {
      store: opts.store,
      engine,
      data: opts.data,
      model: opts.model,
      catalog,
      knowledge: opts.knowledge,
      profile: opts.profile ?? "server_local",
      facts: opts.facts ?? { modelConfigured: false, imaConnected: false, persistent: opts.store.persistent },
      dataOrigin: opts.dataOrigin ?? "local",
      qa: opts.qa ?? UNCONFIGURED_QA,
      fillers: opts.fillers ?? NO_FILLERS,
    };
  }

  private run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chain.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.chain.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  create(text: string): Promise<SessionSnapshot> {
    return this.run("__new__", () => Promise.resolve(createSession(text, this.deps)));
  }

  get(sessionId: string): SessionSnapshot {
    return getSession(sessionId, this.deps);
  }

  list(): ReturnType<typeof listSessions> {
    return listSessions(this.deps);
  }

  capabilities(): CapabilityReport {
    return declareCapabilities(this.deps.profile, this.deps.facts);
  }

  catalog(): SceneCatalogItem[] {
    return this.deps.catalog.list();
  }

  scene(sceneId: string, version: number): SceneCatalogItem {
    const item = this.deps.catalog.get(sceneId, version);
    if (!item) throw new SessionError("not_found", `场景 ${sceneId}@${version} 不存在`);
    return item;
  }

  message(sessionId: string, text: string, baseRevision: number): Promise<SessionSnapshot> {
    return this.run(sessionId, () => handleMessage(sessionId, text, baseRevision, this.deps));
  }

  answer(sessionId: string, answers: { questionId: string; answer: string }[], freeText: string | undefined, baseRevision: number): Promise<SessionSnapshot> {
    return this.run(sessionId, () => handleAnswers(sessionId, answers, freeText, baseRevision, this.deps));
  }

  // 所有写操作都进同一条会话队列：同步写也必须排在正在等待模型的异步写之后，否则会互相覆盖。
  editNeeds(sessionId: string, edits: NeedEdit[], baseRevision: number): Promise<SessionSnapshot> {
    return this.run(sessionId, async () => editNeedsDirect(sessionId, edits, baseRevision, this.deps));
  }

  confirm(sessionId: string, needVersion: number, fingerprint: string, baseRevision?: number): Promise<{ duplicate: boolean; snapshot: SessionSnapshot }> {
    return this.run(sessionId, async () => confirmNeeds(sessionId, needVersion, fingerprint, baseRevision, this.deps));
  }

  async compose(sessionId: string, baseRevision: number): Promise<SessionSnapshot> {
    const snap = await this.run(sessionId, () => composePlan(sessionId, baseRevision, this.deps));
    if (snap.page?.filling) void this.fillPage(sessionId, snap.page);
    return snap;
  }

  /** 填充在写队列之外跑（可能调用外部接口），结果再进队列写回。 */
  private async fillPage(sessionId: string, page: ExperiencePage): Promise<void> {
    const needs = this.get(sessionId).needs.entries;
    let results: Awaited<ReturnType<typeof collectSlotResults>> = [];
    try {
      results = await collectSlotResults(page, this.deps.fillers, { needs });
    } catch {
      results = [];
    }
    await this.run(sessionId, async () => applyPageFill(sessionId, page.planVersion, results, this.deps)).catch(() => undefined);
  }

  ask(sessionId: string, question: string, baseRevision: number): Promise<SessionSnapshot> {
    return this.run(sessionId, () => askQuestion(sessionId, question, baseRevision, this.deps));
  }

  explore(sessionId: string, sceneId: string, version: number | undefined, baseRevision?: number): Promise<SessionSnapshot> {
    return this.run(sessionId, async () => exploreScene(sessionId, sceneId, version, baseRevision, this.deps));
  }

  action(sessionId: string, instanceId: string, actionId: string, baseRevision?: number): Promise<SessionSnapshot> {
    return this.run(sessionId, async () => applySceneAction(sessionId, instanceId, actionId, baseRevision, this.deps));
  }

  feedback(sessionId: string, input: FeedbackRequestBody & { baseRevision: number }): Promise<SessionSnapshot> {
    return this.run(sessionId, () => submitFeedback(sessionId, input, input.baseRevision, this.deps));
  }

  resume(sessionId: string, baseRevision?: number): Promise<SessionSnapshot> {
    return this.run(sessionId, async () => resumeSession(sessionId, baseRevision, this.deps));
  }

  export(sessionId: string, planVersion?: number): RecoveryPack {
    return exportSession(sessionId, this.deps, planVersion);
  }
}
