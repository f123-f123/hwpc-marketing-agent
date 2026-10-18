/**
 * 规划：跨字段矛盾、默认值、问题对账与生成、下一步动作决策。
 * 纯函数（对 state 就地修改，不做 IO）。
 */
import {
  FORMAT_LABEL,
  PLATFORM_LABEL,
  SCENARIO_DEFAULTS,
  SCENARIO_LABEL,
  topicLabel,
} from "./lexicon.js";
import {
  closeConflict,
  KEY_LABEL,
  openConflict,
  openConflicts,
  setItem,
} from "./state.js";
import { affectedConflicts, findEvidenceGaps, isResolvingDecision, topicsOf } from "./strategy.js";
import type { Scenario } from "@hwpc/contracts";
import type { Candidate, ConversationState, NextAction, Question, ReqKey } from "./types.js";
import { latestEvidence } from "./retrieval.js";
import { norm } from "./util.js";

/* ------------------------------ 跨字段矛盾 ------------------------------ */

const STUDENT_AUDIENCE = /学生|新生/;
const INCOMPATIBLE: { ruleId: string; audience: RegExp; scenarios: Scenario[] }[] = [
  { ruleId: "R3-student-vs-enterprise", audience: STUDENT_AUDIENCE, scenarios: ["enterprise_procurement", "business_office"] },
  { ruleId: "R3-enterprise-vs-student", audience: /采购|企业/, scenarios: ["back_to_school"] },
];

/** 重新计算派生矛盾：规则仍成立则保持/新开，不再成立则自动关闭。 */
export function syncCrossConflicts(s: ConversationState, turn: number) {
  const emph = topicsOf(s.items["mustEmphasize"]?.value);
  const avoid = topicsOf(s.items["mustAvoid"]?.value);
  const holds = new Map<string, { keys: ReqKey[]; options: { value: string; label: string }[]; description: string }>();

  const both = emph.filter((t) => avoid.includes(t));
  if (both.length) {
    const t = topicLabel(both[0]!);
    holds.set("R1-emphasize-vs-avoid", {
      keys: ["mustEmphasize", "mustAvoid"],
      options: [
        { value: "keep:mustEmphasize", label: `保留「强调${t}」，去掉「避免${t}」` },
        { value: "keep:mustAvoid", label: `保留「避免${t}」，不再强调` },
      ],
      description: `「${t}」同时被要求强调和避免`,
    });
  }
  const noAct = s.items["activity"] && /不涉及活动/.test(s.items["activity"].value);
  if (noAct && emph.includes("price")) {
    holds.set("R2-no-activity-vs-price", {
      keys: ["activity", "mustEmphasize"],
      options: [
        { value: "keep:activity", label: "不涉及活动，不强调价格/优惠" },
        { value: "keep:mustEmphasize", label: "需要强调价格/优惠（请说明活动信息来源）" },
      ],
      description: "「不涉及活动」与「强调价格/优惠」相互矛盾",
    });
  }
  const aud = s.items["audience"];
  const sc = s.items["scenario"];
  if (aud?.source.kind === "user" && sc?.source.kind === "user" && aud.status !== "conflict" && sc.status !== "conflict") {
    for (const r of INCOMPATIBLE) {
      if (r.audience.test(aud.value) && r.scenarios.includes(sc.value as Scenario)) {
        holds.set(r.ruleId, {
          keys: ["audience", "scenario"],
          options: [
            { value: "keep:audience", label: `保留人群「${aud.value}」，场景由我重新选` },
            { value: "keep:scenario", label: `保留场景「${SCENARIO_LABEL[sc.value as Scenario] ?? sc.value}」，人群需调整` },
          ],
          description: `人群「${aud.value}」与场景「${SCENARIO_LABEL[sc.value as Scenario] ?? sc.value}」通常不匹配`,
        });
      }
    }
  }

  for (const [ruleId, h] of holds) {
    openConflict(s, { kind: "cross_field", keys: h.keys, ruleId, options: h.options, description: h.description, turn });
  }
  for (const c of s.conflicts) {
    if (c.status === "open" && c.kind === "cross_field" && c.ruleId && !holds.has(c.ruleId)) closeConflict(c, "已不再矛盾", turn);
    if (c.status === "open" && c.kind === "value_clash" && c.keys.every((k) => s.items[k] && s.items[k]!.status !== "conflict")) closeConflict(c, "已明确", turn);
  }
}

