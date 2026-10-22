/**
 * 知识库顾问引擎（AdvisorEngine 的真实实现）。
 *
 * 每一轮：
 *   1. 理解：规则词表抽取需求编辑；配置了大模型时再让模型补充（quote 必须出自原话）；
 *   2. 筛选：读取知识库全部型号的事实、官方公开价格、型号检索卡，逐条对照需求给出带证据的评价；
 *   3. 检索：按用途、软件、顾虑检索型号话术 / 常见问题 / 客户场景，作为提醒和出处；
 *   4. 追问：挑候选分歧最大的维度追问，选项按真实候选生成；
 *   5. 回复：程序拼出规则版回复；配置了大模型时改写成口语，改写过不了数字核验就用规则版。
 * 引擎不写会话、不产生确认；服务端照常校验它的每一项输出。
 */
import {
  applyNeedEdits,
  LIBRARY_SECTION_LABEL,
  type AdvisorDeps,
  type AdvisorEngine,
  type AdvisorProposal,
  type AdvisorReference,
  type AdvisorView,
  type DataService,
  type KnowledgeLibrary,
  type LibraryHit,
  type NeedEdit,
  type NeedEntry,
  type NeedKey,
  type PlanProposal,
  type ProductIdentity,
  type QuestionProposal,
} from "@hwpc/contracts";
import { assessAll, type Assessed } from "./assess.js";
import { nextQuestions } from "./ask.js";
import { extractEdits, NO_PREFERENCE, TASK_LABEL, wantsOf, type Wants } from "./lexicon.js";
import { extractWithModel, rewriteReply, type ModelResolver } from "./llm.js";
import { buildProfile, fmtKg, type ProductProfile } from "./profile.js";

export interface KbAdvisorOptions {
  library: KnowledgeLibrary;
  /** 当前可用的大模型（随系统设置变化）；返回 undefined 时只用规则。 */
  model?: ModelResolver;
  /** 型号画像缓存时长，默认 5 分钟。 */
  cacheMs?: number;
}

const shortName = (m: string) => m.replace(/^HUAWEI\s+/i, "").trim();
const TMP = "tmp-";

export const toReference = (h: LibraryHit): AdvisorReference => ({
  title: h.heading ? `${h.title} · ${h.heading}` : h.title,
  section: LIBRARY_SECTION_LABEL[h.section],
  excerpt: h.excerpt,
  locator: h.source.locator,
  ...(h.source.officialUrl ? { officialUrl: h.source.officialUrl } : {}),
});

