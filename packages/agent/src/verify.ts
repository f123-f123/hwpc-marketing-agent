/**
 * 事实与合规核验：判断“原文是否支持具体表达”，不是只看 factId 是否存在。
 * 检查型号、配置、数值与单位、量词（约/最长/至少…）、限制条件、测试范围、价格与权益、
 * 图片说明、互动后显示文字、行动引导。可修复问题做有限次修订并重新核验。
 */
import type { Article, ArticleBlock, FactRecord, MaterialPack, VerificationFinding, VerificationReport } from "@hwpc/contracts";
import {
  ABSOLUTE_RE,
  COMPETITOR_RE,
  FAKE_EXPERIENCE_RE,
  MODEL_MENTION_RE,
  PRICE_TOKEN_RE,
  PROMISE_RE,
  TOPICS,
} from "./lexicon.js";
import { scopeOf, topicsOf } from "./strategy.js";
import type { ConversationState, InteractionPlan } from "./types.js";
import { norm } from "./util.js";

export const MAX_REPAIR_ROUNDS = 2;
const QUANTIFIERS = ["约", "最长", "最高", "最大", "最多", "至少", "最低", "起", "左右", "以上", "以内", "仅", "只"];
const NUM_RE = /\d+(?:\.\d+)?/g;

const sentences = (t: string): string[] => t.split(/(?<=[。！!？?；;\n])/).filter((x) => x.trim().length);
const bigrams = (t: string) => {
  const n = norm(t);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
};
/** qualifier 被正文覆盖的比例（双字组）。 */
export function coverage(qualifier: string, text: string): number {
  const q = bigrams(qualifier);
  if (!q.size) return 1;
  const t = norm(text);
  let hit = 0;
  for (const g of q) if (t.includes(g)) hit++;
  return hit / q.size;
}

const factText = (f: FactRecord) => `${f.field} ${f.value} ${f.qualifiers.join(" ")}`;

export interface Issue {
  kind: VerificationFinding["kind"];
  severity: VerificationFinding["severity"];
  code: string;
  message: string;
  blockIndex?: number;
  excerpt?: string;
  factIds: string[];
  imageIds: string[];
  /** 可自动修复的动作。 */
  fix?: { type: "remove_sentence"; sentence: string } | { type: "append_qualifier"; text: string } | { type: "use_verbatim" } | { type: "drop_block" } | { type: "set_caption" };
}

interface Ctx {
  state: ConversationState;
  pack: MaterialPack;
  facts: Map<string, FactRecord>;
  scopeProducts: string[];
  scopeConfigs: string[];
  avoidTopics: string[];
  noPrice: boolean;
}

function ctxOf(state: ConversationState, pack: MaterialPack): Ctx {
  const scope = scopeOf(state);
  const avoid = topicsOf(state.items["mustAvoid"]?.value);
  const noPrice = avoid.includes("price") || Boolean(state.items["activity"] && /不涉及活动/.test(state.items["activity"].value));
  return {
    state,
    pack,
    facts: new Map(pack.facts.map((f) => [f.factId, f])),
    scopeProducts: scope.refs.map((r) => r.productId),
    scopeConfigs: scope.configurationIds,
    avoidTopics: avoid,
    noPrice,
  };
}

