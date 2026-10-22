/**
 * 体验页生成：方案确定后，按固定版块把需求、候选、场景、方案拼成页面结构。
 *
 * 纯函数、确定性、当场完成——不等模型，页面骨架立即可看。
 * 文案只用两种来源：方案与需求里已有的文字（顾问给出的理由、用户的原话整理），以及知识库事实原值；
 * 图片位一律留空（pending），由填充器补齐（见 fill.ts），没有填充器时界面显示占位。
 */
import { randomUUID } from "node:crypto";
import { selectFacts } from "@hwpc/agent";
import {
  NEED_KEY_LABEL,
  NeedKeySchema,
  type CandidateAssessment,
  type CopySlot,
  type ExperiencePage,
  type FactRecord,
  type ImageSlot,
  type NeedEntry,
  type PagePoint,
  type PageSection,
  type PersonalPlan,
} from "@hwpc/contracts";

export interface PageBuildInput {
  plan: PersonalPlan;
  needs: NeedEntry[];
  /** sceneId@version → 场景标题。 */
  sceneTitles: Record<string, string>;
  /** productId → 知识库事实；拿不到资料时为空数组。 */
  facts: Record<string, FactRecord[]>;
  isMock: boolean;
  now: string;
  newId?: () => string;
}

const ROLE_ORDER = { recommended: 0, alternative: 1, not_recommended: 2, unranked: 3 } as const;
const trimEnd = (s: string) => s.replace(/[。．.!！？?；;，,\s]+$/u, "");

/** 字段名的最后一段：“尺寸与重量·重量”→“重量”。 */
const shortField = (field: string) => field.split("·").at(-1) ?? field;

/** 适合做成大字的事实：短、以数字或“约”开头。 */
const isFigure = (v: string) => v.length <= 18 && /^(约\s*)?\d/.test(v.trim());
/**
 * 大字只放数值本身，括号里的说明并入标签：“56 Wh（额定容量）”→ 56 Wh / 电池容量（额定容量）。
 * 数值与说明都是资料原文，只是换了摆放位置。
 */
export function splitFigure(field: string, value: string): { label: string; value: string } {
  const parts = field.split("·");
  const own = parts.at(-1) ?? field;
  const label = /^(尺寸|容量|类型|亮度)$/.test(own) && parts.length > 1 ? `${parts[0]}${own}` : own;
  const m = value.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/);
  return m ? { value: m[1]!.trim(), label: `${label}（${m[2]!.trim()}）` } : { value, label };
}

/** 大字优先展示顾客最关心的几项。 */
const FIGURE_ORDER = [/重量$/, /屏幕·尺寸$/, /电池·容量$/, /亮度$/, /(厚度|高度)$/];
const figureRank = (field: string) => {
  const i = FIGURE_ORDER.findIndex((re) => re.test(field));
  return i < 0 ? FIGURE_ORDER.length : i;
};

function points(list: CandidateAssessment["satisfied"], hard?: (i: number) => boolean): PagePoint[] {
  return list.map((c, i) => ({
    text: c.text,
    evidence: c.evidence.map((e) => ({ title: e.source.title, ...(e.excerpt ? { quote: e.excerpt } : {}) })),
    ...(hard?.(i) ? { hard: true } : {}),
  }));
}

