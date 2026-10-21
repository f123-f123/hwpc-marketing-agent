/**
 * 模板稿：没有接入写作模型（或模型失败）时使用，也是“高质量推文长什么样”的基准。
 *
 * 写法来自知识库平台写作指南：
 * - 跟着一个具体过程走（时间线 / 地点 / 步骤），每个场景只讲一件事；
 * - 每段回答“遇到什么问题 → 做了什么动作 → 用什么证据（事实原文）→ 在什么条件下成立”；
 * - 先写读者的动作，再出现参数；主动说明一个边界。
 * 事实仍以 {{F编号}} 占位符写入，由程序按原文填充并核验；限制条件放在段落注释里。
 */
import type { Platform, StoreProfile } from "@hwpc/contracts";
import type { Angle, Beat } from "./angles.js";
import { shortModel, type FactAlias, type ImageAlias, type RawArticle, type RawBlock } from "./facts.js";

/** 事实的“讲法”：读者会怎么问、在什么动作里会用到、怎样核实。 */
interface Frame {
  topic: string;
  re: RegExp;
  /** 读者会问的问题（答疑、清单类角度用作小标题）。 */
  q: string;
  /** 用到这项的动作（接在场景后面）。 */
  lead: string;
  /** 一个中性的核实建议，不替顾客下结论。 */
  tip: string;
  /** 名词，用于“最常问的是……”。 */
  noun: string;
}

const FRAMES: Frame[] = [
  { topic: "portability", re: /重量/, q: "拿在手里重不重？", lead: "放进包里背着走", tip: "拿在手里的感觉因人而异，到店可以背上试试。", noun: "重量" },
  { topic: "portability", re: /厚度|高度/, q: "包里占不占地方？", lead: "塞进书包或公文包", tip: "到店可以放进自己的包里比一比。", noun: "厚度" },
  { topic: "battery", re: /电池|续航|容量/, q: "电池够不够一天用？", lead: "插座不好找的时候", tip: "实际使用时间和亮度、软件有关，资料里的数据有测试条件。", noun: "电池" },
  { topic: "display", re: /屏幕|显示|分辨率|亮度|色域|刷新/, q: "屏幕看着怎么样？", lead: "打开文档和网页并排看", tip: "屏幕观感和环境光有关，到店看实物最准。", noun: "屏幕" },
  { topic: "performance", re: /处理器|CPU|性能|显卡/, q: "同时开几个软件，靠什么？", lead: "资料、表格、会议同时开着", tip: "建议把常用软件带到店里实际跑一跑。", noun: "处理器" },
  { topic: "ports", re: /接口/, q: "接投影、U 盘方便吗？", lead: "接投影、U 盘和显示器之前", tip: "外设兼容性建议带上设备到店试接。", noun: "接口" },
  { topic: "ecosystem", re: /WLAN|蓝牙|星闪|NFC|无线|协同/, q: "和手机、耳机怎么连？", lead: "和手机、耳机配合用", tip: "协同功能对手机型号和系统版本有要求，以官方说明为准。", noun: "无线连接" },
  { topic: "av", re: /摄像|麦克风|扬声器|音频/, q: "上网课、开视频会怎么样？", lead: "上网课、开视频会", tip: "到店可以开个视频通话试试效果。", noun: "音视频" },
  { topic: "input", re: /键盘|触控/, q: "打字顺不顺手？", lead: "长时间打字", tip: "手感因人而异，到店敲几段字试试。", noun: "键盘" },
  { topic: "storage", re: /内存|存储|硬盘/, q: "资料存得下吗？", lead: "照片、资料越存越多", tip: "具体容量以销售版本为准。", noun: "存储" },
];
const DEFAULT_FRAME: Frame = { topic: "other", re: /./, q: "还有什么值得看？", lead: "另外值得一看的是", tip: "细节以门店实际销售版本为准。", noun: "细节" };

export const frameOf = (field: string): Frame => {
  const own = field.split("·").at(-1) ?? field;
  return FRAMES.find((f) => f.re.test(own)) ?? FRAMES.find((f) => f.re.test(field)) ?? DEFAULT_FRAME;
};

