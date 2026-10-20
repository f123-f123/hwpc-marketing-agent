import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

export const FindingKindSchema = z.enum(["fact", "image", "compliance", "conflict", "style"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const FindingSeveritySchema = z.enum(["blocker", "major", "minor"]);

/** 处理结果：通过 / 删除 / 改写 / 标记保留 / 等待用户确认。 */
export const FindingResolutionSchema = z.enum(["passed", "removed", "rewritten", "flagged", "pending_user"]);
export type FindingResolution = z.infer<typeof FindingResolutionSchema>;

export const VerificationFindingSchema = z.object({
  findingId: IdSchema,
  kind: FindingKindSchema,
  severity: FindingSeveritySchema,
  /** 问题文本（原文引用）。 */
  excerpt: z.string().optional(),
  /** 对应 Article.blocks 下标。 */
  blockIndex: z.number().int().nonnegative().optional(),
  message: z.string().min(1),
  factIds: z.array(IdSchema).default([]),
  imageIds: z.array(IdSchema).default([]),
  resolution: FindingResolutionSchema,
  /** 处理后的文本或说明。 */
  resolutionNote: z.string().optional(),
});
export type VerificationFinding = z.infer<typeof VerificationFindingSchema>;

/**
 * 交付状态：
 * - deliverable：全部通过
 * - deliverable_with_notes：存在已处理/已标记的次要问题，可交付
 * - needs_confirmation：存在待用户确认项，不应直接发布
 * - blocked：资料冲突或严重问题未解决，不得交付
 */
export const DeliveryStatusSchema = z.enum(["deliverable", "deliverable_with_notes", "needs_confirmation", "blocked"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const VerificationReportSchema = z.object({
  findings: z.array(VerificationFindingSchema),
  /** 无法确认、需人工核对的信息（面向用户的句子）。 */
  pendingConfirmations: z.array(z.string()).default([]),
  deliveryStatus: DeliveryStatusSchema,
  checkedAt: IsoDateTimeSchema,
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
