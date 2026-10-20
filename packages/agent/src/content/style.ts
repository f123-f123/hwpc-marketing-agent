/**
 * 去 AI 腔与跨门店查重。
 * 套话不一定违规，但几千家门店都这么写就成了“一眼 AI”。这里只做检测和提示，不改写原文。
 */
import type { Article } from "@hwpc/contracts";

/** 常见营销套话 / 模型口头禅。命中越多，读者越容易判断为 AI 生成。 */
export const CLICHES: { re: RegExp; label: string }[] = [
  { re: /赋能/, label: "赋能" },
  { re: /极致/, label: "极致" },
  { re: /颠覆/, label: "颠覆" },
  { re: /革命性/, label: "革命性" },
  { re: /不仅[^。！？]{0,20}更/, label: "不仅……更……" },
  { re: /无论是[^。！？]{0,30}还是/, label: "无论是……还是……" },
  { re: /总而言之|综上所述|总的来说/, label: "总结腔" },
  { re: /值得一提的是/, label: "值得一提的是" },
  { re: /在这个[^。！？]{0,12}的时代/, label: "在这个……的时代" },
  { re: /开启[^。！？]{0,8}新篇章|新纪元/, label: "开启新篇章" },
  { re: /堪称/, label: "堪称" },
  { re: /完美(?:契合|融合|平衡)/, label: "完美契合" },
  { re: /一站式/, label: "一站式" },
  { re: /全方位/, label: "全方位" },
  { re: /沉浸式/, label: "沉浸式" },
  { re: /黑科技/, label: "黑科技" },
  { re: /解锁[^。！？]{0,6}(?:新|更多)/, label: "解锁新……" },
  { re: /让我们一起/, label: "让我们一起" },
  { re: /随时随地/, label: "随时随地" },
  { re: /澎湃|强悍|炸裂/, label: "夸张形容词" },
];

export function articleText(a: Article): string {
  const body = a.blocks.map((b) => (b.type === "paragraph" ? `${b.heading ?? ""}${b.text}` : b.caption)).join("\n");
  return [a.title, a.lead ?? "", body, a.callToAction, a.tags.join(" ")].join("\n");
}

export function findCliches(text: string): string[] {
  return CLICHES.filter((c) => c.re.test(text)).map((c) => c.label);
}

const normalize = (t: string) => t.replace(/[\s\p{P}\p{S}]/gu, "");

function bigrams(t: string): Set<string> {
  const n = normalize(t);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}

/** 字符双字组 Jaccard 相似度（0–1）。对中文短文足够区分“换了几个词”和“真正不同”。 */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function maxSimilarity(text: string, peers: string[]): number {
  return peers.reduce((m, p) => Math.max(m, similarity(text, p)), 0);
}

/** 超过这个相似度，就认为与其他门店“几乎一样”。 */
export const SIMILARITY_LIMIT = 0.55;
