/**
 * 门店推文提示词。平台之间改变的是结构、节奏、口吻、配图与行动引导，不只是字数。
 * 事实只能以 {{F编号}} 占位符出现，由程序填入；门店地址、活动由程序在行动引导后追加。
 */
import type { Platform, StoreProfile } from "@hwpc/contracts";
import { PLATFORM_PLANS } from "../strategy.js";
import type { Angle } from "./angles.js";
import type { FactAlias, ImageAlias } from "./facts.js";
import { CLICHES } from "./style.js";

/** 各平台的写法要点（在 PLATFORM_PLANS 基础上补充“怎么写才像真人”）。 */
export const PLATFORM_CRAFT: Record<Platform, string[]> = {
  wechat_article: [
    "标题是信息型的，点明人群和场景，不超过 26 个字，不用感叹号。",
    "导语两句话：第一句说读者的处境，第二句说这篇能帮他判断什么。",
    "正文 3–5 段，每段有一个小标题，小标题是一个具体问题或场景，不是口号。",
    "图片穿插在段落之间，每张图配一句说明画面的图注。",
    "最后一段写清楚限制：哪些要以实际销售版本为准、哪些需要到店确认。",
  ],
  xiaohongshu: [
    "第一个 block 必须是图片（首图），标题不超过 20 个字，口语、带具体场景或数字编号（编号不是参数）。",
    "正文分 3–5 个短段，每段不超过 3 句；可以用 1–3 个表情符号点缀，不要每句都加。",
    "像店员在给朋友讲，不要假装自己是买家、不写“我用了”“亲测”。",
    "结尾抛一个读者能回答的问题，引导评论或收藏。",
    "tags 给 5–8 个话题词，具体到人群和场景，不要只写品牌名。",
  ],
  store_moments: [
    "这是店员发的朋友圈：title 写成正文的第一句话（会作为首句展示），不要书名号。",
    "正文只要 1–2 段，合计不超过 120 个字，像发给熟客的消息。",
    "只讲一个最打动目标人群的点，再给一个现在来店里的理由。",
    "不要话题标签，tags 留空数组。",
  ],
  store_poster: [
    "这是门店海报：title 是主标题，不超过 12 个字；lead 是副标题，不超过 20 个字。",
    "正文正好 3 个 paragraph，每个是一句不超过 18 个字的卖点短句，各引用一条事实。",
    "只放 1 张图（image block 放在最前面）。",
    "callToAction 是一句到店或扫码咨询的提示，不超过 16 个字。",
  ],
};

export function systemPrompt(platform: Platform, styleGuide?: string): string {
  const plan = PLATFORM_PLANS[platform];
  return [
    `你是华为电脑门店的写作助手，替门店导购写一条可以直接发到「${platformName(platform)}」的内容。`,
    "",
    "【平台规则】",
    `- 结构：${plan.structure.join(" → ")}`,
    `- 篇幅：${plan.lengthRange.min}–${plan.lengthRange.max} 字；配图 ${plan.imageCount.min}–${plan.imageCount.max} 张`,
    `- 语气：${plan.tone}`,
    ...PLATFORM_CRAFT[platform].map((x) => `- ${x}`),
    "",
    "【事实规则（最重要）】",
    "- 任何参数、数值、功能名、规格，只能写成占位符 {{F编号}}，例如“机身厚度{{F4}}”。程序会用资料原文替换。",
    "- 不要自己写任何数字参数；不写价格、优惠、赠品、补贴；不写“亲测”“我用了”“销量”“好评”；不和其他品牌比较；不用“最”“第一”“唯一”等绝对化用语；不做承诺。",
    "- 资料里没有的能力就不写。可以写“到店可以亲手试”，不能替顾客下结论。",
    "- 标题、导语、行动引导里不要放占位符。",
    "- 门店地址、电话、活动不要写，程序会在行动引导后面补上。",
    "",
    "【别写成 AI 腔】",
    `- 不要用这些词句：${CLICHES.map((c) => c.label).join("、")}。`,
    "- 用具体的动作、地点和时间代替形容词；句子短一点；每段只说一件事。",
    "- 不要每段都以同样的句式开头，不要“首先/其次/最后”式的排比。",
    ...(styleGuide ? ["", "【知识库里的平台写作指南（节选，只学结构与方法）】", styleGuide] : []),
    "",
    "【输出】只输出一个 JSON 对象，不要其他文字：",
    '{"title":"…","lead":"…（可选）","blocks":[{"type":"paragraph","heading":"…（可选）","text":"…"},{"type":"image","image":"I1","caption":"…"}],"callToAction":"…","tags":["…"]}',
  ].join("\n");
}

export function userPrompt(input: {
  campaign: { title: string; theme: string; audience: string; mustAvoid: string };
  store: StoreProfile;
  angle: Angle;
  facts: FactAlias[];
  images: ImageAlias[];
  productNames: string[];
}): string {
  const s = input.store;
  return JSON.stringify(
    {
      推广任务: { 名称: input.campaign.title, 主题: input.campaign.theme, 目标人群: input.campaign.audience, 不要出现: input.campaign.mustAvoid || "无" },
      产品: input.productNames,
      本店: { 名称: s.name, 城市: s.city || "未填", 商圈: s.area || "未填", 主要客群: s.audience || "未填", 导购自称: s.staffName || "不出现个人称呼" },
      切入角度: { 名称: input.angle.label, 写法: input.angle.hint },
      可用事实: input.facts.map((f) => ({ 编号: f.alias, 字段: f.fact.field, 原文: f.fact.value, 限制: f.fact.qualifiers })),
      可用图片: input.images.map((i) => ({ 编号: i.alias, 画面: i.image.description, 类型: i.image.role })),
    },
    null,
    1,
  );
}

export function platformName(p: Platform): string {
  return { wechat_article: "微信公众号", xiaohongshu: "小红书", store_moments: "朋友圈", store_poster: "门店海报" }[p];
}

/** 从知识库平台模板里截取写作方法部分，控制提示词长度。 */
export function excerptGuide(markdown: string, max = 1400): string {
  const start = markdown.search(/##\s*三、/);
  const body = start >= 0 ? markdown.slice(start) : markdown;
  return body.replace(/\n{3,}/g, "\n\n").slice(0, max).trim();
}
