/**
 * 需求顾问：多轮需求理解 → 检索 → 摘要 → 用户确认 → 受控生成 → 核验 → 交付/修改。
 *
 * 公开动作（均返回新的 ConversationState，不修改入参）：
 *   start / message / confirm / editSummary / generate / revise / checkGate
 * 确认只能由 confirm() 产生，且由调用方（服务端）在真实用户操作后调用；
 * 用户在聊天里输入“确认”二字、模型输出 confirmed=true，都不会产生确认记录。
 */
import type { DataService, ModelService, Platform } from "@hwpc/contracts";
import { evaluateGate, activeSummary } from "./gate.js";
import { buildInteractionPlan, draftArticle } from "./generate.js";
import { guardModel } from "./guard.js";
import { DELEGATE_CUE_RE, PLATFORM_LABEL } from "./lexicon.js";
import {
  applyDefaults,
  decideNext,
  pendingOpenQuestions,
  planQuestions,
  reconcileQuestions,
  resolveCrossConflict,
  syncCrossConflicts,
} from "./planner.js";
import { latestEvidence, loadCandidateEvidence, loadEvidence, matchCandidate, searchInto, type RetrievalDeps } from "./retrieval.js";
import {
  ConsultantError,
  addTurn,
  audit,
  closeConflict,
  commit,
  createState,
  openConflicts,
  removeFromMulti,
  reqFingerprint,
  restoreState,
  setItem,
} from "./state.js";
import { buildStrategy, directionFingerprint, isResolvingDecision, pickDirection, scopeOf } from "./strategy.js";
import { assessReadiness, buildSummary } from "./summary.js";
import {
  extract,
  parseUnderstanding,
  UNDERSTANDING_SYSTEM_PROMPT,
  type Extraction,
} from "./understand.js";
import type { Artifact, ChangeImpact, ConversationState, GateResult, Question, ReqKey, Source } from "./types.js";
import { hash, norm } from "./util.js";
import { MAX_REPAIR_ROUNDS, verifyAndRepair } from "./verify.js";
import { PLATFORM_PLANS, MIN_POINTS } from "./strategy.js";

export interface ConsultantDeps {
  data: DataService;
  model: ModelService;
  now?: () => Date;
  /** 报告真实事件（映射到 WorkflowContext.emit）。 */
  emit?: (e: { stage?: string; type: string; message: string; detail?: Record<string, unknown>; simulated?: boolean }) => void;
  signal?: AbortSignal;
  /** 是否在理解阶段调用模型做补充抽取（默认 true）。 */
  useModelUnderstanding?: boolean;
}

export interface Reply {
  state: ConversationState;
  /** 本轮给用户的文字。 */
  text: string;
  questions: Question[];
  nextAction: ConversationState["nextAction"];
  summary?: ConversationState["summaries"][number];
  impact?: ChangeImpact;
  gate?: GateResult;
  artifact?: Artifact;
}

const USER_SRC = (turn: number, quote?: string): Source => ({ kind: "user", turn, quote });
const clone = <T>(v: T): T => structuredClone(v);

export class Consultant {
  private now: () => Date;
  constructor(private deps: ConsultantDeps) {
    this.now = deps.now ?? (() => new Date());
  }
  private at() {
    return this.now().toISOString();
  }
  private retrievalDeps(simulated = false): RetrievalDeps {
    const emit = this.deps.emit;
    return {
      data: this.deps.data,
      now: this.now,
      signal: this.deps.signal,
      simulated,
      emit: emit ? (e) => emit({ stage: e.stage, type: "data_access", message: e.message, detail: e.detail, simulated: e.simulated }) : undefined,
    };
  }

  /* ------------------------------ 入口 ------------------------------ */

  async start(taskId: string, firstMessage: string, preset?: Partial<Record<ReqKey, string>>): Promise<Reply> {
    const s = createState(taskId, this.at());
    void preset;
    return this.turn(s, firstMessage);
  }

  /** 用户的一条自由消息。 */
  async message(prev: ConversationState, text: string): Promise<Reply> {
    return this.turn(clone(prev), text);
  }

  /* ------------------------------ 主流程 ------------------------------ */