/** 解决跨字段矛盾：保留一侧，另一侧相关部分移除（旧值进入历史）。 */
export function resolveCrossConflict(s: ConversationState, conflictId: string, keep: ReqKey, turn: number): boolean {
  const c = s.conflicts.find((x) => x.conflictId === conflictId && x.status === "open");
  if (!c || c.kind !== "cross_field") return false;
  const drop = c.keys.find((k) => k !== keep);
  if (!drop) return false;
  const it = s.items[drop];
  if (it) {
    const t = c.ruleId === "R1-emphasize-vs-avoid" || c.ruleId === "R2-no-activity-vs-price" ? topicsOf(s.items[keep]?.value) : [];
    if (drop === "mustEmphasize" || drop === "mustAvoid") {
      const parts = it.value.split("；").filter((p) => !(topicsOf(p).some((x) => t.includes(x) || c.ruleId === "R2-no-activity-vs-price" && x === "price")));
      it.history.push({ value: it.value, source: it.source, replacedAtTurn: turn, replacedAtVersion: s.requirementVersion, reason: "conflict_resolution" });
      if (parts.length) it.value = parts.join("；");
      else delete s.items[drop];
    } else {
      it.history.push({ value: it.value, source: it.source, replacedAtTurn: turn, replacedAtVersion: s.requirementVersion, reason: "conflict_resolution" });
      if (drop === "audience" || drop === "scenario") delete s.items[drop];
      else delete s.items[drop];
    }
  }
  closeConflict(c, `用户选择保留「${KEY_LABEL[keep]}」`, turn);
  return true;
}

/* ------------------------------ 默认值 ------------------------------ */

/** 只为“非阻塞”项补默认；默认值是 system/default 来源，不是用户确认，并在摘要中披露。 */
export function applyDefaults(s: ConversationState, turn: number) {
  const sc = s.items["scenario"];
  const scenario = (sc?.value ?? "other") as Scenario;
  const def = SCENARIO_DEFAULTS[scenario];
  if (sc && sc.status !== "conflict") {
    const p = s.items["problem"];
    const g = s.items["goal"];
    if (!p || p.source.kind === "default") setItem(s, "problem", def.problem, { source: { kind: "default", turn, note: `按「${SCENARIO_LABEL[scenario] ?? scenario}」场景的常见问题` }, status: "tentative" });
    if (!g || g.source.kind === "default") setItem(s, "goal", def.goal, { source: { kind: "default", turn, note: `按「${SCENARIO_LABEL[scenario] ?? scenario}」场景的常见目标` }, status: "tentative" });
  }
  if (!s.items["deliveryFormat"] && s.items["platform"]) {
    setItem(s, "deliveryFormat", "platform_article", { source: { kind: "default", turn, note: "未提到互动页面，默认只交付平台图文" }, status: "tentative" });
  }
  if (!s.items["activity"] && s.items["platform"] && s.items["audience"]) {
    // 不强迫填写无关项：不写入 activity，摘要里说明“未提及活动，内容不涉及活动/价格/优惠”。
  }
}

/* ------------------------------ 问题 ------------------------------ */

const hasItem = (s: ConversationState, k: ReqKey) => Boolean(s.items[k]) && s.items[k]!.status !== "conflict";

function questionResolved(s: ConversationState, q: Question): boolean {
  switch (q.kind) {
    case "preference":
    case "quantify":
      return q.targetKeys.every((k) => hasItem(s, k));
    case "choose_candidate":
      return Boolean(s.items["productScope"]?.refs?.length);
    case "choose_config": {
      const id = q.questionId.replace(/^q-config-?/, "");
      const ref = s.items["productScope"]?.refs?.find((r) => r.productId === id || !id);
      return Boolean(ref?.configurationId) || s.decisions.some((d) => d.gapId === `config:${ref?.productId ?? id}`);
    }
    case "clarify_conflict": {
      const id = q.questionId.replace(/^q-conflict-/, "").replace(/-r\d+$/, "");
      return s.conflicts.find((c) => c.conflictId === id)?.status !== "open";
    }
    case "gap_handling": {
      const gid = q.questionId.replace(/^q-gap-/, "").replace(/-r\d+$/, "");
      return s.decisions.some((d) => d.gapId === gid && isResolvingDecision(d.decision));
    }
  }
}