/** 字段的读法：“屏幕·尺寸”→“屏幕尺寸”，“处理器·CPU”→“处理器”。 */
export function labelOf(field: string): string {
  const parts = field.split("·");
  const last = parts.at(-1) ?? field;
  const section = parts.length > 1 ? parts[0]! : "";
  if (/^CPU$/i.test(last)) return "处理器";
  if (/^(尺寸|类型|容量|材料|分辨率|亮度|刷新率|色域)$/.test(last) && /屏幕|电池/.test(section)) return `${section}${last}`;
  return last;
}

/** 把一条事实写成短语，参数位置留占位符：“重量约 1.33 kg”“处理器是麒麟 X90”。 */
export function phrase(f: FactAlias): string {
  const label = labelOf(f.fact.field);
  const v = f.fact.value.trim();
  const ph = `{{${f.alias}}}`;
  if (v.includes("：")) return `${label}——${ph}`;
  if (/^约/.test(v)) return `${label}${ph}`;
  if (/^\d/.test(v)) return `${label} ${ph}`;
  return `${label}是${ph}`;
}

interface Placed {
  fact: FactAlias;
  frame: Frame;
  heading: string;
  /** 事实是否落在与它相关的场景里；不相关时不硬套场景，改用事实本身的问题作小标题。 */
  matched: boolean;
}

/** 按节拍安排事实：每个场景优先放与它相关的事实，其余按排序补上。index 让不同版本用不同的事实。 */
export function placeFacts(facts: FactAlias[], beats: Beat[], n: number, index: number): Placed[] {
  const rotated = [...facts.slice(index % Math.max(1, facts.length)), ...facts.slice(0, index % Math.max(1, facts.length))];
  const pool = [...rotated];
  const take = (pred: (f: FactAlias) => boolean) => {
    const i = pool.findIndex(pred);
    return i >= 0 ? pool.splice(i, 1)[0] : undefined;
  };
  const out: Placed[] = [];
  const used = new Set<Frame>();
  const fresh = (f: FactAlias) => !used.has(frameOf(f.fact.field));
  for (let i = 0; i < n; i++) {
    const beat = beats[i];
    const hit = beat ? take((f) => fresh(f) && beat.topics.includes(frameOf(f.fact.field).topic)) : undefined;
    const fact = hit ?? take(fresh) ?? take(() => true);
    if (!fact) break;
    const frame = frameOf(fact.fact.field);
    used.add(frame);
    out.push({ fact, frame, heading: hit && beat ? beat.heading : frame.q, matched: Boolean(hit) });
  }
  return out;
}

const CIRCLED = ["①", "②", "③", "④", "⑤"];

/** 每个角度的开场：从读者的处境说起。 */
const OPENERS: Record<string, string> = {
  day: "从早上出门到晚上收尾，一台电脑要陪你过完一整天。",
  campus: "宿舍、教室、图书馆来回跑，电脑每天都得背着走。",
  parents: "替家人挑电脑，自己先弄清楚该看哪几项，再带他到店里亲手试。",
  trip: "出差一周，路上、酒店、会议室来回换，电脑一直跟着你。",
  create: "写方案、修图、剪片子之前，先对照一下这几项资料。",
  devices: "手机拍的、存的，常常要到电脑上接着弄。",
  qa: "顾客到店里，最常问的就是这几件事。",
  detail: "这次不列一长串参数，只把一个细节讲清楚。",
  checklist: "与其在网上比来比去，不如到店里亲手试这几件事。",
};

