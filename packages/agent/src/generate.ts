/**
 * 受控生成：结构化图文 + 互动方案。
 * 只有 Consultant.generate() 在门控通过后才会调用本模块；模型调用经 guardModel(purpose=generation)。
 * 模型输出必须通过 schema；不可用时回退为“逐字引用事实”的模板稿，并如实标记 generationMode。
 */
import { z } from "zod";
import { ArticleSchema, type Article, type ArticleBlock, type FactRecord, type ImageRecord, type MaterialPack, type Platform } from "@hwpc/contracts";
import type { GuardedModel } from "./guard.js";
import { PLATFORM_LABEL, SCENARIO_LABEL } from "./lexicon.js";
import { PLATFORM_PLANS, scopeOf } from "./strategy.js";
import type { ContentDirection, ConversationState, DeliveryFormat, Interaction, InteractionPlan } from "./types.js";
import { InteractionPlanSchema } from "./types.js";
import type { Scenario } from "@hwpc/contracts";

export const GENERATION_SYSTEM_PROMPT = [
  "【角色与任务】你是华为PC营销内容 Agent，服务门店导购与内容运营，交付物是有知识库依据的图文软文。",
  "【场景理解】严格依据“已确认需求”中的人群、场景、问题、目标组织内容，不得自行更换方向。",
  "【平台规则】按 platformPlan 的标题风格、篇幅、结构、语气、图片数、行动引导写作；换平台不是只换字数。",
  "【知识库约束】型号、参数、功能、价格、卖点只能来自“可用事实”。引用数值必须与原值一致，保留“约/最长/至少”等量词与限制条件，不得改写、合并或延伸。",
  "【图片规则】图片只能从“可用图片”中选，说明不得超出画面描述，并说明插入位置理由。",
  "【生成要求】输出标题、导语、分段正文、配图方案、行动引导和标签。不要把所有卖点堆进去，只用已选事实。",
  "【核验规则】无法确认的信息不得写；不得出现价格、优惠、补贴，除非可用事实里有带条件的价格事实。",
  "【合规规则】禁止绝对化宣传、虚构个人体验/评价/测试结果/销量、营销承诺、无依据对比和竞品贬低。",
  "只输出一个 JSON：{title, lead, blocks:[{type:'paragraph',heading,text,factIds}|{type:'image',imageId,caption,placementReason}], callToAction, tags}。不要输出脚本或 HTML。",
].join("\n");

const ModelArticleSchema = ArticleSchema;

export interface GenerateInput {
  state: ConversationState;
  pack: MaterialPack;
  direction: ContentDirection;
  model: GuardedModel;
  signal?: AbortSignal;
  /** 核验后反馈给模型的修订提示（可选）。 */
  repairHint?: string;
}

export interface Draft {
  article: Article;
  mode: "model" | "template_fallback";
  simulated: boolean;
  note?: string;
}

/* ------------------------------ 图片选择 ------------------------------ */

export function pickImages(pack: MaterialPack, state: ConversationState, platform: Platform): ImageRecord[] {
  const scope = scopeOf(state);
  const ok = pack.images.filter((im) => scope.refs.some((r) => r.productId === im.productId) && (im.configurationIds.length === 0 || im.configurationIds.some((c) => scope.configurationIds.includes(c))));
  const order: Record<string, number> = { hero: 0, scene: 1, detail: 2, ports: 3, color: 4, other: 5 };
  const sorted = [...ok].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.imageId.localeCompare(b.imageId));
  return sorted.slice(0, PLATFORM_PLANS[platform].imageCount.max);
}

/* ------------------------------ 模板稿（逐字引用） ------------------------------ */

const fv = (f: FactRecord) => `${f.field}：${f.value}${f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : ""}`;