/** 把“已有答案/已解决”的问题标记为 answered；条件不再成立的标记 superseded。 */
export function reconcileQuestions(s: ConversationState, turn: number) {
  for (const q of s.questions) {
    if (q.status !== "open") continue;
    if (questionResolved(s, q)) {
      q.status = "answered";
      q.answeredTurn = q.answeredTurn ?? turn;
    }
  }
}

const hasQuestion = (s: ConversationState, id: string) => s.questions.some((q) => q.questionId === id || q.questionId.startsWith(`${id}-r`));
const askedCount = (s: ConversationState, id: string) => s.questions.filter((q) => q.questionId === id || q.questionId.startsWith(`${id}-r`)).length;

type NewQuestion = Omit<Question, "status" | "askedTurn" | "owner" | "allowFreeText" | "affects" | "impactNote" | "blocking"> & { affects?: Question["affects"]; impactNote?: string; blocking?: boolean };

function add(s: ConversationState, q: NewQuestion, turn: number): Question | undefined {
  // 同一编号已存在且仍开放：不重复；已回答：不重复；回答后目标仍缺失：最多换一种问法再问 1 次。
  const base = q.questionId;
  const existing = s.questions.filter((x) => x.questionId === base || x.questionId.startsWith(`${base}-r`));
  if (existing.some((x) => x.status === "open")) return undefined;
  if (existing.length >= 2) return undefined;
  const id = existing.length ? `${base}-r${existing.length + 1}` : base;
  const full: Question = { ...q, affects: q.affects ?? [], blocking: q.blocking ?? true, questionId: id, owner: "user", allowFreeText: true, status: "open", askedTurn: turn };
  s.questions.push(full);
  return full;
}

function differentiator(cands: Candidate[]): string | undefined {
  const loaded = cands.filter((c) => c.highlights.length);
  if (loaded.length < 2) return undefined;
  const cats = new Map<string, Set<string>>();
  for (const c of loaded) for (const h of c.highlights) (cats.get(h.category) ?? cats.set(h.category, new Set()).get(h.category)!).add(norm(h.value));
  for (const [cat, vals] of cats) if (vals.size >= 2) return loaded.flatMap((c) => c.highlights).find((h) => h.category === cat)?.field;
  return undefined;
}

