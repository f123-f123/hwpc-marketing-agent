/**
 * 切入角度库。同一个任务，不同门店、不同版本从不同角度写，避免几千家门店发出同一篇。
 * 角度只决定“怎么讲”，不改变事实；每个角度都偏向一类事实主题。
 */
import { topicsIn } from "../lexicon.js";

export interface Angle {
  id: string;
  label: string;
  /** 写给模型的具体写法提示。 */
  hint: string;
  /** 这个角度优先用哪些事实主题（lexicon TOPICS 的 id）。 */
  topics: string[];
  /** 适合的人群关键词；命中时优先。 */
  audience: RegExp;
}

export const ANGLES: Angle[] = [
  { id: "day", label: "一天的时间线", hint: "按一天里的几个时间点写：早上出门、白天干活、晚上收尾，每个时间点只讲一个用得上的功能。", topics: ["portability", "battery"], audience: /上班|白领|通勤|职场|出差/ },
  { id: "campus", label: "宿舍到图书馆", hint: "从宿舍、教室、图书馆三个地点切换来写，关注背着走、写作业、上网课。", topics: ["portability", "battery", "display"], audience: /学生|新生|大学|开学|家长/ },
  { id: "parents", label: "替家人挑电脑", hint: "站在帮家人挑选的角度，讲清楚该看哪几项、哪些情况要到店确认。", topics: ["display", "portability"], audience: /家长|父母|家人|长辈|孩子/ },
  { id: "trip", label: "出差一周", hint: "以一次出差为线索：路上、酒店、客户会议室，强调携带与续航，不夸大。", topics: ["portability", "battery"], audience: /出差|商务|销售|差旅/ },
  { id: "create", label: "一个作品的诞生", hint: "跟着一次创作（写方案、修图、剪短片）的步骤写，讲屏幕和性能相关的事实。", topics: ["display", "performance"], audience: /创作|设计|剪辑|摄影|博主/ },
  { id: "devices", label: "手机电脑一起用", hint: "围绕手机和电脑之间传文件、接续工作来写，条件不明确的地方写清“需到店确认”。", topics: ["ecosystem", "ports"], audience: /手机|华为用户|多设备|协同/ },
  { id: "qa", label: "店里最常被问的三个问题", hint: "用导购答疑的口吻，回答顾客最常问的三个问题，每个回答引用一条事实。", topics: [], audience: /./ },
  { id: "detail", label: "一个细节讲透", hint: "只挑一个最打动目标人群的细节，讲清它解决了什么麻烦，其他点一笔带过。", topics: [], audience: /./ },
  { id: "checklist", label: "到店体验清单", hint: "写成到店可以亲手试的 3 件事清单，每件事对应一条事实，结尾邀请到店。", topics: [], audience: /./ },
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
 * round 递增（重新生成）时整体后移，换一批角度。
 */
export function pickAngles(input: { seed: string; audience: string; theme: string; n: number; round?: number }): Angle[] {
  const text = `${input.audience} ${input.theme}`;
  const themeTopics = topicsIn(text);
  const scored = ANGLES.map((a) => ({
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
