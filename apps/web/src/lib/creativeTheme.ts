/**
 * 视觉风格 → 海报与小红书封面的主题。
 *
 * 配色、字体来自创作规范库（内容数据，与界面设计 token 无关）；没有风格时使用界面默认的海报样式。
 * 浅色背景用“图上字下”的版式，深色背景用“图上压字”的版式。
 */
import type { CSSProperties } from "react";
import type { VisualStyle } from "@hwpc/contracts";

export interface PosterTheme {
  bg: string;
  fg: string;
  accent: string;
  surface: string;
  headFont: string;
  headWeight: number;
  /** 背景是深色：标题压在图片上。 */
  dark: boolean;
  /** 风格名，用于标注；默认样式为空。 */
  name: string;
}

const BODY_FONT = `"HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;

/** 默认海报样式（与原先的深色海报一致）。画布不能读 CSS 变量，这里写一份。 */
export const DEFAULT_THEME: PosterTheme = { bg: "#0a0b0d", fg: "#ffffff", accent: "#c7000b", surface: "#f4f5f7", headFont: BODY_FONT, headWeight: 700, dark: true, name: "" };

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

export function themeOf(visual: VisualStyle | undefined): PosterTheme {
  if (!visual) return DEFAULT_THEME;
  const p = visual.palette;
  return {
    bg: p.background,
    fg: p.text,
    accent: p.accent,
    surface: p.surface,
    headFont: `${visual.typography.heading}, ${BODY_FONT}`,
    headWeight: visual.typography.heading_weight,
    dark: luminance(p.background) < 0.25,
    name: visual.name,
  };
}

/** 给 HTML 预览用的 CSS 变量。 */
export function themeVars(t: PosterTheme): CSSProperties {
  return {
    "--pt-bg": t.bg,
    "--pt-fg": t.fg,
    "--pt-accent": t.accent,
    "--pt-surface": t.surface,
    "--pt-head-font": t.headFont,
    "--pt-head-weight": String(t.headWeight),
  } as CSSProperties;
}

export const canvasFont = (t: PosterTheme, size: number, weight: number, heading = false) => `${weight} ${size}px ${heading ? t.headFont : BODY_FONT}`;
