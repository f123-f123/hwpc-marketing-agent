/**
 * 创作规范库（视觉风格 / 语言风格 / 内容规格 / 组合预设）。
 *
 * 数据来源是仓库外的 skills/hwpc-creative-studio/references/presets.json，经 `npm run sync:creative`
 * 复制到本目录的 creative-presets.json；应用只读这份副本。加载时校验结构与引用，坏数据在启动时就报错。
 *
 * 风格只改变表达与版式：语言风格进入写作提示词，视觉风格用于海报与小红书封面的配色、字体和版式。
 * 事实、限制条件、图片来源与核验规则不受风格影响。
 */
import { z } from "zod";
import raw from "./creative-presets.json";
import type { Platform } from "./common.js";

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const VisualStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  palette: z.object({ background: Hex, text: Hex, accent: Hex, surface: Hex }),
  typography: z.object({ heading: z.string(), body: z.string(), heading_weight: z.number().int().min(100).max(900), scale: z.number().min(1).max(6) }),
  layout: z.string(),
  image: z.string(),
  motif: z.string(),
  spacing: z.string(),
  avoid: z.array(z.string()),
  suited: z.string(),
});
export type VisualStyle = z.infer<typeof VisualStyleSchema>;

export const VoiceStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  person: z.string(),
  rhythm: z.string(),
  vocabulary: z.string(),
  emotion: z.string(),
  emoji: z.enum(["none", "restrained", "auto"]),
  cta: z.string(),
  avoid: z.array(z.string()),
});
export type VoiceStyle = z.infer<typeof VoiceStyleSchema>;

const FormatSchema = z.object({ id: z.string(), name: z.string(), platform: z.string() }).passthrough();
const PresetSchema = z.object({ id: z.string(), name: z.string(), format: z.string(), visual: z.string(), voice: z.string() }).passthrough();

const CatalogSchema = z
  .object({ version: z.number(), visuals: z.array(VisualStyleSchema), voices: z.array(VoiceStyleSchema), formats: z.array(FormatSchema), presets: z.array(PresetSchema) })
  .passthrough()
  .superRefine((c, ctx) => {
    for (const key of ["visuals", "voices", "formats", "presets"] as const) {
      const ids = c[key].map((x) => x.id);
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `${key} 中有重复 id` });
    }
    const has = (key: "visuals" | "voices" | "formats", id: string) => c[key].some((x) => x.id === id);
    for (const p of c.presets) {
      if (!has("visuals", p.visual) || !has("voices", p.voice) || !has("formats", p.format)) ctx.addIssue({ code: "custom", message: `预设 ${p.id} 引用了不存在的规格` });
    }
  });

export const CREATIVE_CATALOG = CatalogSchema.parse(raw);
export const VISUAL_STYLES: readonly VisualStyle[] = CREATIVE_CATALOG.visuals;
export const VOICE_STYLES: readonly VoiceStyle[] = CREATIVE_CATALOG.voices;

export const visualById = (id: string | undefined): VisualStyle | undefined => VISUAL_STYLES.find((v) => v.id === id);
export const voiceById = (id: string | undefined): VoiceStyle | undefined => VOICE_STYLES.find((v) => v.id === id);

const voiceId = z.string().refine((id) => Boolean(voiceById(id)), { message: "未知的语言风格" });
const visualId = z.string().refine((id) => Boolean(visualById(id)), { message: "未知的视觉风格" });

/** 一个版本实际使用的风格。 */
export const PostStyleSchema = z.object({ voice: voiceId, visual: visualId });
export type PostStyle = z.infer<typeof PostStyleSchema>;

/** 指定风格（总部任务默认值或门店重新生成时的选择）；不填的一项由系统按平台与人群轮换。 */
export const StyleChoiceSchema = z.object({ voice: voiceId.optional(), visual: visualId.optional() });
export type StyleChoice = z.infer<typeof StyleChoiceSchema>;

/**
 * 各平台适合的语言与视觉风格（顺序即默认轮换顺序）。
 * 先放规范库里该平台预设用到的组合，再补充同样适合该平台的风格。
 */
