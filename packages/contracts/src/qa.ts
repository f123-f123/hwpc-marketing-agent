import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import type { NeedEntry } from "./needs.js";
import type { ExperiencePage } from "./page.js";
import type { PersonalPlan } from "./plan.js";
import type { DataService } from "./services.js";

/**
 * 答疑智能体：用户在体验页里侧边提问时使用，和“需求沟通 / 生成页面”的顾问引擎是两个独立的智能体。
 *
 * 它只能回答，不能修改：接口里没有需求编辑、确认、方案或页面的写入口，服务端也只记录问答。
 * 如果用户的问题实际上是在改需求（换预算、加硬条件……），它只能提示“回到需求沟通”，由用户自己去改。
 */

export const QaCitationSchema = z.object({
  title: z.string().min(1),
  locator: z.string().optional(),
  quote: z.string().optional(),
});
export type QaCitation = z.infer<typeof QaCitationSchema>;

export const QaAnswerSchema = z.object({
  reply: z.string().min(1).max(2000),
  citations: z.array(QaCitationSchema).default([]),
  /** 问题涉及改变需求：界面显示“回到需求沟通”，页面本身不变。 */
  suggestNeedChange: z.boolean().default(false),
});
export type QaAnswer = z.infer<typeof QaAnswerSchema>;
/** 引擎返回值：带默认值的字段可以省略，服务端解析补齐。 */
export type QaAnswerInput = z.input<typeof QaAnswerSchema>;

export const QaTurnSchema = z.object({
  turnId: IdSchema,
  at: IsoDateTimeSchema,
  /** 提问时看的是哪个方案版本的页面。 */
  planVersion: z.number().int().positive(),
  question: z.string().min(1).max(1000),
  reply: z.string(),
  citations: z.array(QaCitationSchema).default([]),
  suggestNeedChange: z.boolean().default(false),
  isMock: z.boolean(),
  failed: z.boolean().default(false),
});
export type QaTurn = z.infer<typeof QaTurnSchema>;

/** 答疑引擎看到的只读视图。 */
export interface QaView {
  page: ExperiencePage;
  plan: PersonalPlan;
  needs: NeedEntry[];
  /** 最近几轮问答（时间正序）。 */
  history: { question: string; reply: string }[];
}

export interface QaDeps {
  data: DataService;
  signal?: AbortSignal;
}

export interface QaEngine {
  readonly isMock: boolean;
  answer(view: QaView, question: string, deps: QaDeps): Promise<QaAnswerInput>;
}
