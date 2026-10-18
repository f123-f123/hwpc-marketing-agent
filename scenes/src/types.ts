/**
 * 场景模块的声明性定义与运行时数据类型。
 *
 * 状态：提案。公共 schema、服务端注册接口和持久化由主 Agent 负责；
 * 这些类型只依赖 JSON 可序列化的数据，便于主 Agent 迁入 packages/contracts（见 apps/web/integration-notes.md）。
 *
 * 原则：
 *  - 场景代码在开发时编写并注册；生成个人方案时只"选择模块 + 传入合法配置"，不由模型现场生成场景代码。
 *  - 产品事实不写在场景里。设备能力（capability）的取值由配置传入，并必须绑定证据；缺证据即 unknown。
 *  - 场景里没有任何时长字段：状态只因用户操作改变，动画/等待不表达真实设备延迟。
 */

/* ------------------------------ 演示边界 ------------------------------ */

/**
 * 演示类型（边界必须在界面与导出里一致呈现）：
 *  - flow_demo：功能流程演示（虚拟设备上走一遍操作路径）
 *  - principle_illustration：原理/参数示意
 *  - measured_test：实机测试（需要实测记录作为证据；当前版本没有任何场景可声明它）
 */
export type DemoType = "flow_demo" | "principle_illustration" | "measured_test";

/* ------------------------------ 表达式 ------------------------------ */

/** JSON 可序列化的条件表达式，不使用 eval。 */
export type Expr =
  | boolean
  | number
  | string
  | null
  | { ref: string }
  | { op: "eq" | "ne" | "and" | "or" | "not" | "in" | "gt" | "lt"; args: Expr[] };

/* ------------------------------ 证据 ------------------------------ */

/**
 * 证据层级（来自知识库《多设备协同传播边界》）：
 *  1 官方产品/功能页；2 官方支持页；3 目标设备实测；4 场景图片（不证明兼容）；guidance 内部指引（不证明功能）。
 * 只有 official_feature_page / official_support_page / device_test 可以把设备能力标为 yes/no。
 */
export type EvidenceLevel = "official_feature_page" | "official_support_page" | "device_test" | "scene_art" | "guidance";
export const CAPABILITY_EVIDENCE_LEVELS: readonly EvidenceLevel[] = ["official_feature_page", "official_support_page", "device_test"];

export interface EvidenceItem {
  evidenceId: string;
  level: EvidenceLevel;
  title: string;
  /** project：本项目自制的示意素材，不是资料库内容。 */
  origin: "local" | "ima" | "mock" | "project";
  locator: string;
  /** 该证据支持的陈述（面向用户的一句话）。 */
  statement?: string;
  capturedAt?: string;
}

/* ------------------------------ 设备 ------------------------------ */

export type CapabilityValue = "yes" | "no" | "unknown";

export interface DeviceBinding {
  bindingId: string;
  roleId: string;
  label: string;
  /** simulated：虚拟示意设备，不对应任何真实型号；product：来自候选产品，能力必须有证据。 */
  source: "simulated" | "product";
  /** simulated 必填：必须对应定义中的 simulatedPresets，能力值与预设一致。 */
  presetId?: string;
  productRef?: { productId: string; configurationId?: string };
  capabilities: Record<string, { value: CapabilityValue; evidenceIds: string[] }>;
}

export interface DeviceRole {
  roleId: string;
  label: string;
  kind: "computer" | "display" | "phone" | "tablet";
}

export interface CapabilityDecl {
  capId: string;
  roleId: string;
  label: string;
  description: string;
}

export interface SimulatedPreset {
  presetId: string;
  roleId: string;
  label: string;
  note: string;
  capabilities: Record<string, "yes" | "no">;
}

/* ------------------------------ 状态与动作 ------------------------------ */

export interface StateVar {
  key: string;
  label: string;
  type: "enum" | "bool";
  options?: { value: string; label: string }[];
  initial: string | boolean;
  /** 虚拟环境量：只存在于演示里，不是对真实设备的断言。 */
  virtualEnv?: boolean;
}

