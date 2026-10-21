import { z } from "zod";
import { IdSchema, PlatformSchema } from "./common.js";

export const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  heading: z.string().optional(),
  text: z.string().min(1),
  /** 本段所依据的事实。含产品事实的段落必须绑定；纯引导/过渡语可为空。 */
  factIds: z.array(IdSchema).default([]),
  /**
   * 本段所用事实的限制条件（资料原文），紧跟在本段之后以小字展示，不塞进句子中间。
   * 同一条限制条件在全文只出现一次（首次引用处）。
   */
  notes: z.array(z.string()).optional(),
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
  /** 备选标题（导购可以换用）。 */
  altTitles: z.array(z.string()).optional(),
  /** 封面大字：小红书首图、门店海报上叠加的短句，可含换行。 */
  coverText: z.string().optional(),
  lead: z.string().optional(),
  blocks: z.array(ArticleBlockSchema).min(1),
  callToAction: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type Article = z.infer<typeof ArticleSchema>;
