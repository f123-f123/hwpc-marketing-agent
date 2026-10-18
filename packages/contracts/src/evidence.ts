import { z } from "zod";
import { IdSchema, SourceRefSchema } from "./common.js";

/**
 * 证据引用。任何"满足/支持/可用"的断言都必须带至少一条证据；
 * 没有证据只能表示"未知"，不能表示"满足"。
 */
export const EvidenceRefSchema = z.object({
  factId: IdSchema.optional(),
  source: SourceRefSchema,
  /** 资料原文摘录，不改写。 */
  excerpt: z.string().max(500).optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
