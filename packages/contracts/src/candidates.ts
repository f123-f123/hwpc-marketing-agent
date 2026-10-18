import { z } from "zod";
import { DataOriginSchema, IdSchema } from "./common.js";
import { EvidenceRefSchema } from "./evidence.js";
import { ProductRefSchema } from "./product.js";

export const CriterionSchema = z.object({
  criterionId: IdSchema,
  /** 对应哪条需求。 */
  needEntryId: IdSchema.optional(),
  text: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).default([]),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const CandidateOverallSchema = z.enum(["fits", "fits_with_compromise", "not_fit", "insufficient_evidence"]);

/**
 * 候选评价。规则：
 * - satisfied 与 compromises 的每一项必须有证据；没有证据只能放进 unknowns。
 * - unmet 中若含硬条件，overall 不能是 fits / fits_with_compromise。
 */
export const CandidateAssessmentSchema = z
  .object({
    candidateId: IdSchema,
    product: ProductRefSchema,
    modelName: z.string().min(1),
    assessedNeedVersion: z.number().int().positive(),
    overall: CandidateOverallSchema,
    satisfied: z.array(CriterionSchema),
    unmet: z.array(CriterionSchema.extend({ hard: z.boolean().default(false) })),
    compromises: z.array(CriterionSchema),
    unknowns: z.array(CriterionSchema),
    /** 为什么选/不选，以及与其他候选相比的理由。 */
    comparisonReason: z.string().min(1),
    comparedWith: z.array(IdSchema).default([]),
    origin: DataOriginSchema,
    isMock: z.boolean(),
  })
  .superRefine((c, ctx) => {
    const need = (list: { evidence: unknown[]; text: string }[], name: string) =>
      list.forEach((x, i) => {
        if (x.evidence.length === 0) ctx.addIssue({ code: "custom", message: `${name}[${i}] 缺少证据，应放入 unknowns`, path: [name, i] });
      });
    need(c.satisfied, "satisfied");
    need(c.compromises, "compromises");
    if (c.unmet.some((u) => u.hard) && (c.overall === "fits" || c.overall === "fits_with_compromise")) {
      ctx.addIssue({ code: "custom", message: "存在未满足的硬条件，overall 不能是 fits / fits_with_compromise", path: ["overall"] });
    }
    if (c.overall === "fits" && (c.unknowns.length > 0 || c.compromises.length > 0)) {
      ctx.addIssue({ code: "custom", message: "有未知项或妥协时不能标为 fits", path: ["overall"] });
    }
  });
export type CandidateAssessment = z.infer<typeof CandidateAssessmentSchema>;
