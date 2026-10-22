/**
 * 门店推文引擎：一次为一个平台生成多个不同角度的版本，每个版本都经过事实核验与风格检查。
 *
 * 流程：选角度 → 按角度挑事实 → 模型写占位稿（或模板稿）→ 程序填事实 → verifyAndRepair → 套话 / 查重 / 篇幅检查
 *      → 在行动引导后追加门店资料原文（地址、活动）。
 * 是否允许生成、能否发布由服务端门控；本模块只负责产出与如实报告。
 */
import { z } from "zod";
import type { Article, MaterialPack, ModelService, Platform, StoreProfile, VerificationFinding, VerificationReport } from "@hwpc/contracts";
import { topicsIn } from "../lexicon.js";
import { PLATFORM_PLANS } from "../strategy.js";
import { verifyAndRepair, type VerifyScope } from "../verify.js";
import { pickAngles, type Angle } from "./angles.js";
import { aliasImages, materialize, selectFacts, type RawArticle } from "./facts.js";
import { templateRaw } from "./template.js";
import { systemPrompt, userPrompt } from "./prompt.js";
import { articleText, findCliches, maxSimilarity, SIMILARITY_LIMIT } from "./style.js";

export interface PostEngineInput {
  platform: Platform;
  campaign: { title: string; theme: string; audience: string; mustAvoid: string; productIds: string[] };
  store: StoreProfile;
  /** 推广任务所含型号的资料（已合并）。 */
  pack: MaterialPack;
  /** 知识库平台写作指南节选。 */
  styleGuide?: string;
  /** 同一任务、同一平台其他门店已选定稿件的全文，用于查重。 */
  peerTexts: string[];
  count: number;
  /** 第几次生成（重新生成时递增，换一批角度）。 */
  round: number;
  /** 角度轮换种子，通常是 storeId + campaignId + platform。 */
  seed: string;
  /** 已配置的真实模型；为空时使用模板稿。 */
  model?: ModelService;
  temperature: number;
  now: () => Date;
}

export interface GeneratedVariant {
  angle: string;
  article: Article;
  report: VerificationReport;
  mode: "model" | "template";
  similarity: number;
}

const RawBlockSchema = z.object({
  type: z.enum(["paragraph", "image"]),
  heading: z.string().optional(),
  text: z.string().optional(),
  image: z.string().optional(),
  caption: z.string().optional(),
});
const RawArticleSchema = z
  .object({
    title: z.string().optional(),
    titleOptions: z.array(z.string()).max(6).optional(),
    coverText: z.string().optional(),
    lead: z.string().optional(),
    blocks: z.array(RawBlockSchema).min(1),
    callToAction: z.string().default(""),
    tags: z.array(z.string()).default([]),
  })
  .refine((r) => Boolean(r.title?.trim() || r.titleOptions?.some((t) => t.trim())), { message: "缺少标题" });

/** 从模型输出里取出 JSON（容忍 ```json 围栏和前后说明文字）。只给了标题备选时，取第一个作标题。 */
export function parseModelJson(text: string): RawArticle {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  const r = RawArticleSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
  const options = (r.titleOptions ?? []).map((t) => t.trim()).filter(Boolean);
  const { title: rawTitle, ...rest } = r;
  return { ...rest, title: rawTitle?.trim() || options[0]!, titleOptions: options };
}

export { templateRaw } from "./template.js";

function lengthOf(a: Article): number {
  return a.blocks.reduce((n, b) => n + (b.type === "paragraph" ? b.text.length + (b.heading?.length ?? 0) : 0), (a.lead ?? "").length);
}

/** 风格与门店信息检查：不阻断交付，但如实写进核验报告。 */
function styleFindings(article: Article, platform: Platform, similarity: number, dropped: string[], extra: string[]): VerificationFinding[] {
  const out: VerificationFinding[] = [];
  let n = 0;
  const add = (f: Omit<VerificationFinding, "findingId" | "factIds" | "imageIds">) => out.push({ findingId: `st-${++n}`, factIds: [], imageIds: [], ...f });
  for (const s of dropped) add({ kind: "fact", severity: "minor", excerpt: s, message: "这句引用了不存在的事实编号，已删除", resolution: "removed" });
  const cliches = findCliches(articleText(article));
  if (cliches.length) add({ kind: "style", severity: cliches.length >= 3 ? "major" : "minor", message: `出现常见套话：${cliches.join("、")}。读者容易判断为 AI 生成，建议改成具体场景`, resolution: "flagged" });
  if (similarity >= SIMILARITY_LIMIT) add({ kind: "style", severity: "major", message: `与其他门店已选稿件相似度 ${Math.round(similarity * 100)}%，同城发出容易被判重复，建议换一个版本或补充本店信息`, resolution: "flagged" });
  const plan = PLATFORM_PLANS[platform];
  const len = lengthOf(article);
  if (len < plan.lengthRange.min * 0.6 || len > plan.lengthRange.max * 1.3) add({ kind: "style", severity: "minor", message: `正文约 ${len} 字，偏离该平台建议的 ${plan.lengthRange.min}–${plan.lengthRange.max} 字`, resolution: "flagged" });
  if (extra.length) add({ kind: "compliance", severity: "minor", message: `行动引导中的${extra.join("、")}直接取自门店资料原文，未经知识库核验，由门店对其真实性负责`, resolution: "passed" });
  add({ kind: "style", severity: "minor", message: "已检查常见套话、与其他门店的相似度和平台篇幅", resolution: "passed" });
  return out;
}