/** 对一段带事实绑定的文字核验。被文章段落、互动展示文字、标题/导语共用。 */
export function checkText(ctx: Ctx, text: string, factIds: string[], where: { blockIndex?: number; label: string }): Issue[] {
  const issues: Issue[] = [];
  const bound = factIds.map((id) => ctx.facts.get(id)).filter((f): f is FactRecord => Boolean(f));
  const base = { blockIndex: where.blockIndex, factIds, imageIds: [] as string[] };
  const supportAll = norm(bound.map(factText).join(" "));
  const push = (i: Omit<Issue, "blockIndex" | "factIds" | "imageIds"> & { factIds?: string[] }) => issues.push({ ...base, ...i });

  // 绑定的事实必须存在、属于所选产品/配置
  for (const id of factIds) {
    const f = ctx.facts.get(id);
    if (!f) push({ kind: "fact", severity: "blocker", code: "fact_missing", message: `${where.label}引用了资料中不存在的事实 ${id}`, fix: { type: "drop_block" } });
    else {
      if (!ctx.scopeProducts.includes(f.productId)) push({ kind: "fact", severity: "blocker", code: "wrong_product", message: `${where.label}使用了非所选型号的事实 ${id}`, fix: { type: "drop_block" } });
      else if (f.configurationIds.length && !f.configurationIds.some((c) => ctx.scopeConfigs.includes(c))) {
        push({ kind: "fact", severity: "blocker", code: "wrong_config", message: `${where.label}使用了未选定配置的事实 ${id}（仅适用于 ${f.configurationIds.join("、")}）`, fix: { type: "drop_block" } });
      }
      if (f.reviewStatus !== "verified") push({ kind: "fact", severity: "blocker", code: "fact_unverified", message: `${where.label}使用了待审核事实 ${id}`, fix: { type: "drop_block" } });
    }
  }

  const sents = sentences(text);
  for (const sen of sents) {
    const sn = norm(sen);
    // 数值：每个数字必须出现在绑定事实中
    const nums = [...sen.matchAll(NUM_RE)].map((m) => m[0]);
    const unsupported = nums.filter((n) => !supportAll.includes(norm(n)));
    if (unsupported.length) {
      push({
        kind: "fact",
        severity: "blocker",
        code: bound.length ? "number_unsupported" : "number_ungrounded",
        message: bound.length ? `${where.label}出现原文没有的数值「${unsupported.join("、")}」` : `${where.label}含数值「${unsupported.join("、")}」但没有绑定任何事实`,
        excerpt: sen.trim(),
        fix: { type: "remove_sentence", sentence: sen },
      });
    }
    // 量词：正文用了原文没有的量词，或者数值保留而量词被丢弃
    for (const q of QUANTIFIERS) {
      if (q === "仅" || q === "只") {
        if (sen.includes(q) && !supportAll.includes(q) && nums.length) push({ kind: "fact", severity: "major", code: "quantifier_added", message: `${where.label}加入了原文没有的限定词「${q}」`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
        continue;
      }
      if (sen.includes(q) && !supportAll.includes(q)) {
        push({ kind: "fact", severity: "blocker", code: "quantifier_added", message: `${where.label}使用了原文没有的量词「${q}」，可能夸大或改变含义`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
      }
    }
    for (const f of bound) {
      const fv = norm(f.value);
      const fnums = [...f.value.matchAll(NUM_RE)].map((m) => m[0]);
      const mentions = fnums.some((n) => sn.includes(norm(n)));
      if (!mentions) continue;
      for (const q of QUANTIFIERS) {
        if (q === "仅" || q === "只") continue;
        if (fv.includes(q) && !sn.includes(q)) {
          push({ kind: "fact", severity: "major", code: "quantifier_dropped", message: `${where.label}写到「${f.field}」时丢掉了原文的量词「${q}」`, excerpt: sen.trim(), factIds: [f.factId], fix: { type: "use_verbatim" } });
          break;
        }
      }
    }
    // 测试范围 / 条件声明
    if (/实测|测试|测得|评测|跑分/.test(sen) && !/实验室|测试|测得/.test(supportAll)) {
      push({ kind: "fact", severity: "blocker", code: "test_claim_unsupported", message: `${where.label}声称有测试结果，原文没有对应的测试依据`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    }
    if (/全天|一整天|一天一充|通勤一周|不用充电|超长/.test(sen) && !/全天|一整天|一天一充|通勤一周|超长/.test(supportAll)) {
      push({ kind: "fact", severity: "major", code: "scope_extended", message: `${where.label}把原文的数据延伸成了原文没有的使用结论`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    }
    // 合规
    if (ABSOLUTE_RE.test(sen)) push({ kind: "compliance", severity: "blocker", code: "absolute", message: `${where.label}含绝对化用语`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    if (FAKE_EXPERIENCE_RE.test(sen)) push({ kind: "compliance", severity: "blocker", code: "fake_experience", message: `${where.label}含虚构体验、评价、销量或测试结果`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    if (PROMISE_RE.test(sen)) push({ kind: "compliance", severity: "blocker", code: "promise", message: `${where.label}含营销承诺`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    if (COMPETITOR_RE.test(sen)) push({ kind: "compliance", severity: "blocker", code: "competitor", message: `${where.label}涉及竞品，存在无依据对比或贬低风险`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    if (PRICE_TOKEN_RE.test(sen)) {
      const priceBound = bound.some((f) => f.category === "price" && f.qualifiers.length > 0);
      if (ctx.noPrice || !priceBound) {
        push({
          kind: "compliance",
          severity: "blocker",
          code: ctx.noPrice ? "price_forbidden" : "price_unsupported",
          message: ctx.noPrice ? `${where.label}出现价格/优惠表达，但需求为不涉及活动或明确避免` : `${where.label}出现价格/优惠表达，没有带有效条件的资料依据`,
          excerpt: sen.trim(),
          fix: { type: "remove_sentence", sentence: sen },
        });
      }
    }
    for (const t of ctx.avoidTopics) {
      const topic = TOPICS.find((x) => x.id === t);
      if (topic && t !== "price" && topic.re.test(sen)) push({ kind: "compliance", severity: "major", code: "avoid_topic", message: `${where.label}涉及用户要求避免的「${topic.label}」`, excerpt: sen.trim(), fix: { type: "remove_sentence", sentence: sen } });
    }
  }

  // 型号：文中出现的型号必须是所选型号
  const models = ctx.pack.products.filter((p) => ctx.scopeProducts.includes(p.productId));
  const known = models.flatMap((p) => [p.model, p.family, ...p.aliases].map(norm));
  const rejected = ctx.state.candidates.filter((c) => !ctx.scopeProducts.includes(c.productId)).map((c) => norm(c.model));
  const tn = norm(text);
  for (const r of rejected) {
    if (r && tn.includes(r) && !known.some((k) => k.includes(r) || r.includes(k) && r.length === k.length)) {
      push({ kind: "fact", severity: "blocker", code: "other_model", message: `${where.label}提到了未选用的型号`, excerpt: text.slice(0, 60), fix: { type: "drop_block" } });
    }
  }
  for (const m of text.matchAll(MODEL_MENTION_RE)) {
    const mm = norm(m[0]);
    if (mm.length < 4) continue;
    if (!known.some((k) => k.includes(mm) || mm.includes(k))) {
      push({ kind: "fact", severity: "blocker", code: "model_mismatch", message: `${where.label}提到的型号「${m[0].trim()}」与所选型号不一致`, excerpt: m[0], fix: { type: "remove_sentence", sentence: sentences(text).find((x) => x.includes(m[0])) ?? m[0] } });
    }
  }

  // 限制条件必须带入正文
  for (const f of bound) {
    for (const q of f.qualifiers) {
      if (coverage(q, text) < 0.6) {
        push({ kind: "fact", severity: "major", code: "qualifier_missing", message: `${where.label}引用「${f.field}」时没有带上限制条件「${q}」`, factIds: [f.factId], fix: { type: "append_qualifier", text: q } });
      }
    }
  }
  return dedupe(issues);
}

function dedupe(a: Issue[]): Issue[] {
  const seen = new Set<string>();
  return a.filter((i) => {
    const k = `${i.code}|${i.blockIndex}|${i.excerpt ?? i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function checkImage(ctx: Ctx, b: Extract<ArticleBlock, { type: "image" }>, idx: number): Issue[] {
  const out: Issue[] = [];
  const im = ctx.pack.images.find((x) => x.imageId === b.imageId);
  const base = { blockIndex: idx, factIds: [] as string[], imageIds: [b.imageId] };
  if (!im) return [{ ...base, kind: "image", severity: "blocker", code: "image_missing", message: `图片 ${b.imageId} 不在资料包中`, fix: { type: "drop_block" } }];
  if (!ctx.scopeProducts.includes(im.productId)) out.push({ ...base, kind: "image", severity: "blocker", code: "image_model_mismatch", message: `图片 ${im.imageId} 属于其他型号`, fix: { type: "drop_block" } });
  if (im.configurationIds.length && !im.configurationIds.some((c) => ctx.scopeConfigs.includes(c))) out.push({ ...base, kind: "image", severity: "blocker", code: "image_config_mismatch", message: `图片 ${im.imageId} 仅适用于未选定的配置`, fix: { type: "drop_block" } });
  // 说明不能引入图片描述之外的数值或结论
  const desc = norm(`${im.description} ${im.usageNote ?? ""}`);
  const extra = [...b.caption.matchAll(NUM_RE)].map((m) => m[0]).filter((n) => !desc.includes(norm(n)));
  if (extra.length) out.push({ ...base, kind: "image", severity: "major", code: "caption_unsupported", message: `图片说明含画面中没有依据的数值「${extra.join("、")}」`, excerpt: b.caption, fix: { type: "set_caption" } });
  for (const [re, code, msg] of [
    [ABSOLUTE_RE, "caption_absolute", "图片说明含绝对化用语"],
    [FAKE_EXPERIENCE_RE, "caption_fake", "图片说明含虚构体验或评价"],
  ] as const) {
    if (re.test(b.caption)) out.push({ ...base, kind: "compliance", severity: "major", code, message: msg, excerpt: b.caption, fix: { type: "set_caption" } });
  }
  if (PRICE_TOKEN_RE.test(b.caption) || COMPETITOR_RE.test(b.caption)) out.push({ ...base, kind: "compliance", severity: "major", code: "caption_price_competitor", message: "图片说明含价格/优惠或竞品表达", excerpt: b.caption, fix: { type: "set_caption" } });
  return out;
}

export interface VerifyInput {
  state: ConversationState;
  pack: MaterialPack;
  article: Article;
  plan?: InteractionPlan;
  allowedFactIds: string[];
  minImages?: number;
}

export function collectIssues(inp: VerifyInput): Issue[] {
  const ctx = ctxOf(inp.state, inp.pack);
  const issues: Issue[] = [];
  const a = inp.article;
  // 标题、导语、行动引导
  for (const [label, text] of [
    ["标题", a.title],
    ["导语", a.lead ?? ""],
    ["行动引导", a.callToAction],
  ] as const) {
    if (!text) continue;
    for (const i of checkText(ctx, text, [], { label })) issues.push({ ...i, blockIndex: undefined, fix: i.fix && { type: "use_verbatim" } });
  }
  a.blocks.forEach((b, idx) => {
    if (b.type === "paragraph") {
      const heading = b.heading ? checkText(ctx, b.heading, b.factIds, { blockIndex: idx, label: `第 ${idx + 1} 块小标题` }).filter((x) => x.code !== "qualifier_missing") : [];
      issues.push(...heading, ...checkText(ctx, b.text, b.factIds, { blockIndex: idx, label: `第 ${idx + 1} 段` }));
      const notAllowed = b.factIds.filter((id) => !inp.allowedFactIds.includes(id));
      if (notAllowed.length) issues.push({ kind: "fact", severity: "major", code: "not_in_confirmed_direction", message: `第 ${idx + 1} 段使用了确认摘要之外的事实 ${notAllowed.join("、")}`, blockIndex: idx, factIds: notAllowed, imageIds: [], fix: { type: "drop_block" } });
    } else issues.push(...checkImage(ctx, b, idx));
  });
  if (inp.plan) {
    inp.plan.interactions.forEach((it) => {
      for (const o of it.options) {
        const t = checkText(ctx, o.reveal.text, o.reveal.factIds, { label: `互动「${it.label}」选项「${o.label}」` });
        issues.push(...t.map((x) => ({ ...x, code: `interaction_${x.code}`, fix: undefined })));
        const out = o.reveal.factIds.filter((id) => !inp.allowedFactIds.includes(id));
        if (out.length) issues.push({ kind: "fact", severity: "blocker", code: "interaction_outside_evidence", message: `互动选项「${o.label}」使用了确认摘要之外的事实`, factIds: out, imageIds: [] });
      }
      for (const [label, text] of [["互动标题", it.label], ["互动提示", it.prompt]] as const) {
        for (const x of checkText(ctx, text, it.factIds, { label })) issues.push({ ...x, code: `interaction_${x.code}`, fix: undefined });
      }
      const ids = new Set(it.factIds);
      for (const o of it.options) for (const id of o.reveal.factIds) if (!ids.has(id)) issues.push({ kind: "fact", severity: "blocker", code: "interaction_unlisted_fact", message: `互动选项事实 ${id} 未登记在互动方案的事实清单中`, factIds: [id], imageIds: [] });
    });
  }
  return issues;
}

/* ------------------------------ 修复 ------------------------------ */

function applyFixes(article: Article, issues: Issue[], pack: MaterialPack): { article: Article; applied: Map<Issue, "removed" | "rewritten"> } {
  const applied = new Map<Issue, "removed" | "rewritten">();
  const blocks: (ArticleBlock | null)[] = article.blocks.map((b) => ({ ...b }));
  let { title, lead, callToAction } = article;
  for (const i of issues) {
    if (!i.fix) continue;
    const idx = i.blockIndex;
    if (idx === undefined) {
      if (i.fix.type === "use_verbatim" || i.fix.type === "remove_sentence") {
        const strip = (t: string | undefined, sen: string) => (t ? t.replace(sen, "").trim() : t);
        const sen = i.fix.type === "remove_sentence" ? i.fix.sentence : (i.excerpt ?? "");
        if (i.message.startsWith("标题")) title = strip(title, sen) || "了解这款产品";
        else if (i.message.startsWith("导语")) lead = strip(lead, sen) || undefined;
        else if (i.message.startsWith("行动引导")) callToAction = strip(callToAction, sen) || "欢迎到店咨询，具体信息以门店资料为准。";
        applied.set(i, "removed");
      }
      continue;
    }
    const b = blocks[idx];
    if (!b) continue;
    switch (i.fix.type) {
      case "drop_block":
        blocks[idx] = null;
        applied.set(i, "removed");
        break;
      case "remove_sentence":
        if (b.type === "paragraph") {
          const next = b.text.replace(i.fix.sentence, "").trim();
          if (next) {
            b.text = next;
            applied.set(i, "removed");
          } else {
            blocks[idx] = null;
            applied.set(i, "removed");
          }
        }
        break;
      case "append_qualifier":
        if (b.type === "paragraph" && coverage(i.fix.text, b.text) < 0.6) {
          b.text = `${b.text.replace(/[。！!]*$/, "")}（${i.fix.text}）。`;
          applied.set(i, "rewritten");
        }
        break;
      case "use_verbatim":
        if (b.type === "paragraph") {
          const f = i.factIds.map((id) => pack.facts.find((x) => x.factId === id)).find(Boolean);
          if (f) {
            b.text = `${f.field}：${f.value}${f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : ""}。`;
            applied.set(i, "rewritten");
          }
        }
        break;
      case "set_caption":
        if (b.type === "image") {
          const im = pack.images.find((x) => x.imageId === b.imageId);
          b.caption = (im?.description ?? "产品图片").replace(/^【MOCK】/, "【MOCK】");
          applied.set(i, "rewritten");
        }
        break;
    }
  }
  return { article: { ...article, title, lead, callToAction, blocks: blocks.filter((b): b is ArticleBlock => b !== null) }, applied };
}

export interface VerifyOutcome {
  article: Article;
  plan?: InteractionPlan;
  report: VerificationReport;
  rounds: number;
  history: { round: number; issues: number; applied: number }[];
}

export function verifyAndRepair(inp: VerifyInput, at: string): VerifyOutcome {
  let article = inp.article;
  const findings: VerificationFinding[] = [];
  const history: VerifyOutcome["history"] = [];
  let fid = 0;
  const mk = (i: Issue, resolution: VerificationFinding["resolution"], note?: string, round?: number): VerificationFinding => ({
    findingId: `vf-${++fid}`,
    kind: i.kind,
    severity: i.severity,
    excerpt: i.excerpt,
    blockIndex: i.blockIndex,
    message: round ? `${i.message}（第 ${round} 轮修订）` : i.message,
    factIds: i.factIds,
    imageIds: i.imageIds,
    resolution,
    resolutionNote: note,
  });

  let round = 0;
  let issues = collectIssues({ ...inp, article });
  for (; round < MAX_REPAIR_ROUNDS && issues.some((i) => i.fix); round++) {
    const fixable = issues.filter((i) => i.fix);
    const r = applyFixes(article, fixable, inp.pack);
    // block 下标会在删除后变化：本轮的发现按旧下标记录为“已处理”，随后重新核验。
    for (const [i, how] of r.applied) {
      findings.push(mk(i, how, how === "removed" ? "已从作品中删除该表述" : "已按原文改写", round + 1));
    }
    history.push({ round: round + 1, issues: issues.length, applied: r.applied.size });
    if (r.applied.size === 0) break;
    article = r.article;
    issues = collectIssues({ ...inp, article });
  }
  // 重新核验后仍存在的问题：不再重试
  const remaining = issues.filter((i) => i.severity !== "minor");
  for (const i of remaining) findings.push(mk(i, i.severity === "blocker" ? "flagged" : "flagged", "修订次数用尽或无法自动修复，需人工处理"));

  // 结构性检查
  const paragraphs = article.blocks.filter((b) => b.type === "paragraph");
  const images = article.blocks.filter((b) => b.type === "image");
  const structural: Issue[] = [];
  if (!paragraphs.length) structural.push({ kind: "compliance", severity: "blocker", code: "empty_article", message: "核验删除问题表述后，作品没有可交付的正文", factIds: [], imageIds: [] });
  if (inp.minImages !== undefined && images.length < inp.minImages) {
    structural.push({ kind: "image", severity: "minor", code: "image_count_low", message: `资料中可用且型号一致的图片只有 ${images.length} 张，少于该渠道建议的 ${inp.minImages} 张；未用无关图片凑数`, factIds: [], imageIds: [] });
  }
  for (const i of structural) findings.push(mk(i, i.severity === "blocker" ? "flagged" : "flagged", i.severity === "minor" ? "已说明，不影响交付" : undefined));

  // 通过项：让报告说明“查过什么”
  article.blocks.forEach((b, idx) => {
    if (b.type === "paragraph" && b.factIds.length && !findings.some((f) => f.blockIndex === idx && f.resolution === "flagged")) {
      findings.push({ findingId: `vf-${++fid}`, kind: "fact", severity: "minor", blockIndex: idx, message: "数值、量词、限制条件、型号与配置均与原文一致", factIds: b.factIds, imageIds: [], resolution: "passed", excerpt: b.text.slice(0, 40) });
    } else if (b.type === "image" && !findings.some((f) => f.blockIndex === idx && f.resolution === "flagged")) {
      findings.push({ findingId: `vf-${++fid}`, kind: "image", severity: "minor", blockIndex: idx, message: "图片型号、配置与所选产品一致，说明未超出画面描述", factIds: [], imageIds: [b.imageId], resolution: "passed" });
    }
  });
  findings.push({ findingId: `vf-${++fid}`, kind: "compliance", severity: "minor", message: "已检查绝对化用语、虚构体验、价格与优惠、竞品对比、营销承诺", factIds: [], imageIds: [], resolution: "passed" });

  let plan = inp.plan;
  const planIssues = plan ? remaining.filter((i) => i.code.startsWith("interaction_")) : [];
  if (plan) {
    plan = { ...plan, verified: planIssues.length === 0, verificationNotes: planIssues.length ? planIssues.map((i) => i.message) : ["互动展示文字均来自已核验事实，且只改变展示，不改需求或证据"] };
  }

  const flaggedBlockers = findings.some((f) => f.severity === "blocker" && f.resolution === "flagged");
  const pending = findings.filter((f) => f.resolution === "pending_user").length > 0;
  const changed = findings.some((f) => f.resolution === "removed" || f.resolution === "rewritten" || (f.resolution === "flagged" && f.severity !== "blocker"));
  const unresolvedPackConflict = inp.pack.conflicts.some((c) => c.status === "unresolved");
  const pendingConfirmations: string[] = [];
  const deliveryStatus: VerificationReport["deliveryStatus"] = flaggedBlockers || unresolvedPackConflict ? "blocked" : pending ? "needs_confirmation" : changed ? "deliverable_with_notes" : "deliverable";
  return { article, plan, report: { findings, pendingConfirmations, deliveryStatus, checkedAt: at }, rounds: round, history };
}
