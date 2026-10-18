/**
 * 内容决策：从资料包中为已确认需求选事实、说明理由；平台规则落地为 PlatformPlan。
 * 纯函数，无 IO。
 */
import type { ContentStrategy, FactRecord, MaterialPack, Platform, PlatformPlan, ProductRef, Scenario } from "@hwpc/contracts";
import {
  PLATFORM_LABEL,
  SCENARIO_ANGLE,
  SCENARIO_CATEGORY_PRIORITY,
  SCENARIO_DEFAULTS,
  SCENARIO_LABEL,
  TOPICS,
  topicLabel,
  topicsIn,
} from "./lexicon.js";
import type { ContentDirection, ConversationState } from "./types.js";
import { hash, norm } from "./util.js";

/** 平台规则（赛题 §三（三））：结构、语气、图片数、引导全部随平台变化。 */
export const PLATFORM_PLANS: Record<Platform, PlatformPlan> = {
  wechat_article: {
    platform: "wechat_article",
    titleStyle: "信息型标题，点明人群与场景，20 字左右",
    lengthRange: { min: 600, max: 1500 },
    structure: ["标题", "导语", "分段正文（每段一个小标题）", "限制说明", "结尾行动引导"],
    tone: "专业、克制、条理清楚",
    imageCount: { min: 2, max: 4 },
    ctaStyle: "结尾引导咨询或到店了解，写明以门店资料为准",
  },
  xiaohongshu: {
    platform: "xiaohongshu",
    titleStyle: "口语化、带场景或数字的短标题",
    lengthRange: { min: 300, max: 700 },
    structure: ["场景开头", "三个短段落", "限制说明", "话题标签"],
    tone: "亲切口语，不伪造个人使用体验",
    imageCount: { min: 3, max: 6 },
    ctaStyle: "邀请收藏或到店体验，轻引导",
  },
  store_moments: {
    platform: "store_moments",
    titleStyle: "无标题或一句话开头",
    lengthRange: { min: 40, max: 160 },
    structure: ["一个核心卖点", "一句到店理由", "咨询或到店引导"],
    tone: "短句、直接、像店员的口吻",
    imageCount: { min: 1, max: 3 },
    ctaStyle: "明确的咨询或到店动作",
  },
  store_poster: {
    platform: "store_poster",
    titleStyle: "主标题加副标题，各一句",
    lengthRange: { min: 30, max: 120 },
    structure: ["主标题", "副标题", "不超过三个卖点", "活动说明（如有）"],
    tone: "极简、陈述式",
    imageCount: { min: 1, max: 1 },
    ctaStyle: "一句到店或扫码咨询提示",
  },
};

export const MAX_POINTS: Record<Platform, number> = { wechat_article: 5, xiaohongshu: 4, store_moments: 2, store_poster: 3 };
export const MIN_POINTS: Record<Platform, number> = { wechat_article: 3, xiaohongshu: 3, store_moments: 1, store_poster: 1 };

export interface Scope {
  refs: ProductRef[];
  /** 已选定配置；为空表示未指定，配置专属事实不进入内容。 */
  configurationIds: string[];
}

export function scopeOf(state: ConversationState): Scope {
  const refs = state.items["productScope"]?.refs ?? [];
  return { refs, configurationIds: refs.flatMap((r) => (r.configurationId ? [r.configurationId] : [])) };
}

export function topicsOf(value: string | undefined): string[] {
  return value ? value.split("；").flatMap((p) => topicsIn(p)) : [];
}

/** 能真正解决问题的用户决定（删去承诺/不采用冲突参数/缩小范围）。“等资料更新”不算。 */
export const RESOLVING_DECISION_RE = /不采用|排除|删去|删掉|去掉|不使用|不提|不写|不再|缩小/;
export const isResolvingDecision = (text: string) => RESOLVING_DECISION_RE.test(text);

/** 用户已决定“不采用”的冲突。 */
export function decidedConflictIds(state: ConversationState): Set<string> {
  return new Set(
    state.decisions.filter((d) => d.gapId.startsWith("conflict:") && isResolvingDecision(d.decision)).map((d) => d.gapId.slice("conflict:".length)),
  );
}

