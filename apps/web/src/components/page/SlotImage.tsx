import type { ImageSlot, SlotOrigin } from "@hwpc/contracts";

/** 内容来源的标注。网络图片必须说明仅供参考。 */
export const SLOT_ORIGIN_LABEL: Record<SlotOrigin, string> = {
  local: "本地知识库",
  ima: "ima 知识库",
  official_web: "华为官网",
  web: "网络图片 · 仅供参考",
  illustration: "示意图",
  template: "按资料整理",
  model: "模型撰写 · 事实来自资料",
};

/**
 * 图片位：填好了显示图片和来源；还没填（或没找到）时显示占位，并写明这里应该放什么。
 * 占位是设计的一部分，不是错误——图片来源接入之前页面也能完整浏览。
 */
export function SlotImage({ slot, tone, title, className }: { slot: ImageSlot; tone: "dark" | "light"; title?: string; className?: string }) {
  if (slot.status === "filled" && slot.image) {
    const img = slot.image;
    return (
      <figure className={`slot ${className ?? ""}`}>
        <img src={img.url} alt={img.alt} loading="lazy" />
        <figcaption>{SLOT_ORIGIN_LABEL[img.origin]}{img.caption ? ` · ${img.caption}` : ""}</figcaption>
      </figure>
    );
  }
  return (
    <figure className={`slot slot-ph slot-ph-${tone} ${className ?? ""}`} aria-label={`图片待接入：${slot.intent}`}>
      {title && <span className="slot-ph-title" aria-hidden="true">{title}</span>}
      <figcaption>{slot.status === "failed" ? `没有找到合适的图片 · ${slot.intent}` : `图片待接入 · ${slot.intent}`}</figcaption>
    </figure>
  );
}