/** 读取知识库全部型号并建立画像（带缓存）。 */
export function createCatalog(library: KnowledgeLibrary, cacheMs = 5 * 60_000) {
  let cache: { at: number; profiles: ProductProfile[] } | undefined;
  return async (data: DataService, signal?: AbortSignal): Promise<ProductProfile[]> => {
    if (cache && Date.now() - cache.at < cacheMs) return cache.profiles;
    const found = await data.searchProducts("", signal);
    const products = found.candidates.filter((p: ProductIdentity) => p.category === "pc");
    const profiles = (
      await Promise.all(
        products.map(async (product) => {
          try {
            const pack = await data.getMaterialPack({ taskId: "advisor-catalog", product: { productId: product.productId }, maxImages: 0, signal });
            const [prices, brief] = await Promise.all([library.prices(product.productId).catch(() => []), library.brief(product.productId).catch(() => undefined)]);
            return buildProfile(pack.products.find((p) => p.productId === product.productId) ?? product, pack.facts, prices, brief);
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((p): p is ProductProfile => Boolean(p));
    if (profiles.length) cache = { at: Date.now(), profiles };
    return profiles;
  };
}

/** 把本轮编辑叠加到当前需求上（与服务端同一套规则），得到评价用的条目。 */
function project(view: AdvisorView, edits: NeedEdit[], userText: string): NeedEntry[] {
  if (!edits.length) return view.entries;
  let n = 0;
  const r = applyNeedEdits({
    current: { version: view.needVersion, fingerprint: view.summary.fingerprint, criticalFingerprint: view.summary.criticalFingerprint, createdAt: new Date().toISOString(), reason: "", entries: view.entries },
    edits,
    userText,
    turn: view.recentMessages.length,
    now: new Date().toISOString(),
    reason: "预览",
    historyReason: "system_revision",
    actor: "engine",
    newEntryId: () => `${TMP}${n++}`,
  });
  return r.next.entries;
}

/** 有没有足够的信号开始筛选。 */
const hasSignal = (w: Wants) => w.tasks.size > 0 || Boolean(w.budget || w.weight || w.os || w.software || w.screen || w.pen || w.fold);

function scrubTmp(a: Assessed): Assessed {
  for (const list of [a.assessment.satisfied, a.assessment.unmet, a.assessment.compromises, a.assessment.unknowns]) {
    for (const c of list) if (c.needEntryId?.startsWith(TMP)) delete c.needEntryId;
  }
  return a;
}

const firstBit = (t: string) => t.split(/[。；]/)[0]!;

export function createKbAdvisorEngine(opts: KbAdvisorOptions): AdvisorEngine {
  const { library } = opts;
  const catalog = createCatalog(library, opts.cacheMs);

  async function retrieve(w: Wants, text: string, top: Assessed | undefined, signal?: AbortSignal) {
    const refs: LibraryHit[] = [];
    let softwareFaq: LibraryHit | undefined;
    const tasks = [...w.tasks.keys()].map((t) => TASK_LABEL[t]).join(" ");
    const concerns = w.concerns.map((c) => c.value).join(" ");
    try {
      if (w.software || w.tasks.has("game") || w.os) {
        softwareFaq = (await library.search(`${w.software?.names.join(" ") ?? ""} 专业软件能否安装 鸿蒙版与Windows版区别`, { sections: ["faq"], limit: 1, signal }))[0];
      }
      if (top) {
        const hit = (await library.search(`${tasks} ${concerns} ${text}`, { productIds: [top.profile.product.productId], productOnly: true, sections: ["role_script", "lookup", "selling"], limit: 1, signal }))[0];
        if (hit) refs.push(hit);
      }
      if (softwareFaq) refs.push(softwareFaq);
      if (tasks || concerns) {
        const hit = (await library.search(`${tasks} ${concerns} ${text}`, { sections: ["scenario", "faq"], limit: 1, signal }))[0];
        if (hit && !refs.some((r) => r.chunkId === hit.chunkId)) refs.push(hit);
      }
    } catch {
      /* 检索失败不影响筛选，只是少了提醒 */
    }
    return { refs, softwareFaq };
  }

  async function turn(view: AdvisorView, edits: NeedEdit[], userText: string, deps: AdvisorDeps, lead: string): Promise<AdvisorProposal> {
    const model = opts.model?.();
    if (model && userText.trim()) {
      const extra = await extractWithModel(model, userText, edits, deps.signal);
      if (extra.length) deps.emit({ type: "model_understanding", message: `大模型补充理解 ${extra.length} 项需求` });
      edits = [...edits, ...extra];
    }
    const entries = project(view, edits, userText);
    const w = wantsOf(entries);
    const profiles = await catalog(deps.data, deps.signal);
    deps.emit({ type: "kb_catalog", message: `读取知识库型号 ${profiles.length} 款` });

    const signal = hasSignal(w);
    const { ranked } = await rankWith(entries, profiles, view, w, userText, deps);
    const fitting = ranked.filter((a) => a.assessment.overall !== "not_fit");
    const shown = signal ? (fitting.length ? fitting : ranked).slice(0, 3).map(scrubTmp) : [];
    const { refs } = await retrieve(w, userText, shown[0], deps.signal);
    if (refs.length) deps.emit({ type: "kb_search", message: `检索知识库 ${refs.length} 条：${refs.map((r) => r.title).join("；").slice(0, 120)}` });

    const questions = nextQuestions(w, ranked, { ...view, entries });
    const ruleReply = composeReply({ edits, lead, w, ranked: signal ? ranked : [], shown, refs, questions, total: profiles.length, confirmed: view.confirmed });

    let reply = ruleReply;
    if (model) {
      const r = await rewriteReply(
        model,
        {
          userText,
          needs: entries.map((e) => `${e.key}：${e.value}`),
          candidates: shown.map((a) => ({ name: a.profile.product.model, overall: a.assessment.overall, satisfied: a.assessment.satisfied.map((c) => c.text), compromises: a.assessment.compromises.map((c) => c.text), unknowns: a.assessment.unknowns.map((c) => c.text) })),
          references: refs.map((h) => ({ title: h.title, excerpt: h.excerpt })),
          nextQuestion: questions[0]?.prompt,
          ruleReply,
        },
        ruleReply,
        deps.signal,
      );
      deps.emit({ type: r.used ? "model_reply" : "model_reply_rejected", message: r.used ? "大模型改写回复（已通过数字核验）" : `未采用大模型改写：${r.error ?? "未知原因"}` });
      reply = r.text;
    }

    return {
      reply,
      needEdits: edits,
      questions,
      ...(signal ? { candidates: shown.map((a) => a.assessment) } : {}),
      suggestedScenes: [],
      references: refs.slice(0, 3).map(toReference),
    };
  }

  async function rankWith(entries: NeedEntry[], profiles: ProductProfile[], view: AdvisorView, w: Wants, text: string, deps: AdvisorDeps) {
    const { softwareFaq } = w.software || w.tasks.has("game") ? await retrieve(w, text, undefined, deps.signal) : { softwareFaq: undefined };
    const ranked = assessAll(entries, profiles, { needVersion: view.needVersion, rejected: view.rejectedProductIds, ...(softwareFaq ? { softwareFaq } : {}), origin: "local" });
    return { ranked };
  }

  return {
    isMock: false,

    async respond(view, userText, deps) {
      return turn(view, extractEdits(userText), userText, deps, "");
    },

    async answer(view, answers, deps) {
      const edits: NeedEdit[] = [];
      for (const a of answers) {
        const q = view.openQuestions.find((x) => x.questionId === a.questionId);
        const got = extractEdits(a.answer);
        edits.push(...got);
        const key = (q?.targetKeys[0] ?? "preferences") as NeedKey;
        // 回答里一项都没听出来时，才把原话整体记到这个问题对应的维度上
        if (!got.length) {
          const value = NO_PREFERENCE.test(a.answer.trim()) ? `${q?.prompt.replace(/[？?]$/, "") ?? "这一项"}：没有特别要求` : a.answer.trim();
          edits.push({ op: "set", key, value: value.slice(0, 200), status: "known", quote: a.answer.trim() });
        }
      }
      return turn(view, edits, answers.map((a) => a.answer).join("；"), deps, "");
    },

    async interpretFeedback(view, fb, deps) {
      let edits = extractEdits(fb.text);
      if (!edits.length && (fb.kind === "new_need" || fb.kind === "change_need")) edits = [{ op: "set", key: "preferences", value: fb.text.slice(0, 80), status: "known", quote: fb.text.slice(0, 80) }];
      if (!edits.length && fb.kind === "concern") edits = [{ op: "set", key: "concerns", value: fb.text.slice(0, 80), status: "known", quote: fb.text.slice(0, 80) }];
      return turn(view, edits, fb.text, deps, "收到你的反馈，按它重新对照了一遍。");
    },

    async composePlan(view, deps): Promise<PlanProposal> {
      const profiles = await catalog(deps.data, deps.signal);
      const w = wantsOf(view.entries);
      const { ranked } = await rankWith(view.entries, profiles, view, w, "", deps);
      const fitting = ranked.filter((a) => a.assessment.overall === "fits" || a.assessment.overall === "fits_with_compromise");
      const primary = fitting[0];
      const chosen = [...(primary ? [primary] : []), ...ranked.filter((a) => a !== primary && a.assessment.overall !== "not_fit")].slice(0, 3);
      if (chosen.length < 2) chosen.push(...ranked.filter((a) => !chosen.includes(a)).slice(0, 2 - chosen.length));
      deps.emit({ type: "kb_plan", message: `按知识库对照 ${profiles.length} 款，方案纳入 ${chosen.length} 款` });

      const byCandidate = chosen.map((a) => ({
        candidateId: a.assessment.candidateId,
        role: (a === primary ? "recommended" : a.assessment.overall === "not_fit" ? "not_recommended" : "alternative") as "recommended" | "alternative" | "not_recommended",
        reason: a === primary ? a.assessment.comparisonReason : primary && a.assessment.overall !== "not_fit" ? `${a.assessment.comparisonReason}${versus(a.profile, primary.profile)}` : a.assessment.comparisonReason,
      }));

      const unresolved: QuestionProposal[] = [];
      if (w.software && primary?.assessment.unknowns.some((u) => u.criterionId === "software")) {
        unresolved.push({ kind: "gap", prompt: `${w.software.names.join("、")} 能否在首选机型上使用`, reason: "资料无法替软件厂商下结论，到店请带上安装包或账号实机核对", targetKeys: ["requiredSoftware"], allowFreeText: true });
      }
      if (!w.budget) unresolved.push({ kind: "preference", prompt: "预算还没说", reason: "会影响最终配置的取舍", targetKeys: ["budget"], allowFreeText: true });

      return {
        candidates: chosen.map((a) => scrubTmp(a).assessment),
        recommendation: {
          ...(primary ? { primary: primary.assessment.product } : {}),
          byCandidate,
          ...(primary ? {} : { noRecommendationReason: `按你确认的需求，知识库里没有能满足全部关键条件的型号：${ranked[0]?.assessment.comparisonReason ?? "资料不足"}` }),
        },
        scenes: [],
        unresolvedQuestions: unresolved,
      };
    },
  };
}

/** 备选与首选相比的差别，只用两边的原始数值，不做推算。 */
function versus(alt: ProductProfile, primary: ProductProfile): string {
  const bits: string[] = [];
  if (alt.price && primary.price && alt.price.from !== primary.price.from) {
    bits.push(`${alt.price.record.priceType} ${alt.price.from} 元起（首选 ${primary.price.from} 元起）`);
  }
  if (alt.weightKg && primary.weightKg && Math.abs(alt.weightKg.max - primary.weightKg.max) >= 0.08) {
    bits.push(`重量 ${fmtKg(alt.weightKg.max)}（首选 ${fmtKg(primary.weightKg.max)}）`);
  }
  if (alt.screenIn && primary.screenIn && alt.screenIn.value !== primary.screenIn.value) bits.push(`屏幕 ${alt.screenIn.value} 英寸（首选 ${primary.screenIn.value} 英寸）`);
  const osName = (p: ProductProfile) => (p.os.has("harmony") ? "鸿蒙" : p.os.has("windows") ? "Windows" : "");
  if (osName(alt) && osName(alt) !== osName(primary)) bits.push(`${osName(alt)}系统`);
  return bits.length ? `。和首选比：${bits.slice(0, 3).join("；")}` : "";
}

interface ReplyInput {
  edits: NeedEdit[];
  lead: string;
  w: Wants;
  ranked: Assessed[];
  shown: Assessed[];
  refs: LibraryHit[];
  questions: QuestionProposal[];
  total: number;
  confirmed: boolean;
}

export function composeReply(r: ReplyInput): string {
  const lines: string[] = [];
  if (r.lead) lines.push(r.lead);
  const noted = r.edits.filter((e): e is Extract<NeedEdit, { op: "set" }> => e.op === "set").map((e) => e.value);
  if (noted.length) lines.push(`记下了：${[...new Set(noted)].join("；")}。`);
  else if (!r.lead) lines.push("这句话里我没听出新的选购条件，可以说说用途、预算，或者平时带不带出门。");

  if (r.shown.length) {
    const fit = r.shown.filter((a) => a.assessment.overall !== "not_fit");
    if (fit.length) {
      lines.push(`对照知识库里的 ${r.total} 款华为笔记本，目前更合适的是：`);
      for (const a of fit) {
        const good = a.assessment.satisfied.filter((c) => !c.criterionId.startsWith("brief-")).slice(0, 2).map((c) => firstBit(c.text));
        const watch = [...a.assessment.compromises, ...a.assessment.unknowns].slice(0, 1).map((c) => firstBit(c.text));
        lines.push(`· ${shortName(a.profile.product.model)}：${good.join("；") || "资料里暂无与你需求直接对应的依据"}${watch.length ? `（留意：${watch[0]}）` : ""}`);
      }
    } else {
      const best = r.shown[0]!;
      lines.push(`按你说的条件，知识库里暂时没有完全符合的型号；最接近的是 ${shortName(best.profile.product.model)}：${best.assessment.comparisonReason}。`);
    }
    const out = r.ranked.filter((a) => a.assessment.overall === "not_fit" && !r.shown.includes(a));
    if (out.length && fit.length) {
      const ex = out[0]!;
      lines.push(`另有 ${out.length} 款先放一边，比如 ${shortName(ex.profile.product.model)}：${firstBit(ex.assessment.unmet[0]?.text ?? ex.assessment.comparisonReason)}。`);
    }
  }

  const tip = r.refs[0];
  if (tip) lines.push(`资料提醒（${tip.title}）：${tip.excerpt.slice(0, 90)}${tip.excerpt.length > 90 ? "…" : ""}`);

  if (r.questions.length) lines.push(r.questions[0]!.prompt);
  else if (r.shown.length && !r.confirmed) lines.push("信息差不多了。右侧核对一下需求要点，确认后我按知识库为你生成体验页。");
  return lines.join("\n");
}
