import { z } from "zod";
import { IdSchema, PlatformSchema } from "./common.js";

export const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  heading: z.string().optional(),
  text: z.string().min(1),
  /** 本段所依据的事实。含产品事实的段落必须绑定；纯引导/过渡语可为空。 */
  factIds: z.array(IdSchema).default([]),
});

export const ImageBlockSchema = z.object({
  type: z.literal("image"),
  imageId: IdSchema,
  /** 展示给读者的图片说明。 */
  caption: z.string().min(1),
  /** 为何放在此处（赛题：说明插入位置）。 */
  placementReason: z.string().min(1),
});

export const ArticleBlockSchema = z.discriminatedUnion("type", [ParagraphBlockSchema, ImageBlockSchema]);
export type ArticleBlock = z.infer<typeof ArticleBlockSchema>;

/** 结构化图文结果。blocks 的顺序即阅读与插图顺序。 */
export const ArticleSchema = z.object({
  platform: PlatformSchema,
  title: z.string().min(1),
  lead: z.string().optional(),
  blocks: z.array(ArticleBlockSchema).min(1),
  callToAction: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type Article = z.infer<typeof ArticleSchema>;
