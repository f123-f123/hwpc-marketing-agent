import type { ConversationState } from "./types.js";

/** 输出模式：只有用户明确请求营销输出时才进入 marketing；默认是选购。 */
export type Mode = "shopping" | "marketing";
export const modeOf = (s: ConversationState): Mode => (s.items["outputKind"]?.value === "marketing_article" ? "marketing" : "shopping");

/** 营销专用需求项：选购模式下不要求、不追问。 */
export const MARKETING_ONLY_KEYS = ["platform", "deliveryFormat", "goal", "problem", "mustEmphasize", "mustAvoid", "activity"] as const;