export type Condition =
  | {
      condId: string;
      kind: "capability";
      label: string;
      role: string;
      cap: string;
      onUnmet: { missing: string; nextStep: string };
      onUnknown: { missing: string; nextStep: string };
    }
  | {
      condId: string;
      kind: "state";
      label: string;
      expr: Expr;
      onUnmet: { missing: string; nextStep: string };
    };

export interface Effect {
  key: string;
  /** 字面量，或 { ref: "param" } 取动作参数。 */
  value: Expr;
  when?: Expr;
}

export interface FeedbackRule {
  when?: Expr;
  tone: "info" | "success" | "warn" | "error";
  text: string;
}

export interface ActionDef {
  actionId: string;
  label: string;
  hint?: string;
  /** 可选参数：选项型动作。 */
  options?: { value: string; label: string }[];
  /** 必须满足的状态类条件。设备能力类条件由引擎统一强制，无需（也不应）在此重复。 */
  requires?: string[];
  guard?: Expr;
  blockedReason?: string;
  effects: Effect[];
  feedback: FeedbackRule[];
}

export interface StepDef {
  stepId: string;
  label: string;
  doneWhen: Expr;
}

export interface StageScreen {
  screenId: string;
  label: string;
  role?: string;
  items: { itemId: string; label: string; when: Expr; tone?: "neutral" | "active" | "warn" }[];
  notes?: { when: Expr; text: string }[];
}

export interface OutcomeDef {
  outcomeId: string;
  when: Expr;
  title: string;
  text: string;
  nextSteps?: string[];
}

export interface DesignBasis {
  basisId: string;
  title: string;
  origin: "local" | "ima";
  locator: string;
  /** 该资料支持场景里的哪一部分设计（流程结构、失败分支、条件项）。不是产品功能结论。 */
  supports: string;
  note?: string;
}

export interface AssetDecl {
  assetId: string;
  kind: "generated_css" | "generated_svg" | "product_image";
  usage: string;
  origin: string;
  /** 示意素材不得被称为产品图片。 */
  isProductImage: boolean;
}

export interface SceneDefinition {
  schemaVersion: 1;
  sceneId: string;
  version: number;
  title: string;
  task: string;
  summary: string;
  demoType: DemoType;
  demoBoundary: string;
  serves: { problemTags: string[]; techTags: string[] };
  deviceRoles: DeviceRole[];
  capabilities: CapabilityDecl[];
  simulatedPresets: SimulatedPreset[];
  stateVars: StateVar[];
  conditions: Condition[];
  actions: ActionDef[];
  steps: StepDef[];
  stage: { screens: StageScreen[] };
  completion: OutcomeDef;
  failures: OutcomeDef[];
  /** 完成时给用户的"真实使用时请自行核验"清单（来自资料，不是本场景的断言）。 */
  realWorldChecklist: string[];
  designBasis: DesignBasis[];
  /** 没有 designBasis 时必须为 true，并在标题里标明"通用"。 */
  genericModule: boolean;
  assets: AssetDecl[];
  persistence: {
    stateVersion: number;
    savedKeys: string[];
    /** 可无损恢复的旧 stateVersion 列表。不在其中的保存记录不会被静默套用。 */
    accepts: number[];
  };
}

/* ------------------------------ 配置与运行 ------------------------------ */

/** B 选择场景后传入的合法配置。 */
export interface SceneConfig {
  sceneId: string;
  sceneVersion: number;
  bindings: DeviceBinding[];
  evidence: EvidenceItem[];
  /** 初始虚拟环境值（可选）。 */
  initial?: Record<string, string | boolean>;
}

export type HistoryEntry =
  | { type: "bind"; roleId: string; bindingId: string }
  | { type: "act"; actionId: string; param?: string };

export interface SceneRun {
  bindings: Record<string, string>;
  state: Record<string, string | boolean>;
  history: HistoryEntry[];
  /** 最近一次操作产生的反馈（由重放得到，不单独保存）。 */
  lastFeedback: { tone: string; text: string }[];
}