/** 未解决资料冲突涉及的事实：默认一律不进入内容（不能在冲突里挑一个值）。 */
export function conflictedFactIds(pack: MaterialPack): Set<string> {
  return new Set(pack.conflicts.filter((c) => c.status === "unresolved").flatMap((c) => c.factIds));
}

export function eligibleFacts(pack: MaterialPack, state: ConversationState, includeConflicted = false): FactRecord[] {
  const scope = scopeOf(state);
  const productIds = new Set(scope.refs.map((r) => r.productId));
  const excluded = includeConflicted ? new Set<string>() : conflictedFactIds(pack);
  const avoid = topicsOf(state.items["mustAvoid"]?.value);
  const avoidCats = new Set(TOPICS.filter((t) => avoid.includes(t.id)).flatMap((t) => t.categories));
  return pack.facts.filter((f) => {
    if (!productIds.has(f.productId)) return false;
    if (f.reviewStatus !== "verified") return false;
    if (excluded.has(f.factId)) return false;
    if (f.configurationIds.length > 0 && !f.configurationIds.some((c) => scope.configurationIds.includes(c))) return false;
    if (avoidCats.has(f.category)) return false;
    if (f.category === "price" && f.qualifiers.length === 0) return false;
    return true;
  });
}

export interface Gap {
  gapId: string;
  topic: string;
  text: string;
}

/** 用户要求强调但资料中没有依据的话题。口头确认、选择参数都不算依据。 */
export function findEvidenceGaps(pack: MaterialPack, state: ConversationState): Gap[] {
  const emph = topicsOf(state.items["mustEmphasize"]?.value);
  const facts = eligibleFacts(pack, state, true);
  const gaps: Gap[] = [];
  for (const id of new Set(emph)) {
    const t = TOPICS.find((x) => x.id === id);
    if (!t) continue;
    if (state.decisions.some((d) => d.gapId === `topic:${id}` && isResolvingDecision(d.decision))) continue;
    if (!facts.some((f) => t.categories.includes(f.category))) {
      gaps.push({ gapId: `topic:${id}`, topic: id, text: `你希望强调「${topicLabel(id)}」，但当前资料中没有可引用的${topicLabel(id)}依据` });
    }
  }
  return gaps;
}

/**
 * 阻止交付的资料冲突：所选产品范围内、尚未解决且用户未决定“不采用”的冲突。
 * 契约要求：存在 unresolved 冲突时 deliveryStatus 必须为 blocked，因此按产品范围判定。
 */
export function affectedConflicts(pack: MaterialPack, state: ConversationState): MaterialPack["conflicts"] {
  const decided = decidedConflictIds(state);
  const products = new Set(scopeOf(state).refs.map((r) => r.productId));
  return pack.conflicts.filter((c) => c.status === "unresolved" && !decided.has(c.conflictId) && products.has(c.productId));
}

