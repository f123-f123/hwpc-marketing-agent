import { z } from "zod";
import { IdSchema, PlatformSchema, PurchaseStageSchema, ScenarioSchema } from "./common.js";
import { ProductRefSchema } from "./product.js";

/**
 * 营销任务输入。字段大多可选，但至少给出 rawRequest、productQuery、productRef 之一。
 * 信息是否足够由工作流判断，不足时返回 ClarificationQuestion（赛题：信息不足时提示补充）。
 */
export const MarketingTaskInputSchema = z
  .object({
    /** 用户原话，如“想买轻薄本”。 */
    rawRequest: z.string().max(2000).optional(),
    /** 产品名/型号文本。 */
    productQuery: z.string().max(200).optional(),
    /** 已确定的型号与配置（来自型号歧义澄清）。 */
    productRef: ProductRefSchema.optional(),
    audience: z.string().max(200).optional(),
    scenario: ScenarioSchema.optional(),
    scenarioNote: z.string().max(500).optional(),
    platform: PlatformSchema.optional(),
    purchaseStage: PurchaseStageSchema.optional(),
    contentGoal: z.string().max(500).optional(),
    /** 额外要求，如“强调续航”“不要提价格”。 */
    extraRequirements: z.string().max(1000).optional(),
  })
  .refine((v) => Boolean(v.rawRequest?.trim() || v.productQuery?.trim() || v.productRef), {
    message: "rawRequest、productQuery、productRef 至少提供一个",
  });
export type MarketingTaskInput = z.infer<typeof MarketingTaskInputSchema>;

/** 任务必要补充信息的字段。 */
export const RequiredFieldSchema = z.enum(["product", "configuration", "audience", "scenario", "platform"]);
export type RequiredField = z.infer<typeof RequiredFieldSchema>;

export const ClarificationKindSchema = z.enum([
  "missing_info",
  "product_ambiguity",
  "configuration_choice",
  "conflict_confirmation",
  "claim_confirmation",
]);
export type ClarificationKind = z.infer<typeof ClarificationKindSchema>;

export const ClarificationQuestionSchema = z.object({
  questionId: IdSchema,
  kind: ClarificationKindSchema,
  /** 对应的任务字段，如 platform；非字段类问题可空。 */
  field: z.string().optional(),
  prompt: z.string().min(1),
  /** 有固定选项时提供；value 回传给 answers。 */
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
  allowFreeText: z.boolean().default(true),
});
export type ClarificationQuestion = z.infer<typeof ClarificationQuestionSchema>;

export const ClarificationAnswerSchema = z.object({
  questionId: IdSchema,
  /** 选项 value 或自由文本。 */
  answer: z.string().min(1).max(1000),
});
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;