  private async turn(s: ConversationState, text: string): Promise<Reply> {
    if (s.stage === "generating") throw new ConsultantError("invalid_state", "正在生成，请稍候");
    const at = this.at();
    const turn = addTurn(s, "user", text, at);
    const wasLocked = s.summaries.some((x) => x.requirementVersion === s.requirementVersion);

    // 聊天里的“确认”不产生确认：只提示去点确认按钮
    let confirmHint = "";
    const ex = extract(text, { targetKeys: this.openTargets(s), answerValue: text });
    if (ex.confirmTextAttempt) {
      audit(s, at, { type: "chat_confirm_ignored", detail: "聊天文本中的确认不生效" });
      confirmHint = activeSummary(s)?.status === "pending" ? "确认需要你在摘要上点击「确认并生成」，聊天里的回复不会触发生成。" : "";
    }

    // 1) 模型补充理解（只用于理解，不会生成作品）
    const extra = await this.modelUnderstanding(s, text, turn);
    // 2) 回答已有问题（选项值或自由文本）
    this.applyAnswers(s, text, ex, turn);
    // 3) 写入自由表达里的多个需求项
    await this.applyExtraction(s, ex, text, turn, extra);
    // 4) 派生矛盾、默认值
    syncCrossConflicts(s, turn);
    // 5) 检索：提到的型号 / 品类 / 产品事实提问
    await this.retrieve(s, ex, text, turn);
    syncCrossConflicts(s, turn);
    applyDefaults(s, turn);
    reconcileQuestions(s, turn);

    // 6) 版本提交（已有摘要后的关键变化 → 新版本，旧确认失效）
    let impact = commit(s, at);
    if (impact) {
      this.deps.emit?.({ stage: "scenario_analysis", type: "info", message: `需求更新到 v${s.requirementVersion}，旧确认已失效：${impact.changedKeys.join("、")}` });
      // 变化可能影响型号/配置/强调点：重新检索并重新制定内容方向
      if (s.items["productScope"]?.refs?.length) await loadEvidence(s, "summary", this.retrievalDeps());
    }
    void wasLocked;
    return this.finish(s, at, { impact, hint: confirmHint, factAnswer: ex.factQuestions.length > 0 });
  }

  private openTargets(s: ConversationState): ReqKey[] {
    return pendingOpenQuestions(s).flatMap((q) => q.targetKeys);
  }

  /* ---- 模型理解（受限） ---- */
  private async modelUnderstanding(s: ConversationState, text: string, turn: number) {
    if (this.deps.useModelUnderstanding === false) return [];
    const g = guardModel(this.deps.model, s, this.now);
    try {
      const res = await g.call("understanding", UNDERSTANDING_SYSTEM_PROMPT, JSON.stringify({ latestUserMessage: text, knownKeys: Object.keys(s.items) }), { json: true, temperature: 0, maxTokens: 600, signal: this.deps.signal });
      const u = parseUnderstanding(res.text, text);
      if (u.ignoredForgery) audit(s, this.at(), { type: "forged_confirmation_ignored", purpose: "understanding", detail: "模型输出包含 confirmed 类字段，已丢弃" });
      void turn;
      return u.accepted;
    } catch {
      return [];
    }
  }

