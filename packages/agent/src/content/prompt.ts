/**
 * 门店推文提示词。平台之间改变的是结构、节奏、口吻、配图与行动引导，不只是字数。
 *
 * 写作方法取自知识库 P6 平台写作指南：跟着一个具体过程写；每段回答“问题—动作—证据—条件—下一步”之一；
 * 先写读者的动作再出现参数；主动说明一个边界。
 * 事实只能以 {{F编号}} 占位符出现，由程序按原文填入，限制条件由程序附在段落后；门店地址、活动由程序追加。
 */
import type { Platform, StoreProfile, VoiceStyle } from "@hwpc/contracts";
import { PLATFORM_PLANS } from "../strategy.js";
import type { Angle } from "./angles.js";
import type { FactAlias, ImageAlias } from "./facts.js";
import { CLICHES } from "./style.js";
import { frameOf, labelOf } from "./template.js";

/** 各平台的写法要点（在 PLATFORM_PLANS 基础上补充“怎么写才像真人、才好看”）。 */
export const PLATFORM_CRAFT: Record<Platform, string[]> = {
  wechat_article: [
    "标题只承载一个矛盾或结果，点明人群和场景，不超过 26 个字，不用感叹号。",
    "导语 80–150 字，还原读者的处境，再说这篇能帮他判断什么。",
    "正文 3–5 章，每章一个小标题。小标题写成读者的一个卡点或问题（例如“插座被占满的下午，电池够不够？”），不是口号。",
    "每章按“卡点—动作—证据—限制”写：先讲读者在做什么，再出现功能名和占位符。",
    "每 200 字左右穿插一张有信息作用的图，图注说明画面里能看到什么，而不是夸它好看。",
    "最后一章写清楚哪些要以实际销售版本为准、哪些需要到店确认；结尾只给一个动作（到店试 / 咨询）。",
  ],
  xiaohongshu: [
    "图片顺序就是故事顺序：第一张是封面（只给一个结果或问题），中间每张解决一个问题，正文与图序一致。第一个 block 必须是图片。",
    "coverText 是叠在封面图上的大字：不超过 14 个字，可以用 \\n 分成两行，像一句提问或一个结论（例如“宿舍→图书馆\\n一台够吗？”）。",
    "标题不超过 20 个字，口语、带具体场景，不堆感叹号。",
    "正文分 4–6 个短段，每段不超过 3 句。要点段用 heading 写成“① 场景名”，正文写动作和证据。",
    "可以用 1–3 个表情符号点缀，不要每句都加；不写“家人们”“宝子们”“绝绝子”这类口头禅。",
    "像店员在给朋友讲，不要假装自己是买家，不写“我用了”“亲测”。",
    "结尾抛一个读者能回答的问题，引导评论或收藏。tags 给 5–8 个话题词，具体到人群和场景，不要只写品牌名。",
  ],
  store_moments: [
    "这是店员发给熟客的朋友圈：title 写成正文的第一句话（会作为首句展示），点出人群和任务，不要书名号。",
    "正文 1–2 段，合计不超过 120 个字：只讲一个最打动这群人的点（动作 + 占位符证据），再主动说一个边界。",
    "最后邀请对方把需求发过来（常用软件、预算），而不是喊“快来抢”。",
    "最多一个表情符号；不要话题标签，tags 留空数组。",
  ],
  store_poster: [
    "这是门店海报，一屏一结论：title 是主标题（不超过 12 个字），lead 是副标题（不超过 20 个字）。",
    "只放 1 张图，image block 放在最前面。",
    "正文只有 1 个 paragraph，里面正好 3 行卖点（用换行分隔），每行不超过 18 个字，各引用一条事实，例如“机身重量{{F2}}”。",
    "callToAction 是一句到店或扫码咨询的提示，不超过 16 个字。",
  ],
};

