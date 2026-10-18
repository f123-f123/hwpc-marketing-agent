import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";

/** 选购需求维度。 */
export const NeedKeySchema = z.enum([
  "task", // 实际任务：要用它做什么
  "environment", // 使用环境与频率
  "budget", // 预算（用户自述，不是产品价格事实）
  "existingDevices", // 已有设备
  "requiredSoftware", // 必要软件
  "hardConstraints", // 硬条件：不满足即排除
  "preferences", // 偏好
  "concerns", // 顾虑
]);
export type NeedKey = z.infer<typeof NeedKeySchema>;

/** 关键需求：变化会使已有确认失效、方案过期。其余变化只升版本并提示。 */
export const CRITICAL_NEED_KEYS: readonly NeedKey[] = [
  "task",
  "environment",
  "budget",
  "existingDevices",
  "requiredSoftware",
  "hardConstraints",
];
export const isCriticalNeedKey = (k: NeedKey) => CRITICAL_NEED_KEYS.includes(k);

export const NEED_KEY_LABEL: Record<NeedKey, string> = {
  task: "实际任务",
  environment: "环境与频率",
  budget: "预算",
  existingDevices: "已有设备",
  requiredSoftware: "必要软件",
  hardConstraints: "硬条件",
  preferences: "偏好",
  concerns: "顾虑",
};

/**
 * known：用户本人明确说过（必须带用户原话 quote）；inferred：系统推断；
 * default：系统默认值；pending：已知有此项但内容待确认。
 */
export const NeedStatusSchema = z.enum(["known", "inferred", "default", "pending"]);
export type NeedStatus = z.infer<typeof NeedStatusSchema>;

export const NeedOriginSchema = z.object({
  by: z.enum(["user", "system", "default"]),
  turn: z.number().int().nonnegative(),
  /** 用户原话片段。status=known 时必填，且必须出现在对应用户输入中。 */
  quote: z.string().max(500).optional(),
  note: z.string().max(300).optional(),
});
export type NeedOrigin = z.infer<typeof NeedOriginSchema>;

export const NeedHistoryEntrySchema = z.object({
  value: z.string(),
  status: NeedStatusSchema,
  origin: NeedOriginSchema,
  replacedAtVersion: z.number().int().positive(),
  reason: z.enum(["user_change", "correction", "feedback", "system_revision", "removed"]),
});

export const NeedEntrySchema = z.object({
  entryId: IdSchema,
  key: NeedKeySchema,
  value: z.string().min(1).max(500),
  /** 可选的结构化值，如预算 { max: 6000, currency: "CNY" }。 */
  structured: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  status: NeedStatusSchema,
  /** 硬条件：不满足即排除候选。hardConstraints 下的条目恒为 true。 */
  hard: z.boolean().default(false),
  origin: NeedOriginSchema,
  setAtVersion: z.number().int().positive(),
  history: z.array(NeedHistoryEntrySchema).default([]),
});
export type NeedEntry = z.infer<typeof NeedEntrySchema>;

export const NeedVersionRecordSchema = z.object({
  version: z.number().int().positive(),
  /** 全部条目的指纹。 */
  fingerprint: z.string(),
  /** 仅关键条目的指纹，确认绑定它。 */
  criticalFingerprint: z.string(),
  createdAt: IsoDateTimeSchema,
  reason: z.string(),
  entries: z.array(NeedEntrySchema),
});
export type NeedVersionRecord = z.infer<typeof NeedVersionRecordSchema>;

/** 确认记录：只有 confirm 动作能写入，模型输出和聊天文字都不能产生。 */
export const NeedConfirmationSchema = z.object({
  confirmationId: IdSchema,
  needVersion: z.number().int().positive(),
  fingerprint: z.string(),
  criticalFingerprint: z.string(),
  confirmedAt: IsoDateTimeSchema,
  actor: z.literal("user"),
  channel: z.literal("confirm_action"),
  /** 确认时用户看到并接受的推断/默认/待定条目。 */
  assumptionEntryIds: z.array(IdSchema),
  status: z.enum(["valid", "invalidated"]),
  invalidatedAt: IsoDateTimeSchema.optional(),
  invalidatedReason: z.string().optional(),
  invalidatedByVersion: z.number().int().positive().optional(),
});
export type NeedConfirmation = z.infer<typeof NeedConfirmationSchema>;

export const NeedSummarySchema = z.object({
  needVersion: z.number().int().positive(),
  fingerprint: z.string(),
  criticalFingerprint: z.string(),
  groups: z.array(
    z.object({
      key: NeedKeySchema,
      label: z.string(),
      entries: z.array(z.object({ entryId: IdSchema, value: z.string(), status: NeedStatusSchema, hard: z.boolean() })),
    }),
  ),
  /** 非用户明说的条目（推断/默认/待定），确认时一并被用户看到。 */
  assumptions: z.array(z.object({ entryId: IdSchema, text: z.string(), status: NeedStatusSchema })),
  blockers: z.array(z.string()),
  confirmable: z.boolean(),
  /** 当前有效确认是否已覆盖该摘要。 */
  confirmed: z.boolean(),
});
export type NeedSummary = z.infer<typeof NeedSummarySchema>;