/** 生成本轮应问的问题（最多 3 个，按对方向影响排序）。 */
export function planQuestions(s: ConversationState, turn: number): Question[] {
  const out: Question[] = [];
  const open = () => s.questions.filter((q) => q.status === "open");
  const push = (q: Question | undefined) => q && out.push(q);

  // 1) 矛盾
  for (const c of openConflicts(s)) {
    push(
      add(
        s,
        {
          questionId: `q-conflict-${c.conflictId}`,
          kind: "clarify_conflict",
          targetKeys: c.keys,
          prompt: `${c.description}。以哪一个为准？`,
          reason: "前后表达不一致，会改变内容方向，需要你来定",
          resolveWhen: "你选定其中一个（或补充新的说法）",
          options: c.options.map((o) => ({ value: o.value, label: o.label })),
          priority: 0,
        },
        turn,
      ),
    );
  }

  // 2) 资料缺口 / 冲突的处理
  const ev = latestEvidence(s);
  if (ev?.pack) {
    for (const g of findEvidenceGaps(ev.pack, s)) {
      push(
        add(
          s,
          {
            questionId: `q-gap-${g.gapId}`,
            kind: "gap_handling",
            targetKeys: ["mustEmphasize"],
            prompt: `${g.text}。怎么处理？`,
            reason: "没有资料依据的内容不能写进作品；你口头确认也不能替代资料来源",
            resolveWhen: "选择删去该强调点，或缩小范围",
            options: [
              { value: "drop", label: `删去「${topicLabel(g.topic)}」相关强调` },
              { value: "narrow", label: "缩小范围：只写资料里有依据的部分" },
              { value: "wait", label: "先不生成，等资料补充后再继续" },
            ],
            priority: 0.5,
          },
          turn,
        ),
      );
    }
    for (const c of affectedConflicts(ev.pack, s)) {
      push(
        add(
          s,
          {
            questionId: `q-gap-conflict:${c.conflictId}`,
            kind: "gap_handling",
            targetKeys: ["productScope"],
            prompt: `资料对「${c.field}」存在冲突：${c.description}。怎么处理？`,
            reason: "两处资料互相矛盾，不能挑一个写；这项会影响交付",
            resolveWhen: "选择不采用冲突内容，或等资料更正",
            options: [
              { value: "exclude", label: `两侧「${c.field}」都不采用，从内容中排除` },
              { value: "wait", label: "先不生成，等资料更正后再继续" },
            ],
            priority: 0.5,
          },
          turn,
        ),
      );
    }
  }

  // 3) 产品
  const scope = s.items["productScope"];
  const hasRefs = Boolean(scope?.refs?.length);
  const openCands = s.candidates.filter((c) => c.status === "open");
  if (!hasRefs) {
    if (openCands.length >= 2) {
      const dim = differentiator(openCands);
      push(
        add(
          s,
          {
            questionId: "q-product",
            kind: "choose_candidate",
            targetKeys: ["productScope"],
            prompt: dim ? `按你目前的需求，资料里有 ${openCands.length} 款可选，它们在「${dim}」上不一样。你更倾向哪一款？` : `资料里有 ${openCands.length} 款可选，你更倾向哪一款？`,
            reason: "产品范围会改变事实与图片，需要你来选",
            resolveWhen: "选定一款（或说明新的型号）",
            options: [
              ...openCands.map((c) => ({
                value: c.productId,
                label: c.model,
                hint: c.highlights.map((h) => `${h.field}：${h.value}`).join("；") || undefined,
              })),
              { value: "none", label: "都不是，我再说明" },
            ],
            priority: 1,
          },
          turn,
        ),
      );
    } else if (openCands.length === 1) {
      const c = openCands[0]!;
      push(
        add(
          s,
          {
            questionId: "q-product",
            kind: "choose_candidate",
            targetKeys: ["productScope"],
            prompt: `按目前的需求，资料里只检索到「${c.model}」。就用这一款吗？`,
            reason: "只有一款匹配，需要你确认是否采用",
            resolveWhen: "确认采用，或说明其他型号",
            options: [
              { value: c.productId, label: `用「${c.model}」`, hint: c.highlights.map((h) => `${h.field}：${h.value}`).join("；") || undefined },
              { value: "none", label: "不用，我再说明" },
            ],
            priority: 1,
          },
          turn,
        ),
      );
    } else if (!scope && !s.productMentions.length) {
      push(
        add(
          s,
          {
            questionId: "q-product",
            kind: "preference",
            targetKeys: ["productScope"],
            prompt: "想写哪款产品，或哪一类产品（比如轻薄本）？",
            reason: "产品范围决定要检索哪些资料",
            resolveWhen: "给出型号或品类",
            priority: 1,
          },
          turn,
        ),
      );
    } else if (scope && !openCands.length && (s.searchLog.length > 0)) {
      push(
        add(
          s,
          {
            questionId: "q-product-narrow",
            kind: "preference",
            targetKeys: ["productScope"],
            prompt: `资料里没有检索到与「${scope.value}」匹配的产品。有想了解的系列或型号吗？`,
            reason: "检索没有命中，需要更具体的线索",
            resolveWhen: "给出型号或系列",
            priority: 1,
          },
          turn,
        ),
      );
    }
  } else {
    for (const ref of scope!.refs!) {
      const cand = s.candidates.find((c) => c.productId === ref.productId);
      const decided = s.decisions.some((d) => d.gapId === `config:${ref.productId}`);
      if (!ref.configurationId && !decided && cand && cand.configurations.length > 1 && cand.configRequired) {
        push(
          add(
            s,
            {
              questionId: `q-config-${ref.productId}`,
              kind: "choose_config",
              targetKeys: ["productScope"],
              prompt: `「${cand.model}」有多个配置，要写哪一个？`,
              reason: "不同配置的参数不同，选定后才能避免写错",
              resolveWhen: "选定配置，或选择只写各配置通用的信息",
              options: [
                ...cand.configurations.map((c) => ({ value: c.configurationId, label: c.label, hint: Object.entries(c.attributes).map(([k, v]) => `${k}：${v}`).join("；") || undefined })),
                { value: "any", label: "不限定配置，只写通用信息" },
              ],
              priority: 1.5,
            },
            turn,
          ),
        );
      }
    }
  }

  // 4) 人群 / 场景
  if (!hasItem(s, "audience") && !hasItem(s, "scenario")) {
    push(
      add(
        s,
        {
          questionId: "q-audience",
          kind: "preference",
          targetKeys: ["audience", "scenario"],
          prompt: "这篇内容主要写给谁？在什么场景下用？",
          reason: "人群和场景决定内容切入点和卖点顺序",
          resolveWhen: "说明人群，或场景（一句话即可）",
          options: [
            { value: "大学新生，开学季", label: "大学新生 · 开学季" },
            { value: "经常出差的职场人，职场办公", label: "出差职场人 · 办公" },
            { value: "内容创作者，内容创作", label: "创作者 · 创作" },
            { value: "家庭用户，家庭换新", label: "家庭用户 · 换新" },
          ],
          priority: 2,
        },
        turn,
      ),
    );
  } else if (!hasItem(s, "audience")) {
    push(add(s, { questionId: "q-audience", kind: "preference", targetKeys: ["audience"], prompt: "这篇内容主要写给谁？", reason: "人群决定语气与卖点取舍", resolveWhen: "说明目标人群", priority: 2 }, turn));
  } else if (!hasItem(s, "scenario")) {
    push(add(s, { questionId: "q-scenario", kind: "preference", targetKeys: ["scenario"], prompt: `写给「${s.items["audience"]!.value}」，主要在什么场景下使用？`, reason: "场景决定内容切入点", resolveWhen: "说明使用场景", priority: 3 }, turn));
  }

  // 5) 渠道
  if (!hasItem(s, "platform")) {
    push(
      add(
        s,
        {
          questionId: "q-platform",
          kind: "preference",
          targetKeys: ["platform"],
          prompt: "准备发布在哪个渠道？",
          reason: "渠道决定结构、语气、配图数量与行动引导",
          resolveWhen: "选一个渠道",
          options: (Object.keys(PLATFORM_LABEL) as (keyof typeof PLATFORM_LABEL)[]).map((p) => ({ value: p, label: PLATFORM_LABEL[p] })),
          priority: 4,
        },
        turn,
      ),
    );
  }

  // 6) 场景未知时才追问问题/目标
  if (!s.items["scenario"] || s.items["scenario"]!.value === "other") {
    if (hasItem(s, "audience") && !hasItem(s, "problem")) {
      push(add(s, { questionId: "q-problem", kind: "preference", targetKeys: ["problem"], prompt: "这位读者最想解决的问题是什么？", reason: "没有现成场景可参考，需要你说明", resolveWhen: "一句话描述", priority: 6 }, turn));
    }
  }

  void open;
  void hasQuestion;
  void askedCount;
  return out.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

/* ------------------------------ 下一步动作 ------------------------------ */

export function pendingOpenQuestions(s: ConversationState): Question[] {
  return s.questions.filter((q) => q.status === "open").sort((a, b) => a.priority - b.priority);
}

export function decideNext(s: ConversationState): NextAction {
  const open = pendingOpenQuestions(s).slice(0, 3);
  const ev = latestEvidence(s);
  if (open.length) {
    const gapQs = open.filter((q) => q.kind === "gap_handling");
    if (gapQs.length && ev?.pack) {
      const conflicts = affectedConflicts(ev.pack, s);
      if (conflicts.length) {
        return { type: "resolve_material_conflict", conflictIds: conflicts.map((c) => c.conflictId), paths: ["排除冲突内容后继续", "等待资料更正"] };
      }
      return { type: "discuss_evidence_gap", gaps: findEvidenceGaps(ev.pack, s).map((g) => g.text), paths: ["删去相关强调", "缩小范围", "补充资料后再继续"] };
    }
    return { type: "ask_user", questionIds: open.map((q) => q.questionId) };
  }
  return { type: "blocked", reason: "没有待问问题，也没有可确认的摘要" };
}

export { FORMAT_LABEL };