export function templateDraft(inp: GenerateInput): Article {
  const { state, pack, direction } = inp;
  const it = state.items;
  const platform = (it["platform"]?.value ?? "wechat_article") as Platform;
  const scenario = (it["scenario"]?.value ?? "other") as Scenario;
  const audience = it["audience"]?.value ?? "你";
  const refs = scopeOf(state).refs;
  const product = pack.products.find((p) => refs.some((r) => r.productId === p.productId));
  const name = product?.model ?? "这款产品";
  const facts = direction.selected.map((s) => pack.facts.find((f) => f.factId === s.factId)).filter((f): f is FactRecord => Boolean(f));
  const main = facts.filter((f) => f.category !== "limitation");
  const limits = facts.filter((f) => f.category === "limitation");
  const images = pickImages(pack, state, platform);
  const plan = PLATFORM_PLANS[platform];
  const sc = SCENARIO_LABEL[scenario] ?? "";

  const para = (f: FactRecord, lead: string, heading?: string): ArticleBlock => ({ type: "paragraph", heading, text: `${lead}${fv(f)}。`, factIds: [f.factId] });
  const img = (i: number, reason: string): ArticleBlock[] => {
    const im = images[i];
    return im ? [{ type: "image", imageId: im.imageId, caption: im.description, placementReason: reason }] : [];
  };
  const blocks: ArticleBlock[] = [];
  let title = "";
  let lead: string | undefined;
  let cta = "";
  let tags: string[] = [];

  switch (platform) {
    case "wechat_article": {
      title = `${audience}${sc ? `·${sc}` : ""}：${name}值得了解的几点`;
      lead = `写给${audience}。下面按${sc || "使用"}场景，只讲资料里有依据的几点。`;
      blocks.push(...img(0, "紧跟导语，先建立对产品的整体印象"));
      main.forEach((f, i) => {
        blocks.push(para(f, "", f.field));
        if (i === 0) blocks.push(...img(1, "紧跟第一个要点，用画面印证内容"));
        if (i === 2) blocks.push(...img(2, "放在中段，缓解纯文字的阅读疲劳"));
      });
      for (const l of limits) blocks.push(para(l, "需要留意：", "购买前请留意"));
      cta = "想了解更多或现场体验，欢迎到店咨询，具体信息以门店资料为准。";
      tags = [name, sc].filter(Boolean);
      break;
    }
    case "xiaohongshu": {
      title = `${audience}${sc ? `看${sc}` : ""}｜${name}先看这${Math.min(main.length, 3)}点`;
      lead = `给${audience}的选购参考，只写资料里查得到的。`;
      blocks.push(...img(0, "头图，一眼看到产品"));
      main.slice(0, 3).forEach((f, i) => {
        blocks.push(para(f, `${i + 1}️⃣ `));
        if (i < 2) blocks.push(...img(i + 1, "紧贴对应要点，边看边对照"));
      });
      for (const l of limits) blocks.push(para(l, "小提醒："));
      cta = "觉得有用可以先收藏，想亲手试试欢迎到店。";
      tags = [`#${name.replace(/\s+/g, "")}`, sc ? `#${sc}` : "", `#${audience}`].filter(Boolean);
      break;
    }
    case "store_moments": {
      const f = main[0];
      title = "";
      lead = undefined;
      if (f) blocks.push(para(f, `${name}：`));
      blocks.push(...img(0, "主图放在文案之后，突出唯一卖点"));
      cta = "想看实机，今天来店里找我们。";
      tags = [];
      break;
    }
    case "store_poster": {
      title = name;
      lead = sc ? `${sc}之选` : "到店了解";
      main.slice(0, 3).forEach((f) => blocks.push(para(f, "")));
      blocks.push(...img(0, "唯一主视觉，不拉伸、不错配型号"));
      cta = "到店咨询，具体信息以门店资料为准。";
      tags = [];
      break;
    }
  }
  if (!blocks.some((b) => b.type === "paragraph") && main[0]) blocks.push(para(main[0], ""));
  void plan;
  return ArticleSchema.parse({ platform, title: title || name, lead, blocks, callToAction: cta, tags });
}

/* ------------------------------ 模型稿 ------------------------------ */

function modelUserPrompt(inp: GenerateInput): string {
  const { state, pack, direction } = inp;
  const it = state.items;
  const platform = (it["platform"]?.value ?? "wechat_article") as Platform;
  const facts = direction.selected.map((s) => pack.facts.find((f) => f.factId === s.factId)).filter(Boolean) as FactRecord[];
  const imgs = pickImages(pack, state, platform);
  return JSON.stringify(
    {
      confirmedRequirements: Object.fromEntries(Object.entries(it).map(([k, v]) => [k, v.value])),
      requirementVersion: state.requirementVersion,
      angle: direction.angle,
      platformPlan: PLATFORM_PLANS[platform],
      platformLabel: PLATFORM_LABEL[platform],
      usableFacts: facts.map((f) => ({ factId: f.factId, field: f.field, value: f.value, qualifiers: f.qualifiers, why: direction.selected.find((s) => s.factId === f.factId)?.reason })),
      usableImages: imgs.map((i) => ({ imageId: i.imageId, role: i.role, description: i.description, usageNote: i.usageNote })),
      repairHint: inp.repairHint,
    },
    null,
    1,
  );
}

