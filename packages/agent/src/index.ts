/**
 * packages/agent —— 需求顾问与智能体工作流入口（Agent B 负责）。
 *
 * 【新定位】面向门店的场景体验与个性化选购智能体。
 * 核心闭环：理解顾客 → 筛选候选并解释取舍 → 安排可操作场景 → 收集明确反馈 → 调整选购方案。
 * 营销软文（赛题图文）降为可选输出：只有用户请求时才要求发布渠道等营销字段。
 *
 * 公开接口：
 *  - Consultant：多轮对话顾问（start / message / confirm / editSummary / generate / revise / ...）
 *  - createWorkflow：契约适配层（即将替换 mock）
 *
 * 依赖通过注入：DataService、ModelService、SceneCatalog（可选）、CapabilityChecker（可选）。
 * 不得直接读环境变量或访问网络。
 *
 * 约束：只改本目录；需要新依赖或契约变更，写 packages/agent/integration-notes.md。
 */
import type { CreateWorkflow } from "@hwpc/contracts";
import { createMockWorkflow } from "@hwpc/fixtures";

export { Consultant } from "./consultant.js";
export type { ConsultantDeps, Reply } from "./consultant.js";
export type { ConversationState, Summary, Confirmation, Artifact, PersonalPlan, SceneInstance, Assessment } from "./types.js";
export type { SceneCatalog, CapabilityChecker, SceneDefinition } from "./types2.js";
export { restoreState } from "./state.js";
export { evaluateGate } from "./gate.js";

/** 占位：目前返回模拟工作流（事件均 simulated=true）。即将替换为适配 Consultant 的实现。 */
export const createWorkflow: CreateWorkflow = (deps) => createMockWorkflow(deps);

// 门店推文
export { generatePostVariants, parseModelJson, templateRaw } from "./content/engine.js";
export type { PostEngineInput, GeneratedVariant } from "./content/engine.js";
export { pickAngles, ANGLES } from "./content/angles.js";
export { excerptGuide, PLATFORM_CRAFT } from "./content/prompt.js";
export { articleText, findCliches, similarity, SIMILARITY_LIMIT } from "./content/style.js";
export { verifyAndRepair, scopeFromState } from "./verify.js";
export type { VerifyScope } from "./verify.js";
export { topicsIn } from "./lexicon.js";
