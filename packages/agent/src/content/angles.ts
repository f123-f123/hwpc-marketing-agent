/**
 * 切入角度库。同一个任务，不同门店、不同版本从不同角度写，避免几千家门店发出同一篇。
 * 角度只决定“怎么讲”，不改变事实；每个角度都偏向一类事实主题。
 */
import { topicsIn } from "../lexicon.js";

/**
 * 一个“节拍”：文章按顺序经过的场景（时间、地点或步骤）。
 * topics 是这个场景最适合讲的事实类型（见 template.ts 的 FRAMES），程序和模型都按它把事实放进对的场景。
 */
export interface Beat {
  heading: string;
  topics: string[];
}

export interface Angle {
  id: string;
  label: string;
  /** 写给模型的具体写法提示。 */
  hint: string;
  /** 这个角度优先用哪些事实主题（lexicon TOPICS 的 id）。 */
  topics: string[];
  /** 适合的人群关键词；命中时优先。 */
  audience: RegExp;
  /** 场景节拍；为空时按事实本身的问题来组织（答疑、清单类角度）。 */
  beats: Beat[];
  /** 小红书标题（不超过 20 字）与封面大字（可换行，每行不超过 7 字）。 */
  xhsTitle: string;
  cover: string;
  /** 公众号标题（给定人群）。 */
  wechatTitle: (audience: string) => string;
  /** 海报主标题（不超过 12 字）。 */
  posterTitle: string;
  /** 小红书结尾抛给读者的问题。 */
  question: string;
  /** 一个场景话题词。 */
  tag: string;
}

export const ANGLES: Angle[] = [
  {
    id: "day", label: "一天的时间线", hint: "按一天里的几个时间点写：早上出门、白天干活、晚上收尾，每个时间点只讲一个用得上的功能。", topics: ["portability", "battery"], audience: /上班|白领|通勤|职场|出差/,
    beats: [{ heading: "早上出门", topics: ["portability"] }, { heading: "白天干活", topics: ["display", "performance", "input"] }, { heading: "晚上收尾", topics: ["battery", "ecosystem", "av"] }],
    xhsTitle: "一天三个场景，这台电脑够用吗", cover: "一天三个场景\n够不够用？", wechatTitle: (a) => `${a}的一天：一台电脑要陪你过的三个时段`, posterTitle: "一天三个场景",
    question: "你一天里最离不开电脑的是哪个时段？评论区说说，我们按你的情况帮你对一对资料。", tag: "通勤日常",
  },
  {
    id: "campus", label: "宿舍到图书馆", hint: "从宿舍、教室、图书馆三个地点切换来写，关注背着走、写作业、上网课。", topics: ["portability", "battery", "display"], audience: /学生|新生|大学|开学|家长/,
    beats: [{ heading: "宿舍", topics: ["portability", "storage"] }, { heading: "教室", topics: ["display", "input", "av"] }, { heading: "图书馆", topics: ["battery", "ecosystem"] }],
    xhsTitle: "宿舍→教室→图书馆，一台够吗", cover: "宿舍→图书馆\n一台够吗？", wechatTitle: (a) => `${a}看过来：宿舍、教室、图书馆，一台电脑够不够`, posterTitle: "宿舍到图书馆",
    question: "你在宿舍、教室还是图书馆用电脑最多？评论区告诉我们。", tag: "大学生活",
  },
  {
    id: "parents", label: "替家人挑电脑", hint: "站在帮家人挑选的角度，讲清楚该看哪几项、哪些情况要到店确认。", topics: ["display", "portability"], audience: /家长|父母|家人|长辈|孩子/,
    beats: [],
    xhsTitle: "替家人挑电脑，先看这三项", cover: "替家人挑\n先看这三项", wechatTitle: (a) => `替${a.replace(/及|和/g, "、")}挑电脑：先看这几项，再到店试`, posterTitle: "替家人挑电脑",
    question: "你是替谁挑电脑？说说他平时用来做什么，我们帮你看看哪几项最要紧。", tag: "给家人选电脑",
  },
  {
    id: "trip", label: "出差一周", hint: "以一次出差为线索：路上、酒店、客户会议室，强调携带与续航，不夸大。", topics: ["portability", "battery"], audience: /出差|商务|销售|差旅/,
    beats: [{ heading: "路上", topics: ["portability"] }, { heading: "酒店", topics: ["battery", "display"] }, { heading: "会议室", topics: ["ports", "av", "performance"] }],
    xhsTitle: "出差一周，先确认这三件事", cover: "出差一周\n先确认三件事", wechatTitle: (a) => `${a}出差一周：路上、酒店、会议室各要什么`, posterTitle: "出差一周",
    question: "你出差时最怕电脑出什么状况？评论区说说。", tag: "出差装备",
  },
  {
    id: "create", label: "一个作品的诞生", hint: "跟着一次创作（写方案、修图、剪短片）的步骤写，讲屏幕和性能相关的事实。", topics: ["display", "performance"], audience: /创作|设计|剪辑|摄影|博主/,
    beats: [{ heading: "打开素材", topics: ["storage", "performance"] }, { heading: "抠细节", topics: ["display", "input"] }, { heading: "交出去", topics: ["ports", "ecosystem"] }],
    xhsTitle: "做方案修图之前，先看这三项", cover: "动手之前\n先看这三项", wechatTitle: (a) => `从素材到交付：${a}挑电脑时值得对照的几项`, posterTitle: "从素材到交付",
    question: "你平时用电脑做什么作品？评论区说说你的软件，我们帮你对照资料。", tag: "创作工具",
  },
  {
    id: "devices", label: "手机电脑一起用", hint: "围绕手机和电脑之间传文件、接续工作来写，条件不明确的地方写清“需到店确认”。", topics: ["ecosystem", "ports"], audience: /手机|华为用户|多设备|协同/,
    beats: [{ heading: "手机拍完", topics: ["ecosystem"] }, { heading: "电脑接着改", topics: ["display", "performance"] }, { heading: "带出门", topics: ["portability", "battery"] }],
    xhsTitle: "手机电脑一起用，先弄清三点", cover: "手机＋电脑\n先弄清三点", wechatTitle: (a) => `${a}的手机和电脑：怎么配合，哪些要先确认`, posterTitle: "手机电脑一起用",
    question: "你现在用的是什么手机？评论区说说，我们帮你看看能怎么配合。", tag: "多设备协同",
  },
  {
    id: "qa", label: "店里最常被问的三个问题", hint: "用导购答疑的口吻，回答顾客最常问的三个问题，每个回答引用一条事实。", topics: [], audience: /./,
    beats: [],
    xhsTitle: "店里最常被问的三个问题", cover: "店里最常被问\n的三个问题", wechatTitle: (a) => `${a}来店里最常问的三个问题，按资料回答`, posterTitle: "最常被问的三件事",
    question: "你还想问哪一项？留言告诉我们，下一篇接着答。", tag: "选购问答",
  },
  {
    id: "detail", label: "一个细节讲透", hint: "只挑一个最打动目标人群的细节，讲清它解决了什么麻烦，其他点一笔带过。", topics: [], audience: /./,
    beats: [],
    xhsTitle: "只讲一个细节，讲清楚", cover: "一个细节\n讲清楚", wechatTitle: (a) => `给${a}讲清一个细节：它解决什么麻烦`, posterTitle: "一个细节讲清楚",
    question: "你挑电脑时最在意哪个细节？评论区说说。", tag: "细节控",
  },
  {
    id: "checklist", label: "到店体验清单", hint: "写成到店可以亲手试的 3 件事清单，每件事对应一条事实，结尾邀请到店。", topics: [], audience: /./,
    beats: [],
    xhsTitle: "到店先试这三件事，再决定", cover: "到店先试\n这三件事", wechatTitle: (a) => `${a}到店看电脑：先亲手试这三件事`, posterTitle: "到店试三件事",
    question: "你到店最想先试哪一项？评论区告诉我们，帮你提前准备样机。", tag: "到店体验",
  },
];