export function pickDirection(pack: MaterialPack, state: ConversationState, includeConflicted = false): ContentDirection {
  const platform = (state.items["platform"]?.value ?? "wechat_article") as Platform;
  const scenario = (state.items["scenario"]?.value ?? "other") as Scenario;
  const facts = eligibleFacts(pack, state, includeConflicted);
  const emph = topicsOf(state.items["mustEmphasize"]?.value);
  const emphCats = TOPICS.filter((t) => emph.includes(t.id)).flatMap((t) => t.categories);
  const prio = SCENARIO_CATEGORY_PRIORITY[scenario] ?? SCENARIO_CATEGORY_PRIORITY.other;
  const rank = (f: FactRecord): number => {
    const e = emphCats.indexOf(f.category);
    if (e >= 0) return e;
    const p = prio.indexOf(f.category);
    return 100 + (p >= 0 ? p : 50);
  };
  const sorted = [...facts].filter((f) => f.category !== "limitation").sort((a, b) => rank(a) - rank(b) || a.factId.localeCompare(b.factId));
  const limit = MAX_POINTS[platform];
  const selected: ContentDirection["selected"] = [];
  const usedCat = new Map<string, number>();
  const excluded: ContentDirection["excluded"] = [];
  for (const f of sorted) {
    const n = usedCat.get(f.category) ?? 0;
    if (selected.length >= limit) {
      excluded.push({ factId: f.factId, reason: `${PLATFORM_LABEL[platform]}卖点数量上限为 ${limit}，不堆砌` });
      continue;
    }
    if (n >= 1 && f.category !== "selling_point") {
      excluded.push({ factId: f.factId, reason: `「${f.field}」与已选内容同类，避免重复` });
      continue;
    }
    usedCat.set(f.category, n + 1);
    const e = emphCats.includes(f.category);
    selected.push({
      factId: f.factId,
      field: f.field,
      value: f.value,
      reason: e
        ? `用户要求强调，且有资料依据（${f.source.title}）`
        : `${SCENARIO_LABEL[scenario]}场景优先关注「${f.field}」（${f.source.title}）`,
    });
  }
  const limitation = facts.find((f) => f.category === "limitation");
  if (limitation) {
    selected.push({ factId: limitation.factId, field: limitation.field, value: limitation.value, reason: "资料标明的限制条件，需如实写出" });
  }
  const scope = scopeOf(state);
  const conflicted = conflictedFactIds(pack);
  for (const f of pack.facts.filter((x) => scope.refs.some((r) => r.productId === x.productId))) {
    if (selected.some((s) => s.factId === f.factId) || excluded.some((s) => s.factId === f.factId)) continue;
    if (!includeConflicted && conflicted.has(f.factId)) {
      excluded.push({ factId: f.factId, reason: "资料存在冲突，不在内容中采用任何一侧的数值" });
    } else if (f.configurationIds.length > 0 && !f.configurationIds.some((c) => scope.configurationIds.includes(c))) {
      excluded.push({ factId: f.factId, reason: "仅适用于未选定的配置，不写入通用内容" });
    } else if (f.category === "price" && f.qualifiers.length === 0) {
      excluded.push({ factId: f.factId, reason: "价格缺少有效期/条件限定，不引用" });
    }
  }
  const emphText = emph.length ? `，并按要求突出${[...new Set(emph)].map(topicLabel).join("、")}` : "";
  return { angle: `${SCENARIO_ANGLE[scenario] ?? SCENARIO_ANGLE.other}${emphText}`, selected, excluded };
}

export const directionFingerprint = (d: ContentDirection) =>
  hash({ a: d.angle, s: d.selected.map((x) => [x.factId, norm(x.value)]), e: d.excluded.map((x) => x.factId) });

/** 内容策略（契约 ContentStrategy）。换场景→切入点与卖点顺序变；换平台→平台计划变。 */
export function buildStrategy(state: ConversationState, direction: ContentDirection): ContentStrategy {
  const it = state.items;
  const scenario = (it["scenario"]?.value ?? "other") as Scenario;
  const platform = (it["platform"]?.value ?? "wechat_article") as Platform;
  const def = SCENARIO_DEFAULTS[scenario];
  return {
    audience: it["audience"]?.value ?? "未指定",
    scenario,
    scenarioNote: scenario === "other" ? it["scenario"]?.value : undefined,
    purchaseStage: "consideration",
    userProblems: [it["problem"]?.value ?? def.problem],
    contentGoal: it["goal"]?.value ?? def.goal,
    angle: direction.angle,
    platformPlan: PLATFORM_PLANS[platform],
    sellingPointFactIds: direction.selected.map((s) => s.factId),
    rationale: [
      `面向「${it["audience"]?.value ?? "未指定"}」，场景为${SCENARIO_LABEL[scenario]}，渠道为${PLATFORM_LABEL[platform]}。`,
      `选用 ${direction.selected.length} 条事实：${direction.selected.map((s) => `${s.field}（${s.reason}）`).join("；")}。`,
      direction.excluded.length ? `未采用 ${direction.excluded.length} 条：${direction.excluded.map((e) => e.reason).slice(0, 3).join("；")}。` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