  /* ---- 回答已有问题 ---- */
  private applyAnswers(s: ConversationState, text: string, ex: Extraction, turn: number) {
    const open = pendingOpenQuestions(s);
    const t = text.trim();
    for (const q of open) {
      const opt = q.options?.find((o) => o.value === t || norm(o.label) === norm(t));
      switch (q.kind) {
        case "clarify_conflict": {
          const c = s.conflicts.find((x) => x.conflictId === q.questionId.replace(/^q-conflict-/, "").replace(/-r\d+$/, ""));
          if (!c || c.status !== "open") break;
          let chosen = c.options.find((o) => o.value === t || norm(o.label) === norm(t));
          if (!chosen && !opt) chosen = c.options.find((o) => o.value.length >= 2 && t.includes(o.value) && !c.options.filter((x) => x !== o && t.includes(x.value)).length);
          if (chosen) {
            if (c.kind === "cross_field") {
              const keep = chosen.value.replace(/^keep:/, "") as ReqKey;
              resolveCrossConflict(s, c.conflictId, keep, turn);
            } else {
              const key = c.keys[0]!;
              setItem(s, key, chosen.value, { source: USER_SRC(turn, t), explicit: true, status: "confirmed", reason: "conflict_resolution" });
              closeConflict(c, `用户选择：${chosen.value}`, turn);
            }
            q.status = "answered";
            q.answer = chosen.value;
            q.answeredTurn = turn;
          }
          break;
        }
        case "choose_candidate": {
          const productId = opt?.value ?? s.candidates.find((c) => norm(t).includes(norm(c.model)) || norm(c.model).includes(norm(t)) && norm(t).length >= 4)?.productId;
          if (productId && productId !== "none") {
            this.chooseCandidate(s, productId, undefined, turn, t);
            q.status = "answered";
            q.answer = productId;
            q.answeredTurn = turn;
          } else if (productId === "none") {
            for (const c of s.candidates) if (c.status === "open") c.status = "rejected";
            q.status = "answered";
            q.answer = "none";
            q.answeredTurn = turn;
          }
          break;
        }
        case "choose_config": {
          const pid = q.questionId.replace(/^q-config-/, "").replace(/-r\d+$/, "");
          const cand = s.candidates.find((c) => c.productId === pid);
          const cfg = opt?.value && opt.value !== "any" ? cand?.configurations.find((c) => c.configurationId === opt.value) : cand?.configurations.find((c) => norm(t).includes(norm(c.label)));
          if (cfg) {
            this.chooseCandidate(s, pid, cfg.configurationId, turn, t);
            q.status = "answered";
            q.answer = cfg.configurationId;
            q.answeredTurn = turn;
          } else if (opt?.value === "any" || /不限|通用|都可以|无所谓/.test(t)) {
            s.decisions.push({ decisionId: `d-${s.decisions.length + 1}`, gapId: `config:${pid}`, decision: "不限定配置，只写通用信息", turn });
            q.status = "answered";
            q.answer = "any";
            q.answeredTurn = turn;
          }
          break;
        }
        case "gap_handling": {
          const gid = q.questionId.replace(/^q-gap-/, "").replace(/-r\d+$/, "");
          const v = opt?.value ?? (isResolvingDecision(t) ? "drop" : /等|补充|更新|更正/.test(t) ? "wait" : undefined);
          if (!v) break;
          const label = opt?.label ?? t;
          if (v === "wait") {
            s.decisions.push({ decisionId: `d-${s.decisions.length + 1}`, gapId: gid, decision: `暂不处理：${label}`, turn });
            q.status = "answered";
            q.answer = v;
            q.answeredTurn = turn;
            break;
          }
          s.decisions.push({ decisionId: `d-${s.decisions.length + 1}`, gapId: gid, decision: v === "exclude" ? `不采用冲突内容：${label}` : v === "drop" ? `删去相关强调：${label}` : `缩小范围：${label}`, turn });
          if (gid.startsWith("topic:") && (v === "drop" || v === "narrow")) {
            const topic = gid.slice("topic:".length);
            const it = s.items["mustEmphasize"];
            if (it) {
              const keep = it.value.split("；").filter((p) => !(extractTopics(p).includes(topic)));
              it.history.push({ value: it.value, source: it.source, replacedAtTurn: turn, replacedAtVersion: s.requirementVersion, reason: "user_modification" });
              if (keep.length) it.value = keep.join("；");
              else delete s.items["mustEmphasize"];
            }
          }
          q.status = "answered";
          q.answer = v;
          q.answeredTurn = turn;
          break;
        }
        case "preference": {
          // 偏好类：只有当抽取到目标项或选项值才视为已回答
          const optionText = opt?.value;
          if (optionText && q.targetKeys.length) {
            const ex2 = extract(optionText, { targetKeys: q.targetKeys, answerValue: optionText });
            ex.sets.push(...ex2.sets.filter((x) => !ex.sets.some((y) => y.key === x.key && y.value === x.value)));
          }
          if (ex.delegated && DELEGATE_CUE_RE.test(t)) {
            // 用户把决定权交给系统：采用建议但标为系统来源（不算用户确认）
            q.answer = "delegated";
          }
          break;
        }
      }
    }
  }

  private chooseCandidate(s: ConversationState, productId: string, configurationId: string | undefined, turn: number, quote: string) {
    const cand = s.candidates.find((c) => c.productId === productId);
    if (!cand) return;
    const keepConfig = configurationId ?? s.items["productScope"]?.refs?.find((r) => r.productId === productId)?.configurationId;
    for (const c of s.candidates) if (c.productId !== productId && c.status === "open") c.status = "rejected";
    cand.status = "chosen";
    const refs = [{ productId, ...(keepConfig ? { configurationId: keepConfig } : {}) }];
    const cfg = cand.configurations.find((c) => c.configurationId === keepConfig);
    setItem(s, "productScope", `${cand.model}${cfg ? `（${cfg.label}）` : ""}`, { source: USER_SRC(turn, quote), refs, explicit: true, status: "confirmed", reason: "user_modification" });
  }