function tagsFor(angle: Angle, audience: string, theme: string, product: string): string[] {
  const words = [product.replace(/[（(][^）)]*[）)]/g, ""), audience, ...theme.split(/[、，,\s/｜|]+/), angle.tag, "笔记本电脑", "电脑选购"]
    .map((t) => t.replace(/\s+/g, "").replace(/^#/, ""))
    .filter((t) => t && [...t].length <= 12);
  return [...new Set(words)].slice(0, 8);
}

const clip = (s: string, max: number) => ([...s].length <= max ? s : [...s].slice(0, max).join(""));

export interface TemplateInput {
  angle: Angle;
  index: number;
  theme: string;
  audience: string;
  store: StoreProfile;
  productName: string;
  facts: FactAlias[];
  images: ImageAlias[];
}

export function templateRaw(platform: Platform, inp: TemplateInput): RawArticle {
  const { angle } = inp;
  const product = shortModel(inp.productName, 16) || "这台电脑";
  const opener = OPENERS[angle.id] ?? `${inp.theme}。`;
  const visit = `想亲手试试，可以来${inp.store.name}，带上常用的软件或外设，样机都能上手。`;
  const pics = [...inp.images.slice(inp.index % Math.max(1, inp.images.length)), ...inp.images.slice(0, inp.index % Math.max(1, inp.images.length))];
  const image = (i: number): RawBlock[] => (pics[i] ? [{ type: "image", image: pics[i]!.alias, caption: pics[i]!.image.description }] : []);
  const sentence = (p: Placed) => `${p.matched ? `${p.heading}，` : ""}${p.frame.lead}：${phrase(p.fact)}。`;

  switch (platform) {
    case "xiaohongshu": {
      const placed = placeFacts(inp.facts, angle.beats, 3, inp.index);
      const blocks: RawBlock[] = [...image(0), { type: "paragraph", text: `${opener}${inp.theme ? `这次的主题是“${inp.theme}”，` : ""}我们把官网资料里和这几个场景有关的挑了出来。` }];
      placed.forEach((p, i) => {
        blocks.push({ type: "paragraph", heading: `${CIRCLED[i]} ${p.matched ? p.heading : p.frame.noun}`, text: `${p.frame.lead}：${phrase(p.fact)}。${p.frame.tip}` });
        blocks.push(...image(i + 1));
      });
      blocks.push({ type: "paragraph", text: "这些都来自官网资料，具体配置以门店实际销售版本为准；拿不准的地方，可以到店上手试。" });
      blocks.push({ type: "paragraph", text: angle.question });
      return { title: clip(angle.xhsTitle, 20), coverText: angle.cover, blocks, callToAction: visit, tags: tagsFor(angle, inp.audience, inp.theme, product) };
    }
    case "wechat_article": {
      const placed = placeFacts(inp.facts, angle.beats, 3, inp.index);
      const blocks: RawBlock[] = [...image(0)];
      placed.forEach((p, i) => {
        const heading = p.matched ? `${p.heading}：${p.frame.q}` : p.frame.q;
        blocks.push({ type: "paragraph", heading, text: `${sentence(p)}${p.frame.tip}` });
        if (i === 0) blocks.push(...image(1));
      });
      blocks.push({ type: "paragraph", heading: "到店前可以先确认的", text: "具体配置、销售版本和软件兼容性，请以门店实际销售版本为准。常用的软件和外设可以带到店里，当场试一试。" });
      return {
        title: clip(angle.wechatTitle(inp.audience || "你"), 26),
        lead: `${opener}这篇按官网资料，把 ${product} 和这几个场景有关的地方挑出来，最后写清楚哪些要到店确认。`,
        blocks,
        callToAction: visit,
        tags: [],
      };
    }
    case "store_moments": {
      const [p] = placeFacts(inp.facts, angle.beats, 1, inp.index);
      const blocks: RawBlock[] = [];
      if (p) blocks.push({ type: "paragraph", text: `${p.frame.lead}：${phrase(p.fact)}。${p.frame.tip}` });
      blocks.push({ type: "paragraph", text: "把你常用的软件和预算发我，我按资料帮你对一对。" });
      blocks.push(...image(0), ...image(1), ...image(2));
      return {
        title: `${clip(inp.audience || "最近", 8)}来问电脑，最常问的是${p?.frame.noun ?? "怎么选"}。`,
        blocks,
        callToAction: `想上手试试，直接来${inp.store.name}。`,
        tags: [],
      };
    }
    case "store_poster": {
      // 海报卖点要短：优先选数值短的事实
      const short = [...inp.facts].sort((a, b) => a.fact.value.length - b.fact.value.length);
      const placed = placeFacts(short.filter((f) => f.fact.value.length <= 14), [], 3, 0);
      return {
        title: clip(angle.posterTitle, 12),
        lead: ((m) => ([...`${m} · ${inp.theme}`].length <= 20 && inp.theme ? `${m} · ${inp.theme}` : m))(shortModel(inp.productName, 12) || product),
        blocks: [...image(0), { type: "paragraph", text: placed.map((p) => `${labelOf(p.fact.fact.field)} {{${p.fact.alias}}}`).join("\n") }],
        callToAction: "到店亲手试 · 扫码咨询",
        tags: [],
      };
    }
  }
}