/** 每个平台一组正反例。正例用占位符示范写法，只学方法，不照抄。 */
const EXAMPLES: Record<Platform, string> = {
  xiaohongshu: [
    "正例（节选）：",
    '{"titleOptions":["宿舍→教室→图书馆，一台够吗","大一新生的电脑，先看这三处","开学前挑电脑，别只看参数表"],"coverText":"宿舍→图书馆\\n一台够吗？",',
    '"blocks":[{"type":"image","image":"I1","caption":"放在宿舍书桌上的整机"},',
    '{"type":"paragraph","text":"宿舍、教室、图书馆来回跑，电脑每天都得背着走。我们按官网资料挑了三处最常被问到的地方。"},',
    '{"type":"paragraph","heading":"① 宿舍","text":"书桌小、书包也满，先看能不能轻松塞进去：机身重量{{F2}}，厚度{{F3}}。"},',
    '{"type":"paragraph","heading":"② 图书馆","text":"插座常被占满的时候，看电池：{{F5}}。实际能用多久和亮度、软件有关。"},',
    '{"type":"paragraph","text":"你在宿舍、教室还是图书馆用电脑最多？评论区说说。"}],"callToAction":"开学前想上手试试，可以来店里，样机都能摸。","tags":["大学生电脑","开学季","宿舍好物","笔记本电脑"]}',
    "反例：“超轻薄！续航超长！学生党闭眼入！”——堆形容词和感叹号，没有场景，用程度词代替了资料原文。",
  ].join("\n"),
  wechat_article: [
    "正例（节选）：",
    '{"titleOptions":["一份会议材料，为什么总在三台设备之间绕路","出差一周：路上、酒店、会议室各要什么","替父母挑电脑，先看这几项"],',
    '"lead":"周一早上收到客户的资料，路上用手机看了一半，到了公司还要在电脑上接着改……这篇按官网资料，把和这个过程有关的几项挑出来，也写清楚哪些需要到店确认。",',
    '"blocks":[{"type":"paragraph","heading":"会议室里，投影接不上怎么办？","text":"临开会前才发现转接头没带，最先要看的是接口：{{F7}}。外设兼容性建议带上自己的设备到店试接。"},{"type":"image","image":"I2","caption":"机身侧面的接口位置"}]}',
    "反例：每章标题都是“轻薄便携”“性能强劲”这样的口号，正文罗列参数，没有任何读者动作。",
  ].join("\n"),
  store_moments: [
    "正例：",
    '{"titleOptions":["每天录表的朋友，选电脑先看屏幕和接口。"],"blocks":[{"type":"paragraph","text":"表格开得多，屏幕{{F4}}；要接投影和 U 盘，接口——{{F7}}。具体配置以店里实际销售版本为准。"},{"type":"paragraph","text":"把常用软件和预算发我，我按资料帮你对一对。"}],"callToAction":"想上手试试，直接来店里。","tags":[]}',
    "反例：“限时福利！全场狂欢！错过等一年！”——没有人群、没有证据，还在编促销。",
  ].join("\n"),
  store_poster: [
    "正例：",
    '{"titleOptions":["宿舍到图书馆","开学，带一台轻的","大一的第一台电脑"],"lead":"MateBook 14 · 开学季","blocks":[{"type":"image","image":"I1","caption":"整机正面"},{"type":"paragraph","text":"机身重量{{F2}}\\n电池容量{{F5}}\\n屏幕尺寸 {{F4}}"}],"callToAction":"到店亲手试 · 扫码咨询","tags":[]}',
    "反例：主标题写成一长句口号，卖点写成“超强性能 极致体验”。",
  ].join("\n"),
};

const OUTPUT: Record<Platform, string> = {
  xiaohongshu: '{"titleOptions":["标题1（≤20字）","标题2","标题3"],"coverText":"封面大字（≤14字，可用\\n换行）","blocks":[{"type":"image","image":"I1","caption":"…"},{"type":"paragraph","heading":"① …（可选）","text":"…"}],"callToAction":"…","tags":["…5–8个"]}',
  wechat_article: '{"titleOptions":["标题1（≤26字）","标题2","标题3"],"lead":"导语（80–150字）","blocks":[{"type":"paragraph","heading":"小标题","text":"…"},{"type":"image","image":"I1","caption":"…"}],"callToAction":"…","tags":[]}',
  store_moments: '{"titleOptions":["第一句话1","第一句话2","第一句话3"],"blocks":[{"type":"paragraph","text":"…"},{"type":"image","image":"I1","caption":"…"}],"callToAction":"…","tags":[]}',
  store_poster: '{"titleOptions":["主标题1（≤12字）","主标题2","主标题3"],"lead":"副标题（≤20字）","blocks":[{"type":"image","image":"I1","caption":"…"},{"type":"paragraph","text":"卖点1\\n卖点2\\n卖点3"}],"callToAction":"…（≤16字）","tags":[]}',
};