/** 可保存的进度。只保存历史与版本；状态由重放得到，不能被手工改成"已完成"。 */
export interface SavedRun {
  sceneId: string;
  sceneVersion: number;
  stateVersion: number;
  history: HistoryEntry[];
  updatedAt: string;
}

export type ApplicabilityKind = "pending" | "applicable" | "not_applicable" | "unverified";
export type ConditionStatus = "met" | "unmet" | "unknown" | "pending";
export type OutcomeKind = "in_progress" | "completed" | "failed" | "not_applicable" | "unverified" | "pending";

export interface ViewAction {
  actionId: string;
  label: string;
  hint?: string;
  options?: { value: string; label: string }[];
  enabled: boolean;
  /** 不可用时的原因与下一步。 */
  blocked?: { reason: string; nextStep?: string };
}

export interface SceneView {
  sceneId: string;
  version: number;
  title: string;
  task: string;
  demo: { type: DemoType; label: string; boundary: string; virtualOnly: boolean; scopeNote: string };
  roles: {
    roleId: string;
    label: string;
    chosen?: string;
    options: { bindingId: string; label: string; source: "simulated" | "product"; sourceLabel: string; caps: { capId: string; label: string; value: CapabilityValue; evidenceTitles: string[] }[] }[];
  }[];
  conditions: { condId: string; label: string; kind: "capability" | "state"; status: ConditionStatus; missing?: string; nextStep?: string; evidenceTitles?: string[] }[];
  applicability: { kind: ApplicabilityKind; reasons: string[]; nextSteps: string[] };
  steps: { stepId: string; label: string; done: boolean }[];
  actions: ViewAction[];
  stage: { screens: { screenId: string; label: string; items: { itemId: string; label: string; tone: string }[]; notes: string[] }[] };
  env: { key: string; label: string; value: string }[];
  outcome: { kind: OutcomeKind; title: string; text: string; nextSteps: string[]; checklist: string[] };
  feedback: { tone: string; text: string }[];
  sources: { designBasis: DesignBasis[]; evidence: EvidenceItem[]; assets: AssetDecl[] };
}

/* ------------------------------ 空间（全景）------------------------------ */

export interface Hotspot {
  hotspotId: string;
  label: string;
  hint: string;
  /** 水平角（度），0 为初始朝向，向右为正。 */
  yaw: number;
  /** 俯仰角（度），向上为正。 */
  pitch: number;
  icon: "display" | "phone" | "compare" | "plan";
  target: { type: "scene"; sceneId: string } | { type: "activity"; activity: "compare" | "plan" };
}

export interface SpaceDefinition {
  spaceId: string;
  version: number;
  title: string;
  /** generated_illustration：程序生成的示意空间，不是真实门店或实机画面。 */
  kind: "generated_illustration";
  notice: string;
  hotspots: Hotspot[];
  assets: AssetDecl[];
}

/* ------------------------------ 个人方案里的体验与反馈 ------------------------------ */

export type FeedbackKind = "not_understood" | "steps_unsuitable" | "device_unmet" | "compare_other" | "change_preference";

export const FEEDBACK_LABEL: Record<FeedbackKind, string> = {
  not_understood: "我仍然不理解",
  steps_unsuitable: "这些操作步骤不适合我",
  device_unmet: "我已有的设备不满足条件",
  compare_other: "想比较另一款候选",
  change_preference: "我想改变某项偏好",
};

/** 发给后端的结构化反馈。不含点击次数或完成度之类的推断量，是否改变推荐由后端（B）判断。 */
export interface FeedbackEvent {
  feedbackId: string;
  kind: FeedbackKind;
  planId: string;
  planVersion: number;
  experienceId: string;
  sceneId: string;
  sceneVersion: number;
  /** 反馈时所在步骤与结果，仅作定位。 */
  context: { outcomeKind: OutcomeKind; boundDevices: Record<string, string> };
  note?: string;
  at: string;
}