const EXTRA: Record<Platform, { voices: string[]; visuals: string[] }> = {
  wechat_article: { voices: ["professional", "lifestyle-observer", "curious-explainer", "editorial-story", "practical-checklist"], visuals: ["swiss-order", "warm-daily", "editorial-grid", "nature-paper"] },
  xiaohongshu: { voices: ["practical-checklist", "friendly-guide", "curious-explainer", "playful-light", "lifestyle-observer"], visuals: ["swiss-order", "pastel-campus", "warm-daily", "urban-motion", "mono-type"] },
  store_moments: { voices: ["friendly-guide", "concise-direct", "service-invite", "lifestyle-observer"], visuals: ["nature-paper", "product-silence", "warm-daily"] },
  store_poster: { voices: ["concise-direct", "restrained-premium", "professional", "service-invite"], visuals: ["product-silence", "editorial-grid", "gallery-dark", "technical-blueprint", "pastel-campus", "urban-motion", "retro-print", "mono-type"] },
};

export function platformStylePool(platform: Platform): { voices: string[]; visuals: string[] } {
  const formats = new Set(CREATIVE_CATALOG.formats.filter((f) => f.platform === platform).map((f) => f.id));
  const presets = CREATIVE_CATALOG.presets.filter((p) => formats.has(p.format));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    voices: uniq([...presets.map((p) => p.voice), ...EXTRA[platform].voices]).filter((id) => voiceById(id)),
    visuals: uniq([...presets.map((p) => p.visual), ...EXTRA[platform].visuals]).filter((id) => visualById(id)),
  };
}

/** 人群 / 主题与风格的对应：命中的风格排到前面，其余顺序不变。 */
const AUDIENCE_HINTS: { re: RegExp; voices: string[]; visuals: string[] }[] = [
  { re: /学生|新生|大学|开学|校园|宿舍/, voices: ["friendly-guide", "playful-light", "practical-checklist"], visuals: ["pastel-campus"] },
  { re: /出差|差旅|商务|通勤|白领|职场/, voices: ["professional", "concise-direct", "practical-checklist"], visuals: ["urban-motion", "swiss-order"] },
  { re: /家长|父母|长辈|家人|家庭/, voices: ["friendly-guide", "professional"], visuals: ["warm-daily"] },
  { re: /创作|设计|剪辑|摄影|博主|内容/, voices: ["editorial-story", "curious-explainer"], visuals: ["editorial-grid", "gallery-dark"] },
];

/**
 * 为同一批 n 个版本挑风格：各版本语言风格互不相同；按种子轮换起点，让相邻门店拿到不同组合。
 * choice 中指定的一项对全部版本生效。
 */
export function pickStyles(input: { platform: Platform; audience: string; seed: string; round: number; n: number; choice?: StyleChoice }): PostStyle[] {
  const pool = platformStylePool(input.platform);
  /** 候选窗口：命中人群偏好时，偏好风格排前，窗口只比版本数多一个，轮换仍在贴合人群的风格里进行。 */
  const window = (ids: string[], key: "voices" | "visuals") => {
    const hinted = [...new Set(AUDIENCE_HINTS.filter((h) => h.re.test(input.audience)).flatMap((h) => h[key]))].filter((id) => ids.includes(id));
    const ordered = [...new Set([...hinted, ...ids])];
    return hinted.length ? ordered.slice(0, Math.max(input.n + 1, hinted.length)) : ordered;
  };
  const voices = window(pool.voices, "voices");
  const visuals = window(pool.visuals, "visuals");
  let h = 0;
  for (const ch of input.seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // 按种子轮换起点（相邻门店拿到不同组合），每次重新生成整体后移一批
  const start = h + input.round * input.n;
  return Array.from({ length: input.n }, (_, i) => ({
    voice: input.choice?.voice ?? voices[(start + i) % voices.length]!,
    visual: input.choice?.visual ?? visuals[((h >>> 7) + input.round * input.n + i) % visuals.length]!,
  }));
}