async function writeOne(inp: PostEngineInput, angle: Angle, index: number): Promise<GeneratedVariant> {
  const topics = [...new Set([...angle.topics, ...topicsIn(`${inp.campaign.theme} ${inp.campaign.audience}`)])];
  // 推广任务不指定具体配置：只用适用于全部配置的事实与图片（配置专属的写进去也会被核验删掉，还会带走封面图）
  const forAll = <T extends { productId: string; configurationIds: string[] }>(x: T) => inp.campaign.productIds.includes(x.productId) && x.configurationIds.length === 0;
  const facts = selectFacts(inp.pack.facts.filter(forAll), topics);
  const images = aliasImages(inp.pack.images.filter(forAll), PLATFORM_PLANS[inp.platform].imageCount.max + 2);
  const productNames = inp.pack.products.filter((p) => inp.campaign.productIds.includes(p.productId)).map((p) => p.model);

  let raw: RawArticle | undefined;
  let mode: GeneratedVariant["mode"] = "template";
  let modelError: string | undefined;
  if (inp.model) {
    try {
      const res = await inp.model.complete({
        messages: [
          { role: "system", content: systemPrompt(inp.platform, inp.styleGuide) },
          { role: "user", content: userPrompt({ campaign: inp.campaign, store: inp.store, angle, facts, images, productNames }) },
        ],
        json: true,
        // 多个版本稍微错开温度，进一步拉开差异；事实由占位符填充，不受温度影响。
        temperature: Math.min(1.3, inp.temperature + index * 0.1),
        // 推理模型的思考过程也计入输出上限；上限太低会把 JSON 截断，整版退回模板稿。
        maxTokens: 8000,
      });
      raw = parseModelJson(res.text);
      mode = "model";
    } catch (e) {
      modelError = e instanceof Error ? e.message : String(e);
    }
  }
  raw ??= templateRaw(inp.platform, { angle, index, theme: inp.campaign.theme, audience: inp.campaign.audience, store: inp.store, productName: productNames[0] ?? "", facts, images });

  let { article: filled, dropped } = materialize(raw, inp.platform, facts, images);
  if (!filled.blocks.some((b) => b.type === "paragraph")) {
    // 模型输出没有可用正文（例如全部引用了不存在的事实编号）：改用模板稿，并在报告里说明。
    modelError ??= "模型输出没有可用正文";
    mode = "template";
    ({ article: filled, dropped } = materialize(templateRaw(inp.platform, { angle, index, theme: inp.campaign.theme, audience: inp.campaign.audience, store: inp.store, productName: productNames[0] ?? "", facts, images }), inp.platform, facts, images));
  }
  const scope: VerifyScope = {
    productIds: inp.campaign.productIds,
    configurationIds: [],
    avoidTopics: topicsIn(inp.campaign.mustAvoid),
    // 门店推文一律不写价格：价格随时变化，由门店在活动字段里自行说明。
    noPrice: true,
    otherModels: [],
  };
  const at = inp.now().toISOString();
  const verified = verifyAndRepair({ scope, pack: inp.pack, article: filled, allowedFactIds: facts.map((f) => f.fact.factId), minImages: PLATFORM_PLANS[inp.platform].imageCount.min }, at);

  // 门店资料原文追加在行动引导之后（核验之后追加，避免地址里的门牌号被当成参数删掉）。
  const extras: string[] = [];
  const cta = [verified.article.callToAction || filled.callToAction];
  if (inp.store.activity.trim()) {
    cta.push(`本店活动：${inp.store.activity.trim()}`);
    extras.push("门店活动");
  }
  if (inp.store.contactLine.trim()) {
    cta.push(inp.store.contactLine.trim());
    extras.push("门店地址 / 联系方式");
  }
  // 核验删空正文时保留原稿展示（报告为 blocked，服务端不允许发布），避免产出一篇空稿。
  const base = verified.article.blocks.some((b) => b.type === "paragraph") ? verified.article : filled;
  const article: Article = { ...base, callToAction: cta.filter(Boolean).join("\n") || inp.store.name };
  const sim = maxSimilarity(articleText(article), inp.peerTexts);
  const findings = [...verified.report.findings, ...styleFindings(article, inp.platform, sim, dropped, extras)];
  if (modelError) findings.push({ findingId: "st-model", kind: "style", severity: "minor", message: `模型调用失败（${modelError}），本版本为模板稿`, factIds: [], imageIds: [], resolution: "flagged" });

  return { angle: angle.label, article, report: { ...verified.report, findings }, mode, similarity: Math.round(sim * 100) / 100 };
}

export async function generatePostVariants(inp: PostEngineInput): Promise<GeneratedVariant[]> {
  const angles = pickAngles({ seed: inp.seed, audience: inp.campaign.audience, theme: inp.campaign.theme, n: inp.count, round: inp.round });
  return Promise.all(angles.map((a, i) => writeOne(inp, a, i)));
}