  /* ---- 写入抽取结果 ---- */
  private async applyExtraction(s: ConversationState, ex: Extraction, text: string, turn: number, model: Awaited<ReturnType<Consultant["modelUnderstanding"]>>) {
    const src = USER_SRC(turn, text);
    for (const m of ex.multi) {
      const labels = m.key === "platform" ? ex.multi[0]!.values.map((v) => PLATFORM_LABEL[v as Platform] ?? v) : ex.multi[0]!.values;
      if (!s.items[m.key]) {
        s.items[m.key] = {
          key: m.key,
          value: m.values[0]!,
          status: "conflict",
          source: src,
          critical: true,
          setAtVersion: s.requirementVersion,
          history: [],
          alternatives: m.values.slice(1).map((v) => ({ value: v, turn })),
        };
        void labels;
      }
      s.conflicts.push({
        conflictId: `cf-${s.conflicts.length + 1}`,
        kind: "value_clash",
        keys: [m.key],
        options: m.values.map((v) => ({ value: v, label: m.key === "platform" ? (PLATFORM_LABEL[v as Platform] ?? v) : v, turn })),
        description: `同一句里提到了多个${m.key === "platform" ? "渠道" : "场景"}：${labels.join("、")}`,
        status: "open",
        openedTurn: turn,
      });
    }
    for (const x of ex.sets) {
      if (x.key === "productScope") continue;
      const isInferred = Boolean(x.inferred);
      setItem(s, x.key, x.value, {
        source: isInferred ? { kind: "system", turn, quote: x.quote, note: "由人群推断" } : src,
        status: isInferred ? "tentative" : "confirmed",
        explicit: x.explicit,
      });
    }
    for (const r of ex.removals) removeFromMulti(s, r.key, r.part, src);
    // 模型补充：quote 确为用户原话 → 用户表达；否则只是系统建议（tentative）
    for (const m of model) {
      if (m.key === "productScope") continue;
      if (s.items[m.key] && s.items[m.key]!.status === "confirmed") continue;
      setItem(s, m.key, m.value, m.fromUser ? { source: USER_SRC(turn, m.quote), status: "confirmed" } : { source: { kind: "system", turn, note: "模型建议，未经用户确认" }, status: "tentative" });
    }
    for (const c of ex.claims) if (!s.userClaims.some((x) => x.text === c.text)) s.userClaims.push({ turn, kind: c.kind, text: c.text, status: "unverified" });
    for (const m of ex.productMentions) if (!s.productMentions.includes(m)) s.productMentions.push(m);
    if (ex.categoryScope && !s.items["productScope"]) {
      setItem(s, "productScope", ex.categoryScope, { source: src, status: "tentative" });
    }
    // 偏好问题：用户交给系统决定 → 系统建议，不算确认
    if (ex.delegated) this.applyDelegation(s, turn);
  }

  private applyDelegation(s: ConversationState, turn: number) {
    for (const q of pendingOpenQuestions(s)) {
      if (q.kind !== "preference") continue;
      if (q.targetKeys.includes("platform") && !s.items["platform"] && s.items["scenario"]) {
        const suggested = s.items["scenario"].value === "store_visit" ? "store_moments" : "xiaohongshu";
        setItem(s, "platform", suggested, { source: { kind: "system", turn, note: "用户请系统建议" }, status: "tentative" });
      }
    }
  }

  /* ---- 检索 ---- */
  private async retrieve(s: ConversationState, ex: Extraction, text: string, turn: number) {
    const rd = this.retrievalDeps();
    // a) 用户提到具体型号
    for (const m of ex.productMentions) {
      if (s.searchLog.some((x) => x.query === m && !x.error)) continue;
      this.deps.emit?.({ stage: "material_retrieval", type: "info", message: `用户提到型号「${m}」，向资料层查询` });
      const r = await searchInto(s, m, "mention", rd);
      if (r.ok && r.found.length === 1) {
        const only = r.found[0]!;
        if (!s.items["productScope"]?.refs?.length || s.items["productScope"]!.status !== "confirmed") {
          const cfgNeeded = r.configOptions.length > 0;
          this.chooseCandidate(s, only.productId, undefined, turn, text);
          void cfgNeeded;
        }
      } else if (r.ok && r.found.length === 0) {
        s.productMentions = s.productMentions.filter((x) => x !== m);
      }
    }
    // b) 品类范围：未定产品 → 按已知需求检索候选
    const scope = s.items["productScope"];
    if (scope && !scope.refs?.length && ex.categoryScope) {
      for (const q of this.candidateQueries(s, ex.categoryScope)) {
        if (s.searchLog.some((x) => x.query === q && !x.error)) continue;
        await searchInto(s, q, "category_search", rd);
      }
    }
    if (scope && !scope.refs?.length || (!scope && s.candidates.length === 0 && s.productMentions.length === 0 && false)) {
      /* 保持：仅在存在品类范围时检索 */
    }
    // c) 候选亮点：用于区分候选
    if (s.candidates.some((c) => c.status !== "rejected" && !c.evidenceLoaded)) await loadCandidateEvidence(s, rd);
    // d) 已选型号 → 取完整证据；配置需求由资料层给出
    if (s.items["productScope"]?.refs?.length) {
      const ref = s.items["productScope"]!.refs![0]!;
      const cand = s.candidates.find((c) => c.productId === ref.productId);
      if (cand && !cand.evidenceLoaded) await loadCandidateEvidence(s, rd);
      if (!latestEvidence(s)) await loadEvidence(s, "summary", rd);
    }
    // e) 产品事实提问 → 查资料，不问用户
    for (const fq of ex.factQuestions) await this.answerFact(s, fq.text, fq.categories, turn);
  }

