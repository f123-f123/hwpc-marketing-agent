/**
 * 体验页图片填充器。
 *
 * - 知识库：候选型号的图片取自该型号的官网图片与商城款式图片索引（按画面类型和清晰度挑）；
 *   开场图取自 P6 商城电脑专区素材，按用户的用途匹配画面说明（移动办公、会议、创作……）。
 * - 联网（可选）：知识库没有合适图片时，用联网检索只在华为官方域名里找图，标为“官网”。
 * 找不到就返回 null，页面保持占位并说明原因，不拿不相干的图凑数。
 */
import { LIBRARY_SCENE_PRODUCT_ID, type ImageRecord, type ImageRole, type ImageSlot, type KnowledgeLibrary } from "@hwpc/contracts";
import type { FillContext, ImageProvider } from "./fill.js";
import { isOfficialUrl, OFFICIAL_DOMAINS, type WebSearch } from "../web/search.js";

export const libraryImageUrl = (imageId: string) => `/api/library/images/${encodeURIComponent(imageId)}`;

/** 用途 → 开场图的画面关键词。 */
const SCENE_WORDS: [RegExp, string][] = [
  [/出差|通勤|带着|移动/, "移动办公 长续航 出行"],
  [/办公|会议|文档|表格/, "办公 会议 协同"],
  [/学习|网课|作业|论文/, "学习 文档 专注"],
  [/视频|修图|设计|创作|剪辑/, "创作 夜间内容创作"],
  [/手写|绘画|笔记/, "手写 创作"],
  [/家用|影音|追剧/, "影音 沉浸 娱乐"],
];

function rank(images: ImageRecord[], roles: ImageRole[]): ImageRecord | undefined {
  const order = (r: ImageRole) => {
    const i = roles.indexOf(r);
    return i < 0 ? roles.length : i;
  };
  const area = (im: ImageRecord) => (im.width ?? 600) * (im.height ?? 400);
  // 先挑够大的图（商城缩略图只有 428 px），再按期望画面类型、面积
  const big = (im: ImageRecord) => Number((im.width ?? 0) >= 800);
  return [...images].sort((a, b) => big(b) - big(a) || order(a.role) - order(b.role) || area(b) - area(a))[0];
}

export function libraryImageProvider(library: KnowledgeLibrary): ImageProvider {
  return {
    name: "本地知识库图片",
    canFill: () => true,
    async fill(slot: ImageSlot, ctx: FillContext) {
      let pick: ImageRecord | undefined;
      // 开场图（期望画面以 scene 打头）要铺满整屏：型号图里只接受足够宽的横图。
      const backdrop = slot.roles[0] === "scene";
      if (slot.product) {
        const list = await library.images({ productId: slot.product.productId, query: slot.intent, limit: 40 });
        const usable = backdrop ? list.filter((im) => (im.width ?? 0) >= 1000 && (im.width ?? 0) >= (im.height ?? 0) && im.role !== "detail") : list;
        pick = rank(usable, slot.roles.length ? slot.roles : ["hero", "color", "detail"]);
      }
      if (!pick && (backdrop || !slot.product)) {
        const text = `${slot.intent} ${ctx.needs.map((n) => n.value).join(" ")}`;
        const words = SCENE_WORDS.filter(([re]) => re.test(text)).map(([, w]) => w).join(" ") || "办公 协同";
        pick = (await library.images({ scenesOnly: true, query: words, limit: 1 }))[0];
      }
      if (!pick) return null;
      return {
        url: libraryImageUrl(pick.imageId),
        alt: pick.description,
        caption: `${pick.description}${pick.productId === LIBRARY_SCENE_PRODUCT_ID ? "（示意图，非指定型号）" : ""}`,
        origin: "local" as const,
        source: pick.source,
      };
    },
  };
}

export function webImageProvider(web: WebSearch, nameOf: (productId: string) => string | undefined): ImageProvider {
  return {
    name: `联网检索（${web.provider}）`,
    canFill: (slot) => Boolean(slot.product),
    async fill(slot: ImageSlot, ctx: FillContext) {
      const name = slot.product ? nameOf(slot.product.productId) : undefined;
      if (!name) return null;
      const { images } = await web.search(`${name} 官网 外观`, { images: true, domains: OFFICIAL_DOMAINS, limit: 5, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      const hit = images.find((im) => isOfficialUrl(im.url));
      if (!hit) return null;
      return { url: hit.url, alt: hit.description ?? name, caption: `${name}（华为官网图片）`, origin: "official_web" as const };
    },
  };
}
