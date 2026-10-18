/**
 * 需求理解：把用户一段自由表达映射为多个需求项的变更（不依赖机械选项映射）。
 * 规则抽取是基础（可测试、无模型也能工作）；模型只做补充，且：
 *  - 模型输出经严格 schema 解析，任何 confirmed / confirmation 字段被丢弃并记审计；
 *  - 模型给出的值只有在其 quote 确实出现在用户原话中时才算“用户表达”，否则只是系统建议。
 */
import { z } from "zod";
import type { Platform, Scenario } from "@hwpc/contracts";
import {
  AUDIENCE_PATTERNS,
  CATEGORY_RE,
  CHANGE_CUE_RE,
  CONFIRM_TEXT_RE,
  DELEGATE_CUE_RE,
  FACT_QUESTION_TOPICS,
  MODEL_MENTION_RE,
  NO_ACTIVITY_RE,
  NO_EXTRA_RE,
  PLATFORM_LABEL,
  PLATFORM_PATTERNS,
  QUESTION_MARK_RE,
  SCENARIO_LABEL,
  SCENARIO_PATTERNS,
  topicsIn,
} from "./lexicon.js";
import { ReqKeySchema, type DeliveryFormat, type ReqKey } from "./types.js";

export interface Extraction {
  sets: { key: ReqKey; value: string; explicit: boolean; quote: string; inferred?: boolean }[];
  removals: { key: ReqKey; part: string }[];
  productMentions: string[];
  categoryScope?: string;
  claims: { kind: "price" | "spec"; text: string }[];
  factQuestions: { text: string; categories: string[] }[];
  delegated: boolean;
  confirmTextAttempt: boolean;
  /** 同一句里出现多个不同渠道/场景 → 需要澄清而非擅自择一。 */
  multi: { key: "platform" | "scenario"; values: string[] }[];
}

const SPLIT_RE = /[，,。；;！!？?\n]/;

/** 取“不要/避免/强调”之后的短语（到标点或转折）。 */
function phraseAfter(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const tail = text.slice((m.index ?? 0) + m[0].length);
    const phrase = tail.split(SPLIT_RE)[0]?.split(/但|不过|然而|而且|并且|同时/)[0]?.trim();
    if (phrase && phrase.length <= 24) out.push(phrase.replace(/^(?:一下|出|写|讲|说)/, "").trim() || phrase);
  }
  return out;
}