  /** 品类检索词：由已知需求（场景/强调）决定，用于挑出能区分候选的搜索。 */
  private candidateQueries(s: ConversationState, category: string): string[] {
    const qs = [category];
    const sc = s.items["scenario"]?.value;
    if (sc === "back_to_school" || sc === "business_office") qs.push("轻薄本");
    return [...new Set(qs)];
  }

  private async answerFact(s: ConversationState, qtext: string, categories: string[], turn: number) {
    if (categories.includes("price")) {
      const ev = latestEvidence(s);
      const priceFacts = ev?.pack?.facts.filter((f) => f.category === "price" && f.qualifiers.length) ?? [];
      s.factQnA.push({ turn, text: qtext, factIds: priceFacts.map((f) => f.factId), status: priceFacts.length ? "answered" : "gap" });
      return;
    }
    const ev = latestEvidence(s);
    const ids: string[] = [];
    if (ev?.pack) for (const f of ev.pack.facts) if (categories.includes(f.category) && f.reviewStatus === "verified") ids.push(f.factId);
    else if (!ev) {
      const cands = s.candidates.filter((c) => c.status !== "rejected");
      for (const c of cands) for (const h of c.highlights) if (categories.includes(h.category)) ids.push(h.factId);
    }
    s.factQnA.push({ turn, text: qtext, factIds: ids, status: ids.length ? "answered" : "gap" });
    audit(s, this.at(), { type: "data_call", purpose: "answer_fact_question", detail: `${categories.join(",")}:${ids.length}` });
  }

  /* ------------------------------ 收尾：摘要 / 提问 ------------------------------ */

  private finish(s: ConversationState, at: string, o: { impact?: ChangeImpact; hint?: string; factAnswer?: boolean }): Reply {
    const parts: string[] = [];
    if (o.hint) parts.push(o.hint);
    if (o.factAnswer) parts.push(this.factAnswerText(s));
    if (o.impact) parts.push(`你的修改影响了：${o.impact.effects.map((e) => `${e.key}（${e.effect}）`).join("；")}。已有确认失效，需要重新确认。`);

    // 先尝试生成问题；没有开放问题且就绪才出摘要
    const asked = planQuestions(s, s.turns.length - 1);
    const open = pendingOpenQuestions(s);
    const readiness = assessReadiness(s);
    let summary;
    if (!open.length && readiness.ready) {
      const old = s.summaries.find((x) => x.requirementVersion === s.requirementVersion && x.status === "pending");
      if (old) old.status = "superseded";
      summary = buildSummary(s, at, { impact: o.impact, changeNote: o.impact ? `需求已更新到 v${s.requirementVersion}，请重新确认。` : undefined });
      s.summaries.push(summary);
      s.requirementSnapshots.push({ version: s.requirementVersion, fingerprint: reqFingerprint(s.items), at, items: clone(s.items) });
      s.stage = "awaiting_confirmation";
      s.nextAction = { type: "await_confirmation", summaryId: summary.summaryId, fingerprint: summary.fingerprint, requirementVersion: summary.requirementVersion };
      parts.push(summary.text);
    } else if (!open.length) {
      // 无问题但未就绪（例如等待检索/资料不足）：说明原因
      s.stage = "collecting";
      s.nextAction = decideNext(s).type === "blocked" ? { type: "discuss", note: readiness.blockers.join("；") || "继续补充信息" } : decideNext(s);
      parts.push(`还不能形成可确认的摘要：${readiness.blockers.join("；")}`);
    } else {
      s.stage = "collecting";
      s.nextAction = decideNext(s);
      parts.push(this.questionText(s, open));
    }
    if (s.candidates.some((c) => c.status === "open" && c.highlights.length) && !summary) parts.push(this.candidateText(s));
    const next = s.nextAction;
    void asked;
    addTurn(s, "assistant", parts.join("\n\n"), at);
    s.lastGate = evaluateGate(s);
    return { state: s, text: parts.join("\n\n"), questions: open.slice(0, 3), nextAction: next, summary, impact: o.impact, gate: s.lastGate };
  }

  private questionText(s: ConversationState, open: Question[]): string {
    const qs = open.slice(0, 3);
    return qs
      .map((q, i) => `${i + 1}. ${q.prompt}${q.options?.length ? `\n   可选：${q.options.map((o) => o.label).join(" / ")}（也可以直接用自己的话说）` : ""}\n   （${q.reason}）`)
      .join("\n");
  }

  private candidateText(s: ConversationState): string {
    const cs = s.candidates.filter((c) => c.status === "open" && c.highlights.length).slice(0, 3);
    return `资料里检索到的候选：\n${cs.map((c) => `- ${c.model}：${c.highlights.map((h) => `${h.field} ${h.value}（${h.factId}）`).join("；")}`).join("\n")}`;
  }

