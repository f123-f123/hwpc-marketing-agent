/**
 * 体验页内容位的填充框架。
 *
 * 页面骨架生成时，图片位（以及没有资料可用的文案位）是 pending。填充器负责把它们补上：
 *   ImageProvider：按 slot.intent / slot.product / slot.roles 找图（以后：本地知识库图片索引、官网、检索 API）；
 *   CopyProvider：写介绍文案（以后：模型改写，事实仍只能来自知识库原文）。
 * 每个结果都必须带 origin（来源类别），界面据此标注；找不到就返回 null，不编造。
 *
 * 填充在会话写队列之外进行（可能要调用外部接口，耗时不定），拿到结果后再进队列写回，
 * 只更新仍是 pending 的位置——期间页面被新方案取代时，结果直接丢弃。
 */
import type { CopySlot, ExperiencePage, ImageSlot, NeedEntry } from "@hwpc/contracts";
import { pageSlots } from "@hwpc/contracts";

export interface FillContext {
  needs: NeedEntry[];
  signal?: AbortSignal;
}

export interface ImageProvider {
  readonly name: string;
  canFill(slot: ImageSlot): boolean;
  fill(slot: ImageSlot, ctx: FillContext): Promise<NonNullable<ImageSlot["image"]> | null>;
}

export interface CopyProvider {
  readonly name: string;
  canFill(slot: CopySlot): boolean;
  fill(slot: CopySlot, ctx: FillContext): Promise<Pick<CopySlot, "text" | "origin" | "factIds" | "qualifiers"> | null>;
}

export interface PageFillers {
  images: ImageProvider[];
  copies: CopyProvider[];
}

/** 默认不配置任何填充器：图片位保持占位。接入方式见 apps/server/README.md「体验页内容填充」。 */
export const NO_FILLERS: PageFillers = { images: [], copies: [] };

/** 是否还有能被当前填充器处理的空位。 */
export function hasFillableSlots(page: ExperiencePage, fillers: PageFillers): boolean {
  const { images, copies } = pageSlots(page);
  return (
    images.some((s) => s.status === "pending" && fillers.images.some((p) => p.canFill(s))) ||
    copies.some((s) => s.status === "pending" && fillers.copies.some((p) => p.canFill(s)))
  );
}

export type SlotResult =
  | { slotId: string; kind: "image"; image: NonNullable<ImageSlot["image"]> }
  | { slotId: string; kind: "copy"; copy: Pick<CopySlot, "text" | "origin" | "factIds" | "qualifiers"> }
  | { slotId: string; kind: "failed"; reason: string };

/** 依次尝试各填充器；全部落空的位置记为 failed（界面仍显示占位，并说明原因）。 */
export async function collectSlotResults(page: ExperiencePage, fillers: PageFillers, ctx: FillContext): Promise<SlotResult[]> {
  const { images, copies } = pageSlots(page);
  const out: SlotResult[] = [];
  for (const slot of images.filter((s) => s.status === "pending")) {
    const providers = fillers.images.filter((p) => p.canFill(slot));
    if (!providers.length) continue;
    let done = false;
    for (const p of providers) {
      try {
        const image = await p.fill(slot, ctx);
        if (image) {
          out.push({ slotId: slot.slotId, kind: "image", image });
          done = true;
          break;
        }
      } catch {
        /* 下一个填充器 */
      }
    }
    if (!done) out.push({ slotId: slot.slotId, kind: "failed", reason: `没有找到合适的图片（${providers.map((p) => p.name).join("、")}）` });
  }
  for (const slot of copies.filter((s) => s.status === "pending")) {
    const providers = fillers.copies.filter((p) => p.canFill(slot));
    if (!providers.length) continue;
    let done = false;
    for (const p of providers) {
      try {
        const copy = await p.fill(slot, ctx);
        if (copy?.text) {
          out.push({ slotId: slot.slotId, kind: "copy", copy });
          done = true;
          break;
        }
      } catch {
        /* 下一个填充器 */
      }
    }
    if (!done) out.push({ slotId: slot.slotId, kind: "failed", reason: `没有生成文案（${providers.map((p) => p.name).join("、")}）` });
  }
  return out;
}

/** 把结果写回页面：只动仍是 pending 的位置。返回是否有改动。 */
export function applySlotResults(page: ExperiencePage, results: SlotResult[], now: string): boolean {
  const { images, copies } = pageSlots(page);
  let changed = false;
  for (const r of results) {
    const img = images.find((s) => s.slotId === r.slotId && s.status === "pending");
    const copy = copies.find((s) => s.slotId === r.slotId && s.status === "pending");
    if (r.kind === "image" && img) {
      img.image = r.image;
      img.status = "filled";
      changed = true;
    } else if (r.kind === "copy" && copy) {
      Object.assign(copy, r.copy, { status: "filled" });
      changed = true;
    } else if (r.kind === "failed" && (img || copy)) {
      if (img) {
        img.status = "failed";
        img.failReason = r.reason;
      }
      if (copy) copy.status = "failed";
      changed = true;
    }
  }
  if (changed) page.updatedAt = now;
  return changed;
}
