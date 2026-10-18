import { z } from "zod";

export const REQ_KEYS = [
  // 选购需求
  "tasks", // 实际任务
  "environment", // 使用环境
  "frequency", // 使用频率
  "budget", // 预算
  "existingDevices", // 已有设备
  "requiredSoftware", // 必要软件
  "hardConstraints", // 硬条件
  "unacceptable", // 不可接受项
  "preferences", // 偏好（可妥协）
  "techQuestions", // 技术疑问
  "concerns", // 顾虑
  // 人群与产品范围
  "audience",
  "scenario",
  "productScope",
  // 输出请求（只有用户要营销输出时才需要下面这些）
  "outputKind",
  "problem",
  "goal",
  "platform",
  "deliveryFormat",
  "mustEmphasize",
  "mustAvoid",
  "activity",
  "styleNotes",
] as const;
export const ReqKeySchema = z.enum(REQ_KEYS);
export type ReqKey = z.infer<typeof ReqKeySchema>;

/**
 * 范围类需求：变化会改变候选、硬条件或交付形态，需要重新检索并重新确认（计入指纹）。
 * 细化类需求：只改变排序、解释或场景安排，不要求重新确认（不计入指纹，但会记入方案的“确认后细化”）。
 */
export const SCOPE_KEYS: readonly ReqKey[] = [
  "tasks", "budget", "requiredSoftware", "hardConstraints", "unacceptable",
  "audience", "scenario", "productScope", "outputKind",
  "problem", "goal", "platform", "deliveryFormat", "mustEmphasize", "mustAvoid", "activity",
];
export const REFINE_KEYS: readonly ReqKey[] = ["environment", "frequency", "existingDevices", "preferences", "techQuestions", "concerns", "styleNotes"];
export const CRITICAL_KEYS = SCOPE_KEYS;
export const isCriticalKey = (k: ReqKey) => SCOPE_KEYS.includes(k);
export const isRefineKey = (k: ReqKey) => REFINE_KEYS.includes(k);
/** 同一时刻只能有一个值的键；其余键允许累积多个值。 */
export const SINGLE_VALUE_KEYS: readonly ReqKey[] = ["audience", "scenario", "platform", "deliveryFormat", "productScope", "outputKind", "budget", "frequency"];

export const OutputKindSchema = z.enum(["personal_plan", "marketing_article", "report"]);
export type OutputKind = z.infer<typeof OutputKindSchema>;