  private factAnswerText(s: ConversationState): string {
    const last = s.factQnA.at(-1);
    if (!last) return "";
    const ev = latestEvidence(s);
    const facts = last.factIds.map((id) => ev?.pack?.facts.find((f) => f.factId === id)).filter(Boolean);
    if (last.status === "gap") return "这个问题在当前资料里查不到依据，所以我不会给出具体数字；如果必须写进内容，需要先补充资料。";
    if (facts.length) return `资料里查到：\n${facts.map((f) => `- ${f!.field}：${f!.value}${f!.qualifiers.length ? `（${f!.qualifiers.join("；")}）` : ""}`).join("\n")}`;
    const hs = s.candidates.flatMap((c) => c.highlights.filter((h) => last.factIds.includes(h.factId)).map((h) => `- ${c.model} ${h.field}：${h.value}`));
    return hs.length ? `资料里查到：\n${hs.join("\n")}` : "";
  }

  /* ------------------------------ 确认 / 修改摘要 / 生成 ------------------------------ */

  /**
   * 用户在摘要上点击“确认并生成”。必须带当前摘要编号与指纹，
   * 只有真实用户操作经服务端调用该方法才会写入确认记录。
   */
  confirm(prev: ConversationState, req: { summaryId: string; fingerprint: string; requirementVersion: number }): { state: ConversationState; confirmationId: string } {
    const s = clone(prev);
    const at = this.at();
    const reject = (why: string): never => {
      audit(s, at, { type: "confirm_rejected", detail: why });
      throw new ConsultantError("confirm_rejected", why);
    };
    const sm = s.summaries.find((x) => x.summaryId === req.summaryId);
    if (!sm) return reject("找不到该摘要");
    if (sm.status !== "pending") return reject(`该摘要状态为 ${sm.status}，不能确认`);
    if (sm.requirementVersion !== s.requirementVersion || req.requirementVersion !== s.requirementVersion) return reject(`确认针对 v${req.requirementVersion}，当前需求已是 v${s.requirementVersion}`);
    if (sm.fingerprint !== req.fingerprint) return reject("摘要指纹不一致，摘要可能已变化");
    if (sm.requirementFingerprint !== reqFingerprint(s.items)) return reject("需求在摘要之后发生了变化");
    if (!sm.confirmable) return reject(`摘要存在阻止项：${sm.blockers.join("；")}`);
    const fresh = assessReadiness(s);
    if (!fresh.ready) return reject(`当前需求不满足确认条件：${fresh.blockers.join("；")}`);
    if (fresh.direction && directionFingerprint(fresh.direction) !== sm.directionFingerprint) return reject("资料已变化，内容方向与摘要不一致，请重新查看摘要");

    const confirmationId = `cn-${s.confirmations.length + 1}`;
    s.confirmations.push({
      confirmationId,
      requirementVersion: sm.requirementVersion,
      fingerprint: sm.fingerprint,
      requirementFingerprint: sm.requirementFingerprint,
      summaryId: sm.summaryId,
      confirmedAt: at,
      actor: "user",
      channel: "confirm_action",
      status: "valid",
    });
    sm.status = "confirmed";
    s.stage = "confirmed";
    s.nextAction = { type: "generate", fingerprint: sm.fingerprint, requirementVersion: sm.requirementVersion };
    audit(s, at, { type: "user_confirmed", detail: confirmationId });
    addTurn(s, "user", "（用户点击确认并生成）", at, "confirm");
    s.lastGate = evaluateGate(s);
    return { state: s, confirmationId };
  }

  /** 用户直接修改摘要中的某一项：产生新需求版本，需再次确认。 */
  async editSummary(prev: ConversationState, edits: Partial<Record<ReqKey, string>>): Promise<Reply> {
    const s = clone(prev);
    const at = this.at();
    const turn = addTurn(s, "user", `（修改摘要）${JSON.stringify(edits)}`, at, "summary_edit");
    for (const [k, v] of Object.entries(edits) as [ReqKey, string][]) {
      if (k === "productScope") {
        const ex = extract(v);
        for (const m of ex.productMentions) await searchInto(s, m, "mention", this.retrievalDeps());
        const c = matchCandidate(s, v);
        if (c) this.chooseCandidate(s, c.productId, undefined, turn, v);
        continue;
      }
      const ex = extract(v, { targetKeys: [k], answerValue: v });
      const hit = ex.sets.find((x) => x.key === k);
      const value = hit?.value ?? v;
      setItem(s, k, value, { source: USER_SRC(turn, v), explicit: true, status: "confirmed", reason: "summary_edit" });
    }
    syncCrossConflicts(s, turn);
    applyDefaults(s, turn);
    const impact = commit(s, at);
    if (s.items["productScope"]?.refs?.length) {
      if (!latestEvidence(s)) await loadEvidence(s, "summary", this.retrievalDeps());
    }
    reconcileQuestions(s, turn);
    return this.finish(s, at, { impact });
  }