export async function draftArticle(inp: GenerateInput): Promise<Draft> {
  let simulated = false;
  try {
    const res = await inp.model.call("generation", GENERATION_SYSTEM_PROMPT, modelUserPrompt(inp), { json: true, temperature: 0.4, maxTokens: 2000, signal: inp.signal });
    simulated = res.simulated;
    let obj: unknown;
    try {
      obj = JSON.parse(res.text);
    } catch {
      return { article: templateDraft(inp), mode: "template_fallback", simulated, note: "模型输出不是合法 JSON，已改用逐字引用事实的模板稿" };
    }
    const parsed = ModelArticleSchema.safeParse({ ...(obj as object), platform: inp.state.items["platform"]?.value });
    if (!parsed.success) return { article: templateDraft(inp), mode: "template_fallback", simulated, note: "模型输出结构不符合要求，已改用模板稿" };
    const bad = parsed.data.blocks.some((b) => (b.type === "image" ? !inp.pack.images.some((i) => i.imageId === b.imageId) : b.factIds.some((id) => !inp.pack.facts.some((f) => f.factId === id))));
    if (bad) return { article: templateDraft(inp), mode: "template_fallback", simulated, note: "模型引用了资料包之外的事实或图片，已改用模板稿" };
    return { article: parsed.data, mode: "model", simulated };
  } catch (e) {
    if (e instanceof Error && e.name === "ConsultantError") throw e;
    return { article: templateDraft(inp), mode: "template_fallback", simulated, note: `模型调用失败：${e instanceof Error ? e.message : String(e)}，已改用模板稿` };
  }
}

/* ------------------------------ 互动方案 ------------------------------ */

/**
 * 互动方案由程序从已选事实构造，不让模型写任何可执行内容。
 * 它只改变展示：不改需求、不改证据、不产生新版本。HTML 只是平台图文的补充。
 */
export function buildInteractionPlan(state: ConversationState, pack: MaterialPack, direction: ContentDirection, fingerprint: string): InteractionPlan | undefined {
  const fmt = state.items["deliveryFormat"]?.value as DeliveryFormat | undefined;
  if (fmt !== "interactive_html" && fmt !== "combo") return undefined;
  const platform = (state.items["platform"]?.value ?? "wechat_article") as Platform;
  const facts = direction.selected.map((s) => pack.facts.find((f) => f.factId === s.factId)).filter((f): f is FactRecord => Boolean(f) && f?.category !== "limitation");
  const limits = direction.selected.map((s) => pack.facts.find((f) => f.factId === s.factId)).filter((f): f is FactRecord => Boolean(f) && f?.category === "limitation");
  const serves = (["audience", "scenario", "goal"] as const).filter((k) => state.items[k]);
  const interactions: Interaction[] = [];
  if (facts.length >= 2) {
    const first = facts.slice(0, 5);
    interactions.push({
      interactionId: "ia-1",
      kind: "select_option",
      label: "点选你最关心的一点",
      prompt: "选择一项，查看资料中的对应说明",
      servesRequirementKeys: serves.length ? [...serves] : ["goal"],
      factIds: first.map((f) => f.factId),
      allowedActions: ["select"],
      options: first.map((f) => ({
        optionId: `opt-${f.factId}`,
        label: f.field,
        reveal: { text: `${f.field}：${f.value}${f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : ""}`, factIds: [f.factId] },
      })),
      effects: { operationScope: "scene_state_only", operationsMutateRequirements: false, operationsMutateEvidence: false, explicitFeedbackMayUpdate: true },
    });
  }
  if (limits.length) {
    const l = limits[0]!;
    interactions.push({
      interactionId: "ia-2",
      kind: "reveal_detail",
      label: "选购前请留意",
      prompt: "展开查看资料标明的限制条件",
      servesRequirementKeys: ["goal"],
      factIds: [l.factId],
      allowedActions: ["expand", "collapse"],
      options: [
        { optionId: "opt-limit-show", label: "展开", reveal: { text: `${l.field}：${l.value}${l.qualifiers.length ? `（${l.qualifiers.join("；")}）` : ""}`, factIds: [l.factId] } },
        { optionId: "opt-limit-hide", label: "收起", reveal: { text: "已收起，可随时再次展开查看资料标明的限制条件", factIds: [l.factId] } },
      ],
      effects: { operationScope: "scene_state_only", operationsMutateRequirements: false, operationsMutateEvidence: false, explicitFeedbackMayUpdate: true },
    });
  }
  return InteractionPlanSchema.parse({
    planId: `ip-${state.requirementVersion}-${state.artifacts.length + 1}`,
    requirementVersion: state.requirementVersion,
    fingerprint,
    platform,
    deliveryFormat: fmt,
    requiresPlatformArticle: fmt === "combo",
    interactions,
    verified: false,
    verificationNotes: [],
  });
}