const EMOJI_RULE: Record<VoiceStyle["emoji"], string> = {
  none: "不用表情符号",
  restrained: "最多 1–2 个，放在段尾，不放在标题里",
  auto: "按平台习惯，全文最多 3 个",
};

/** 语言风格（来自创作规范库）：决定怎么说，不改变说什么。 */
export function voiceSection(v: VoiceStyle, platform?: Platform): string[] {
  // 海报一屏一结论，任何语气下都不放表情符号
  const emoji = platform === "store_poster" ? "海报不用表情符号" : EMOJI_RULE[v.emoji];
  return [
    `【语言风格：${v.name}】决定句长、措辞、叙述视角、情绪、表情和收尾方式；平台结构、篇幅、配图数量与事实规则不变。`,
    `- 视角：${v.person}`,
    `- 节奏：${v.rhythm}`,
    `- 用词：${v.vocabulary}`,
    `- 情绪：${v.emotion}`,
    `- 表情符号：${emoji}`,
    `- 收尾：${v.cta}`,
    `- 避免：${v.avoid.join("；")}`,
    "- 与上面的口吻、表情要求冲突时，以本语言风格为准；但不得为了风格编造体验、人物、数字、库存或优惠。",
  ];
}

export function systemPrompt(platform: Platform, styleGuide?: string, voice?: VoiceStyle): string {
  const plan = PLATFORM_PLANS[platform];
  // 指定了语言风格时，表情符号的用法由语言风格决定，去掉平台写法里关于表情的那一条
  const craft = PLATFORM_CRAFT[platform].filter((x) => !(voice && /表情符号/.test(x)));
  return [
    `你是华为电脑门店的资深内容编辑，替门店导购写一条可以直接发在「${platformName(platform)}」的内容。`,
    "导购的身份是“店里的人”：可以介绍、可以邀请到店，但不是买家，也不是测评博主。",
    "",
    "【好内容的标准】（来自知识库平台写作指南）",
    "1. 跟着一个具体的过程走：一天的时间线、几个地点的切换，或一件事的几个步骤。用户消息里的「写作节拍」就是这个过程，按顺序写。",
    "2. 每一段至少回答一项：读者遇到什么问题、做了什么动作、用什么证据（事实占位符）、在什么条件下成立、下一步做什么。回答不了这些的形容词和口号，删掉。",
    "3. 先写读者的动作和场景，再出现功能名和参数；一段只讲一件事；同一项参数全文只出现一次。",
    "4. 主动说一个边界：哪些以销售版本为准、哪些需要到店确认。说清边界的内容更可信。",
    "5. 标题、封面字、小标题里的数量用汉字（“三件事”“两个场景”），不要用阿拉伯数字——阿拉伯数字会被当成没有出处的参数删掉。",
    "6. 写给这一家门店：用户消息里给了城市、商圈、客群，就自然地带进开头或结尾，让它不像几千家门店都能发的通稿。",
    "",
    "【本平台怎么写】",
    `- 结构：${plan.structure.join(" → ")}`,
    `- 篇幅：${plan.lengthRange.min}–${plan.lengthRange.max} 字；配图 ${plan.imageCount.min}–${plan.imageCount.max} 张（只能用「可用图片」里的编号）`,
    `- 语气：${plan.tone}`,
    ...craft.map((x) => `- ${x}`),
    "",
    ...(voice ? [...voiceSection(voice, platform), ""] : []),
    "【事实规则（最重要，违反的句子会被程序删除）】",
    "- 任何参数、数值、功能名、规格，只能写成占位符 {{F编号}}，例如“机身重量{{F2}}”。程序会用资料原文替换，并把资料里的限制条件自动附在该段后面——你不要自己抄写限制条件。",
    "- 占位符前后不要再加数字、单位或程度词（如“仅”“只有”“超长”“足足”）。",
    "- 不写价格、优惠、赠品、补贴、库存；不写“亲测”“我用了”“销量”“好评”“回购”；不和其他品牌比较；不用“最”“第一”“唯一”“顶级”等绝对化用语；不做承诺（“一定”“保证”“完全不卡”）。",
    "- 资料里没有的能力就不写；拿不准的写“到店可以亲手试”，不要替顾客下结论。",
    "- 标题、封面字、导语、行动引导里不要放占位符，也不要放具体参数。",
    "- 门店地址、电话、活动不要写，程序会在行动引导后面补上。",
    "",
    "【别写成 AI 腔】",
    `- 不用这些词句：${CLICHES.map((c) => c.label).join("、")}。`,
    "- 不用“首先/其次/最后”排比；不要每段同样的句式开头；全文最多一个感叹号。",
    "- 用具体的动作、地点、时间代替形容词：写“早上把它塞进通勤包”，不写“轻薄便携”。",
    "",
    "【示例（只学写法，不要照抄；编号以用户消息为准）】",
    EXAMPLES[platform],
    "",
    "【交稿前自查】逐条检查，不满足就先改再输出：",
    "- 每段都回答了问题 / 动作 / 证据 / 条件 / 下一步中的至少一项吗？",
    "- 所有参数都写成占位符了吗？有没有自己编数字、单位、程度词或限制条件？",
    "- 有没有套话、绝对化用语、价格、虚构体验？",
    "- 标题字数、篇幅、配图数量和顺序符合本平台要求吗？三个标题备选是否各不相同？",
    ...(styleGuide ? ["", "【知识库里的平台写作指南（节选，只学结构与方法）】", styleGuide] : []),
    "",
    "【输出】只输出一个 JSON 对象，不要其他文字、不要代码围栏：",
    OUTPUT[platform],
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
  const beats = input.angle.beats;
  return JSON.stringify(
    {
      推广任务: { 名称: input.campaign.title, 主题: input.campaign.theme, 目标人群: input.campaign.audience, 不要出现: input.campaign.mustAvoid || "无" },
      产品: input.productNames,
      本店: { 名称: s.name, 城市: s.city || "未填", 商圈: s.area || "未填", 主要客群: s.audience || "未填", 导购自称: s.staffName || "不出现个人称呼" },
      切入角度: {
        名称: input.angle.label,
        写法: input.angle.hint,
        写作节拍: beats.length ? beats.map((b) => b.heading) : "按读者最关心的问题依次回答",
        结尾可以问读者: input.angle.question,
      },
      可用事实: input.facts.map((f) => {
        const frame = frameOf(f.fact.field);
        const beat = beats.find((b) => b.topics.includes(frame.topic));
        return {
          编号: f.alias,
          字段: labelOf(f.fact.field),
          原文: f.fact.value,
          读者会问: frame.q,
          适合放在: beat?.heading ?? "任意位置",
          说明: "限制条件由程序附上，不要抄写",
        };
      }),
      可用图片: input.images.map((i) => ({ 编号: i.alias, 画面: i.image.description, 类型: i.image.role })),
    },
    null,
    1,
  );
}

export function platformName(p: Platform): string {
  return { wechat_article: "微信公众号", xiaohongshu: "小红书", store_moments: "朋友圈", store_poster: "门店海报" }[p];
}

/** 从知识库平台模板里截取写作方法部分（写作流程 + 成稿格式），控制提示词长度。 */
export function excerptGuide(markdown: string, max = 1400): string {
  const start = markdown.search(/##\s*三、/);
  const end = markdown.search(/##\s*五、/);
  const body = start >= 0 ? markdown.slice(start, end > start ? end : undefined) : markdown;
  return body.replace(/\n{3,}/g, "\n\n").slice(0, max).trim();
}