  /** 查看当前门控（服务端在受理生成请求前必须调用）。 */
  checkGate(s: ConversationState): GateResult {
    return evaluateGate(s);
  }

  /**
   * 生成最终作品。先做补检索，再过门控；任一检查不通过就返回沟通/重新确认，绝不调用生成模型。
   */
  async generate(prev: ConversationState, opts: { kind?: Artifact["kind"]; reason?: string } = {}): Promise<Reply> {
    const s = clone(prev);
    const at = this.at();
    // 生成前补检索：证据可能已变，不能借旧确认
    if (s.items["productScope"]?.refs?.length && (s.stage === "confirmed" || s.stage === "delivered")) {
      await loadEvidence(s, "pre_generation", this.retrievalDeps());
    }
    const gate = evaluateGate(s);
    audit(s, at, { type: "gate", detail: gate.allowed ? "通过" : `未通过：${gate.failed.join(",")}` });
    s.lastGate = gate;
    if (!gate.allowed) {
      return this.sendBack(s, gate, at);
    }
    const sm = activeSummary(s)!;
    const conf = s.confirmations.find((c) => c.summaryId === sm.summaryId && c.status === "valid")!;
    const ev = latestEvidence(s)!;
    const pack = ev.pack!;
    s.stage = "generating";
    const guarded = guardModel(this.deps.model, s, this.now);
    const direction = sm.contentDirection!;
    const draft = await draftArticle({ state: s, pack, direction, model: guarded, signal: this.deps.signal });
    this.deps.emit?.({ stage: "drafting", type: "stage_completed", message: draft.mode === "model" ? "模型已生成结构化图文" : (draft.note ?? "已使用模板稿"), simulated: draft.simulated });

    const plan0 = buildInteractionPlan(s, pack, direction, sm.fingerprint);
    const platform = s.items["platform"]!.value as Platform;
    const out = verifyAndRepair({ state: s, pack, article: draft.article, plan: plan0, allowedFactIds: direction.selected.map((x) => x.factId), minImages: PLATFORM_PLANS[platform].imageCount.min }, at);
    this.deps.emit?.({ stage: "verification", type: "stage_completed", message: `核验完成：${out.report.deliveryStatus}`, detail: { rounds: out.rounds }, simulated: pack.isMock });

    const prevCurrent = [...s.artifacts].reverse().find((a) => a.status !== "superseded" || true);
    const version = s.artifacts.length + 1;
    const artifactId = `art-${version}`;
    const reportId = `vr-${version}`;
    const strategy = buildStrategy(s, direction);
    const art: Artifact = {
      artifactId,
      version,
      parentArtifactId: prevCurrent?.artifactId,
      createdAt: at,
      kind: opts.kind ?? (version === 1 ? "initial" : "regeneration"),
      reason: opts.reason ?? (version === 1 ? "首次生成" : "按新的需求版本重新生成"),
      requirementVersion: s.requirementVersion,
      fingerprint: sm.fingerprint,
      confirmationId: conf.confirmationId,
      evidenceSnapshotId: ev.snapshotId,
      verificationReportId: reportId,
      reportMeta: { reportId, subjectArtifactId: artifactId, inheritedFrom: null, checkedAt: at },
      status: "current",
      result: { strategy, article: out.article, verification: out.report, materialPack: pack, isMock: pack.isMock || draft.simulated },
      selection: direction,
      interactionPlan: out.plan,
      generationMode: draft.mode,
      modelSimulated: draft.simulated,
      repairRounds: out.rounds,
    };
    for (const a of s.artifacts) if (a.status === "current") a.status = "superseded";
    s.artifacts.push(art);
    const delivered = out.report.deliveryStatus !== "blocked";
    s.stage = delivered ? "delivered" : "blocked";
    s.blockedReason = delivered ? undefined : "核验未通过，已阻止交付";
    s.nextAction = delivered ? { type: "deliver", artifactId } : { type: "blocked", reason: "核验发现无法自动修复的问题，已阻止交付" };
    const text = delivered
      ? `已按 v${s.requirementVersion} 的确认内容生成作品 v${version}（核验：${out.report.deliveryStatus}${draft.mode === "template_fallback" ? "；使用模板稿" : ""}）。`
      : `作品 v${version} 经 ${out.rounds}/${MAX_REPAIR_ROUNDS} 轮修订后仍有未解决问题，已阻止交付。`;
    addTurn(s, "assistant", text, at);
    return { state: s, text, questions: [], nextAction: s.nextAction, gate, artifact: art };
  }

