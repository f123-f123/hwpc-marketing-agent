/**
 * 模拟场景定义（MOCK）。
 * 用于联调与测试；证据均为 mock，场景内容为虚构演示，不代表真实华为设备功能。
 * 真实场景由 Agent C 在 code/scenes 维护，经服务端注册表校验后加载。
 */
import { SceneDefinitionSchema, type EvidenceRef, type SceneDefinition } from "@hwpc/contracts";

const ev = (title: string, locator: string): EvidenceRef => ({
  factId: "mock-f-003",
  source: { origin: "mock", title: `【MOCK】${title}`, locator: `mock://${locator}`, capturedAt: "2000-01-01" },
  excerpt: "【MOCK】虚构资料摘录",
});

const boundary = {
  kind: "declarative_walkthrough" as const,
  deviceTested: false as const,
  statement: "这是按资料编写的流程演示。看完流程不代表在真实设备上测试通过。",
};

/** 通勤一天（单设备，PC）v1。 */
const commuteV1 = {
  sceneId: "mock-commute-day",
  version: 1,
  title: "【MOCK】通勤一天",
  summary: "按一天的行程走一遍携带与续航（模拟场景）",
  task: "经常携带电脑出行办公",
  techTags: ["portability", "battery"],
  roles: [{ roleId: "laptop", label: "电脑", category: "pc", required: true, requiredFeatures: ["all_day_battery"] }],
  relations: [],
  configSchema: [
    { type: "enum", key: "commuteMode", label: "通勤方式", required: false, options: [{ value: "metro", label: "地铁" }, { value: "car", label: "开车" }], default: "metro" },
    { type: "number", key: "hoursOutside", label: "在外时长（小时）", required: false, min: 1, max: 12, default: 4 },
  ],
  states: [
    { stateId: "morning", label: "早高峰", initial: true, terminal: false },
    { stateId: "meeting", label: "会议室", initial: false, terminal: false },
    { stateId: "evening", label: "傍晚收工", initial: false, terminal: true },
  ],
  actions: [
    { actionId: "go_meeting", label: "到公司开会", from: ["morning"], to: "meeting", effect: "display_only" },
    { actionId: "wrap_up", label: "收工回家", from: ["meeting"], to: "evening", effect: "display_only" },
  ],
  outcomes: [{ outcomeId: "day_walkthrough", label: "走完一天", reachedInState: "evening", kind: "walkthrough", statement: "看完了通勤一天的流程演示" }],
  evidence: [ev("示例本 Air 14 续航与重量", "mock-air-14/facts.md")],
  knowledgeScope: "pc_knowledge_base",
  competitionEligible: true,
  demoBoundary: boundary,
  isMock: true,
  rendererKey: "timeline",
};

/** 通勤一天 v2：新增一个状态（升级用于测试版本锁定与迁移）。 */
const commuteV2 = {
  ...commuteV1,
  version: 2,
  summary: "按一天的行程走一遍携带、续航与咖啡厅办公（模拟场景 v2）",
  states: [
    { stateId: "morning", label: "早高峰", initial: true, terminal: false },
    { stateId: "meeting", label: "会议室", initial: false, terminal: false },
    { stateId: "cafe", label: "咖啡厅", initial: false, terminal: false },
    { stateId: "evening", label: "傍晚收工", initial: false, terminal: true },
  ],
  actions: [
    { actionId: "go_meeting", label: "到公司开会", from: ["morning"], to: "meeting", effect: "display_only" },
    { actionId: "go_cafe", label: "去咖啡厅", from: ["meeting"], to: "cafe", effect: "display_only" },
    { actionId: "wrap_up", label: "收工回家", from: ["meeting", "cafe"], to: "evening", effect: "display_only" },
  ],
  changeNote: "新增“咖啡厅”状态；原流程保持可达",
};

/** 多屏协同（PC + 手机），不在 PC 知识库范围内。 */
const collab = {
  sceneId: "mock-screen-collab",
  version: 1,
  title: "【MOCK】手机与电脑协同",
  summary: "手机与电脑互相传文件、接力工作（模拟场景）",
  task: "手机和电脑之间传递内容",
  techTags: ["multi_device", "collaboration"],
  roles: [
    { roleId: "laptop", label: "电脑", category: "pc", required: true, requiredFeatures: ["multi_screen_collab"] },
    { roleId: "phone", label: "手机", category: "phone", required: true, requiredFeatures: ["multi_screen_collab"] },
  ],
  relations: [{ feature: "multi_screen_collab", roleIds: ["laptop", "phone"] }],
  configSchema: [{ type: "enum", key: "content", label: "传递内容", required: false, options: [{ value: "photo", label: "照片" }, { value: "doc", label: "文档" }], default: "photo" }],
  states: [
    { stateId: "idle", label: "两台设备就位", initial: true, terminal: false },
    { stateId: "connected", label: "已连接", initial: false, terminal: false },
    { stateId: "done", label: "传递完成", initial: false, terminal: true },
  ],
  actions: [
    { actionId: "connect", label: "连接", from: ["idle"], to: "connected", effect: "display_only" },
    { actionId: "send", label: "发送内容", from: ["connected"], to: "done", effect: "display_only" },
  ],
  outcomes: [{ outcomeId: "transferred", label: "走完传递流程", reachedInState: "done", kind: "walkthrough", statement: "看完了协同传递的流程演示" }],
  evidence: [ev("虚构的多设备协同说明", "mock-collab/notes.md")],
  knowledgeScope: "outside_pc_knowledge_base",
  competitionEligible: false,
  demoBoundary: boundary,
  isMock: true,
  rendererKey: "steps",
};

export const mockSceneDefinitions: SceneDefinition[] = [commuteV1, commuteV2, collab].map((d) => SceneDefinitionSchema.parse(d));

export const MOCK_SCENE_IDS = {
  commute: "mock-commute-day",
  collab: "mock-screen-collab",
} as const;