export function extract(text: string, opts: { targetKeys?: ReqKey[]; answerValue?: string } = {}): Extraction {
  const t = text.trim();
  const ex: Extraction = { sets: [], removals: [], productMentions: [], claims: [], factQuestions: [], delegated: false, confirmTextAttempt: false, multi: [] };
  if (!t) return ex;
  const changeCue = CHANGE_CUE_RE.test(t);
  const targeted = (k: ReqKey) => Boolean(opts.targetKeys?.includes(k));
  ex.confirmTextAttempt = CONFIRM_TEXT_RE.test(t);
  ex.delegated = DELEGATE_CUE_RE.test(t);

  // 渠道
  const platforms = PLATFORM_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
  if (platforms.length === 1) ex.sets.push({ key: "platform", value: platforms[0] as Platform, explicit: changeCue || targeted("platform"), quote: t });
  else if (platforms.length > 1) {
    // “改成小红书，不是公众号”这类取肯定一侧；否则让用户选。
    const neg = platforms.filter((p) => new RegExp(`(?:不是|不要|不用|别)[^，。；]{0,4}${PLATFORM_PATTERNS.find((x) => x.id === p)!.re.source}`).test(t));
    const pos = platforms.filter((p) => !neg.includes(p));
    if (pos.length === 1) ex.sets.push({ key: "platform", value: pos[0] as Platform, explicit: true, quote: t });
    else ex.multi.push({ key: "platform", values: platforms });
  }

  // 场景
  const sc = SCENARIO_PATTERNS.map((p) => ({ id: p.id, n: [...t.matchAll(new RegExp(p.re.source, "g"))].length })).filter((x) => x.n > 0);
  if (sc.length) {
    sc.sort((a, b) => b.n - a.n);
    const top = sc[0]!;
    if (sc.length > 1 && sc[1]!.n === top.n && !targeted("scenario")) ex.multi.push({ key: "scenario", values: sc.map((x) => x.id) });
    else ex.sets.push({ key: "scenario", value: top.id as Scenario, explicit: changeCue || targeted("scenario"), quote: t });
  }

  // 人群
  for (const a of AUDIENCE_PATTERNS) {
    if (a.re.test(t)) {
      ex.sets.push({ key: "audience", value: a.value, explicit: changeCue || targeted("audience"), quote: t });
      if (a.impliesScenario && !sc.length) ex.sets.push({ key: "scenario", value: a.impliesScenario, explicit: false, quote: t, inferred: true });
      break;
    }
  }
  if (targeted("audience") && !ex.sets.some((s) => s.key === "audience") && opts.answerValue && opts.answerValue.length <= 30 && !ex.delegated) {
    ex.sets.push({ key: "audience", value: opts.answerValue, explicit: true, quote: t });
  }

  // 交付形式
  const wantsHtml = /互动|HTML|html|H5|h5|可交互|小游戏|测一测|交互页|网页/.test(t);
  const wantsArticle = /图文|软文|文章|笔记|文案|推文/.test(t);
  if (/只要.{0,3}(?:图文|文章)|不要.{0,4}(?:互动|HTML|html|H5)|不用.{0,4}(?:互动|HTML|html|H5)/.test(t)) {
    ex.sets.push({ key: "deliveryFormat", value: "platform_article" satisfies DeliveryFormat, explicit: true, quote: t });
  } else if (wantsHtml && (wantsArticle || /组合|配套|搭配|同时|再加|加上/.test(t))) {
    ex.sets.push({ key: "deliveryFormat", value: "combo" satisfies DeliveryFormat, explicit: changeCue || targeted("deliveryFormat"), quote: t });
  } else if (wantsHtml) {
    ex.sets.push({ key: "deliveryFormat", value: "interactive_html" satisfies DeliveryFormat, explicit: changeCue || targeted("deliveryFormat"), quote: t });
  } else if (wantsArticle && !ex.sets.some((s) => s.key === "deliveryFormat")) {
    ex.sets.push({ key: "deliveryFormat", value: "platform_article" satisfies DeliveryFormat, explicit: changeCue || targeted("deliveryFormat"), quote: t });
  }

  // 产品：型号提及与品类范围
  for (const m of t.matchAll(MODEL_MENTION_RE)) {
    const v = m[0].trim();
    if (v.length >= 3) ex.productMentions.push(v);
  }
  const cat = t.match(CATEGORY_RE);
  if (cat && ex.productMentions.length === 0) ex.categoryScope = cat[0];

  // 强调 / 避免
  for (const p of phraseAfter(t, /(?:不要|别|避免|不能|禁止|不想|不用)(?:提|写|讲|说|涉及|出现|用|强调)?/g)) {
    if (/互动|HTML|html|H5|h5|图文|平台/.test(p)) continue;
    if (/^(?:太|过|那么|这么)/.test(p) || p.length < 2) continue;
    ex.sets.push({ key: "mustAvoid", value: p, explicit: true, quote: t });
  }
  for (const p of phraseAfter(t, /(?:重点|着重|主打|突出|强调|多讲|多写|必须(?:提|写|讲|强调)?|一定要(?:提|写|讲|强调)?)/g)) {
    if (p.length >= 2 && !/^(?:不|别)/.test(p)) ex.sets.push({ key: "mustEmphasize", value: p, explicit: false, quote: t });
  }
  // 否定后又要求取消
  for (const m of t.matchAll(/(?:可以|可以讲|可以提|允许|取消|不用避免|不必避免)(?:提)?([^，。；,;]{2,12})/g)) {
    if (/取消|不用避免|不必避免|可以提|可以讲|允许/.test(m[0])) ex.removals.push({ key: "mustAvoid", part: (m[1] ?? "").trim() });
  }

  // 活动
  if (NO_ACTIVITY_RE.test(t)) ex.sets.push({ key: "activity", value: "不涉及活动", explicit: true, quote: t });
  else {
    const act = t.match(/(?:活动|促销|大促|节日档|618|双十一|双11|开学季活动)[^，。；]{0,16}/);
    if (act && /有|参加|配合|结合|做|期间|截止|限时/.test(t) && !/不要|别|避免/.test(act[0])) ex.sets.push({ key: "activity", value: act[0].trim(), explicit: false, quote: t });
  }
  if (NO_EXTRA_RE.test(t)) ex.sets.push({ key: "styleNotes", value: "无额外限制", explicit: false, quote: t });

  // 主要问题 / 目标
  const prob = t.match(/(?:担心|怕|痛点是|困扰是|问题是|烦恼是|纠结)([^，。；]{2,24})/);
  if (prob) ex.sets.push({ key: "problem", value: `${prob[0]}`.trim(), explicit: changeCue || targeted("problem"), quote: t });
  const goal = t.match(/(?:目标是|目的是|希望|想要|想让|想)([^，。；]{0,10}(?:种草|到店|咨询|认知|购买|转化|曝光|报名|预约|收藏|拉新)[^，。；]{0,10})/);
  if (goal) ex.sets.push({ key: "goal", value: goal[1]!.trim(), explicit: changeCue || targeted("goal"), quote: t });
  else if (targeted("goal") && opts.answerValue && !ex.delegated && opts.answerValue.length <= 40) ex.sets.push({ key: "goal", value: opts.answerValue, explicit: true, quote: t });
  if (targeted("problem") && !prob && opts.answerValue && !ex.delegated && opts.answerValue.length <= 40) ex.sets.push({ key: "problem", value: opts.answerValue, explicit: true, quote: t });

  // 价格/数值声明：用户口头说的数不是知识库事实
  for (const m of t.matchAll(/(?:[¥￥]\s*\d[\d,.]*|\d[\d,.]*\s*(?:元|块钱?|k|K|千|万))/g)) {
    if (/元|块|¥|￥|千|万|k|K/.test(m[0]) && /价|卖|售|元|块|¥|￥|预算|到手|优惠|补贴|降/.test(t)) ex.claims.push({ kind: "price", text: m[0] });
  }
  for (const m of t.matchAll(/(?:续航|重量|电池|屏幕|内存|存储)[^，。；\d]{0,6}(\d+(?:\.\d+)?\s*(?:kg|公斤|斤|小时|h|英寸|寸|GB|G|TB|Hz|nit|g))/gi)) {
    if (!/想要|希望|要求|至少|最好|能不能|有没有|吗/.test(t)) ex.claims.push({ kind: "spec", text: m[0] });
  }

  // 产品事实提问
  if (QUESTION_MARK_RE.test(t)) {
    for (const f of FACT_QUESTION_TOPICS) if (f.re.test(t) && !/你们|预算多少|觉得|喜欢|想要什么/.test(t)) ex.factQuestions.push({ text: t, categories: [f.category] });
  }
  void topicsIn;
  void PLATFORM_LABEL;
  void SCENARIO_LABEL;
  return ex;
}