  private sendBack(s: ConversationState, gate: GateResult, at: string): Reply {
    const failed = gate.checks.filter((c) => !c.ok);
    const lines = failed.map((c) => `- ${c.detail}`);
    let text: string;
    switch (gate.returnTo) {
      case "awaiting_confirmation": {
        const stillPending = s.summaries.find((x) => x.status === "pending" && x.requirementVersion === s.requirementVersion);
        s.stage = "awaiting_confirmation";
        if (stillPending) s.nextAction = { type: "await_confirmation", summaryId: stillPending.summaryId, fingerprint: stillPending.fingerprint, requirementVersion: stillPending.requirementVersion };
        else {
          const sm = buildSummary(s, at);
          if (sm.confirmable) {
            s.summaries.forEach((x) => x.status !== "superseded" && (x.status = "superseded"));
            s.summaries.push(sm);
            s.requirementSnapshots.push({ version: s.requirementVersion, fingerprint: reqFingerprint(s.items), at, items: clone(s.items) });
            s.nextAction = { type: "await_confirmation", summaryId: sm.summaryId, fingerprint: sm.fingerprint, requirementVersion: sm.requirementVersion };
          } else s.nextAction = { type: "discuss", note: sm.blockers.join("；") };
        }
        text = `暂不能生成，需要你先确认当前版本：\n${lines.join("\n")}`;
        break;
      }
      case "discuss_evidence_gap": {
        s.stage = "collecting";
        const ev = latestEvidence(s);
        if (ev?.pack) planQuestions(s, s.turns.length);
        s.nextAction = decideNext(s).type === "blocked" ? { type: "discuss_evidence_gap", gaps: failed.map((c) => c.detail), paths: ["补充资料", "缩小范围", "删去相关承诺"] } : decideNext(s);
        text = `资料不足以支撑当前内容，先回到沟通：\n${lines.join("\n")}`;
        break;
      }
      case "resolve_material_conflict": {
        s.stage = "collecting";
        const ev = latestEvidence(s);
        if (ev?.pack) planQuestions(s, s.turns.length);
        s.nextAction = decideNext(s);
        if (s.nextAction.type === "blocked" || s.nextAction.type === "ask_user") s.nextAction = { type: "resolve_material_conflict", conflictIds: ev?.pack?.conflicts.filter((c) => c.status === "unresolved").map((c) => c.conflictId) ?? [], paths: ["不采用冲突内容", "等待资料更正"] };
        text = `资料存在冲突，已阻止受影响内容：\n${lines.join("\n")}`;
        break;
      }
      default: {
        s.stage = s.stage === "blocked" ? "blocked" : "collecting";
        const open = pendingOpenQuestions(s);
        s.nextAction = open.length ? { type: "ask_user", questionIds: open.slice(0, 3).map((q) => q.questionId) } : { type: "discuss", note: lines.join("；") };
        text = `暂不能生成：\n${lines.join("\n")}`;
      }
    }
    addTurn(s, "assistant", text, at);
    return { state: s, text, questions: pendingOpenQuestions(s).slice(0, 3), nextAction: s.nextAction, gate };
  }

  /* ------------------------------ 修改 ------------------------------ */

  /**
   * 对已有作品的修改：
   *  - 关键需求变化 → 新需求版本，旧确认失效，旧作品 stale，重新检索并出新摘要，等待重新确认；
   *  - 非关键表达调整 → 在已确认范围内重新生成（新文本重新核验，不继承旧报告）。
   */
  async revise(prev: ConversationState, instruction: string): Promise<Reply> {
    const before = reqFingerprint(prev.items);
    const r = await this.message(prev, instruction);
    const s = r.state;
    const critical = reqFingerprint(s.items) !== before;
    if (critical) return r;
    // 非关键：记为表达偏好并在已确认范围内重生成
    const at = this.at();
    const s2 = clone(s);
    const turn = s2.turns.length - 1;
    const note = s2.items["styleNotes"]?.value;
    if (!note || !norm(note).includes(norm(instruction).slice(0, 12))) setItem(s2, "styleNotes", instruction.slice(0, 120), { source: USER_SRC(turn, instruction), status: "confirmed" });
    if (s2.stage === "delivered" || s2.stage === "blocked") s2.stage = "confirmed";
    s2.confirmations.forEach(() => void 0);
    const out = await this.generate(s2, { kind: "revision", reason: `表达调整：${instruction.slice(0, 40)}` });
    return out;
  }

  /* ------------------------------ 序列化 ------------------------------ */

  static restore = restoreState;
  hashOf = hash;
  scope = scopeOf;
  pick = pickDirection;
  minPoints = MIN_POINTS;
  openConflictsOf = openConflicts;
}

import { topicsIn } from "./lexicon.js";
function extractTopics(p: string) {
  return topicsIn(p);
}