/** 稳定的字符串哈希（FNV-1a），保证同一门店同一任务每次得到相同的角度顺序。 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 为某门店某任务挑选 n 个角度：先放与人群/主题匹配的，再按门店哈希轮换其余角度。
 * 带人群限定的角度（如“出差一周”）只在人群或主题命中时使用，避免给大一新生写“出差一周”；
 * 可用角度不够 n 个时才放宽。round 递增（重新生成）时整体后移，换一批角度。
 */
export function pickAngles(input: { seed: string; audience: string; theme: string; n: number; round?: number }): Angle[] {
  const text = `${input.audience} ${input.theme}`;
  const themeTopics = topicsIn(text);
  const fitting = ANGLES.filter((a) => a.audience.source === "." || a.audience.test(text));
  const pool = fitting.length >= input.n ? fitting : ANGLES;
  const scored = pool.map((a) => ({
    a,
    score: (a.audience.source !== "." && a.audience.test(text) ? 2 : 0) + (a.topics.some((t) => themeTopics.includes(t)) ? 1 : 0),
    tie: hash(`${input.seed}:${a.id}`),
  }));
  scored.sort((x, y) => y.score - x.score || x.tie - y.tie);
  const ordered = scored.map((s) => s.a);
  // 匹配度最高的那个角度不一定每家都用：按门店哈希决定从第几个开始取，让同城门店也错开。
  const offset = (hash(input.seed) % Math.max(1, Math.min(3, ordered.length))) + (input.round ?? 0) * input.n;
  return Array.from({ length: Math.min(input.n, ordered.length) }, (_, i) => ordered[(offset + i) % ordered.length]!);
}