export function buildExperiencePage(input: PageBuildInput): ExperiencePage {
  const id = input.newId ?? randomUUID;
  const { plan, needs } = input;
  const byKey = (k: NeedEntry["key"]) => needs.filter((e) => e.key === k);
  const task = byKey("task")[0]?.value;
  const roleOf = (candidateId: string) => plan.recommendation.byCandidate.find((b) => b.candidateId === candidateId);
  const primaryId = plan.recommendation.primary?.productId;
  const primary = plan.candidates.find((c) => c.product.productId === primaryId);

  /* ---- 开场 ---- */
  const chips = (["task", "budget", "preferences", "hardConstraints"] as const)
    .flatMap((k) => byKey(k).slice(0, 1).map((e) => trimEnd(e.value)))
    .slice(0, 4);
  const lede: CopySlot = {
    slotId: id(),
    intent: "开场导语：概括用户需求与本页内容",
    status: "filled",
    origin: "template",
    factIds: [],
    qualifiers: [],
    text: `我们记下了你说的 ${needs.length} 件事，挑出 ${plan.candidates.length} 款候选${primary ? `，首选 ${primary.modelName}` : "，目前还没有能直接推荐的型号"}。往下看：每一款满足什么、要取舍什么，再亲手试一试。`,
  };
  const hero: PageSection = {
    sectionId: id(),
    kind: "hero",
    eyebrow: "为你的使用方式而选",
    headline: task ? `${trimEnd(task)}，\n从适合你的那台开始。` : "从适合你的那台开始。",
    lede,
    chips,
    // 有首选时开场用首选机型的大图；填充器找不到合适的大图再退回到与用途相符的场景图。
    image: { slotId: id(), intent: task ? `与“${trimEnd(task)}”相符的使用场景` : "笔记本电脑的使用场景", ...(primary ? { product: primary.product } : {}), roles: ["scene", "hero"], status: "pending" },
  };

  /* ---- 你的日常 ---- */
  const needsSection: PageSection = {
    sectionId: id(),
    kind: "needs",
    title: "先认识你的日常。",
    items: NeedKeySchema.options
      .map((k) => ({ label: NEED_KEY_LABEL[k], values: byKey(k).map((e) => ({ text: e.value, hard: e.hard, status: e.status })) }))
      .filter((i) => i.values.length > 0),
  };

  /* ---- 候选：推荐的在前 ---- */
  const candidates: PageSection[] = [...plan.candidates]
    .sort((a, b) => ROLE_ORDER[roleOf(a.candidateId)?.role ?? "unranked"] - ROLE_ORDER[roleOf(b.candidateId)?.role ?? "unranked"])
    .map((c) => {
      const facts = selectFacts(input.facts[c.product.productId] ?? [], []).map((a) => a.fact);
      const figures = facts
        .filter((f) => isFigure(f.value))
        .sort((a, b) => figureRank(a.field) - figureRank(b.field))
        .filter((f, i, all) => all.findIndex((x) => shortField(x.field) === shortField(f.field)) === i)
        .slice(0, 3);
      const described = facts.slice(0, 3);
      const intro: CopySlot = described.length
        ? {
            slotId: id(),
            intent: `${c.modelName} 的产品介绍`,
            status: "filled",
            origin: "template",
            factIds: described.map((f) => f.factId),
            qualifiers: [...new Set(described.flatMap((f) => f.qualifiers))],
            text: described.map((f) => `${shortField(f.field)}：${f.value}`).join("；") + "。",
          }
        : { slotId: id(), intent: `${c.modelName} 的产品介绍`, status: "pending", factIds: [], qualifiers: [] };
      const image: ImageSlot = { slotId: id(), intent: `${c.modelName} 外观主视觉`, product: c.product, roles: ["hero", "color", "detail"], status: "pending" };
      const role = roleOf(c.candidateId);
      return {
        sectionId: id(),
        kind: "candidate" as const,
        candidateId: c.candidateId,
        product: c.product,
        name: c.modelName,
        role: role?.role ?? "unranked",
        overall: c.overall,
        verdict: role?.reason ?? c.comparisonReason,
        intro,
        image,
        highlights: figures.map((f) => ({ ...splitFigure(f.field, f.value), factId: f.factId, qualifiers: f.qualifiers })),
        satisfied: points(c.satisfied),
        compromises: points(c.compromises),
        unmet: points(c.unmet, (i) => c.unmet[i]!.hard),
        unknowns: points(c.unknowns),
        isMock: c.isMock,
      };
    });

  /* ---- 动手体验 ---- */
  const experience: PageSection = {
    sectionId: id(),
    kind: "experience",
    title: "走进场景，亲手试一试。",
    lede: plan.scenes.length
      ? "这些场景按你的需求安排。在房间里环顾四周，点桌上的设备亲手操作；都是虚拟流程演示，不代表在你的设备上测试通过。"
      : "这次没有能纳入方案的场景，可以先在房间里随意看看通用演示。",
    scenes: [...plan.scenes]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ instanceId: s.instanceId, sceneId: s.sceneId, title: input.sceneTitles[`${s.sceneId}@${s.sceneVersion}`] ?? s.sceneId, reason: s.reason })),
  };

  /* ---- 方案 ---- */
  const nameOf = (candidateId: string) => plan.candidates.find((c) => c.candidateId === candidateId)?.modelName ?? candidateId;
  const planSection: PageSection = {
    sectionId: id(),
    kind: "plan",
    title: "把想法，留成自己的方案。",
    ...(primary ? { primaryName: primary.modelName, primaryReason: roleOf(primary.candidateId)?.reason ?? primary.comparisonReason } : {}),
    ...(plan.recommendation.noRecommendationReason ? { noRecommendationReason: plan.recommendation.noRecommendationReason } : {}),
    others: plan.recommendation.byCandidate
      .filter((b) => b.candidateId !== primary?.candidateId)
      .map((b) => ({ name: nameOf(b.candidateId), role: b.role, reason: b.reason })),
    verificationOk: plan.verification.ok,
    checks: plan.verification.checks.map((c) => ({ ok: c.ok, detail: c.detail })),
  };

  return {
    pageId: id(),
    planVersion: plan.version,
    needVersion: plan.needVersion,
    createdAt: input.now,
    updatedAt: input.now,
    theme: "dark-hero",
    sections: [hero, needsSection, ...candidates, experience, planSection],
    isMock: input.isMock,
    filling: false,
  };
}