/* ------------------------------ 模型补充理解 ------------------------------ */

export const UnderstandingSchema = z
  .object({
    items: z
      .array(z.object({ key: ReqKeySchema, value: z.string().min(1).max(200), quote: z.string().min(1).max(500).optional() }))
      .max(12)
      .default([]),
  })
  .strip();

export interface ModelUnderstanding {
  accepted: { key: ReqKey; value: string; quote: string; fromUser: boolean }[];
  ignoredForgery: boolean;
}

/** 解析模型返回。forged=模型试图携带 confirmed 类字段。 */
export function parseUnderstanding(raw: string, userText: string): ModelUnderstanding {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { accepted: [], ignoredForgery: false };
  }
  const forged = JSON.stringify(obj).match(/"(?:confirmed|confirmation|userConfirmed|isConfirmed|approved)"\s*:\s*(?:true|\{)/i) !== null;
  const r = UnderstandingSchema.safeParse(obj);
  if (!r.success) return { accepted: [], ignoredForgery: forged };
  const accepted = r.data.items.map((i) => {
    const quote = i.quote ?? "";
    const fromUser = quote.length >= 2 && userText.includes(quote);
    return { key: i.key, value: i.value, quote, fromUser };
  });
  return { accepted, ignoredForgery: forged };
}

export const UNDERSTANDING_SYSTEM_PROMPT = [
  "你是华为PC营销需求顾问的“需求理解”模块，只做信息抽取，不写任何营销文案、HTML 或可发布内容。",
  "从用户的最新一段话中抽取需求项，输出单个 JSON：{\"items\":[{\"key\":...,\"value\":...,\"quote\":...}]}。",
  "key 只能是：audience, problem, goal, scenario, productScope, platform, deliveryFormat, mustEmphasize, mustAvoid, activity, styleNotes。",
  "quote 必须是用户原话中的连续片段，作为依据；没有依据就不要输出该项。",
  "不要输出 confirmed / confirmation 等任何确认字段：确认只能由用户在界面上操作产生。",
  "不要推断用户没说过的内容，不要编造产品参数、价格或优惠。",
].join("\n");
