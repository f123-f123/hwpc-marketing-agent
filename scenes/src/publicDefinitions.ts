import type { SceneDefinition } from "@hwpc/contracts";

const boundary = {
  kind: "declarative_walkthrough" as const,
  deviceTested: false as const,
  statement: "功能流程演示。场景中的连接与完成均为虚拟状态，不代表具体型号支持或实机测试通过。",
};

/** 服务端注册的声明性版本；旧 DSL 仍用于既有离线演示运行时。 */
export const registeredSceneDefinitions: SceneDefinition[] = [
  {
    sceneId: "phone-pc-file-transfer", version: 1,
    title: "手机到电脑文件传输", summary: "核对支持条件、建立示意连接、授权、发送并检查结果。",
    task: "理解手机到电脑传文件的步骤与失败排查", techTags: ["多屏协同", "文件传输"],
    roles: [
      { roleId: "phone", label: "手机", category: "phone", required: true, requiredFeatures: [] },
      { roleId: "computer", label: "电脑", category: "pc", required: true, requiredFeatures: [] },
    ],
    relations: [{ feature: "file_transfer", roleIds: ["phone", "computer"] }], configSchema: [],
    states: [
      { stateId: "start", label: "等待核对条件", initial: true, terminal: false },
      { stateId: "checked", label: "已核对前置条件", initial: false, terminal: false },
      { stateId: "linked", label: "虚拟连接已建立", initial: false, terminal: false },
      { stateId: "authorized", label: "虚拟授权已确认", initial: false, terminal: false },
      { stateId: "sent", label: "虚拟文件已发送", initial: false, terminal: true },
    ],
    actions: [
      { actionId: "check", label: "核对两端支持范围与空间", from: ["start"], to: "checked", effect: "display_only" },
      { actionId: "connect", label: "建立示意连接", from: ["checked"], to: "linked", effect: "display_only" },
      { actionId: "authorize", label: "确认示意授权", from: ["linked"], to: "authorized", effect: "display_only" },
      { actionId: "send", label: "发送并检查虚拟文件", from: ["authorized"], to: "sent", effect: "display_only" },
      { actionId: "disconnect", label: "断开并重新开始", from: ["linked", "authorized", "sent"], to: "start", effect: "display_only" },
    ],
    outcomes: [{ outcomeId: "walkthrough", label: "流程走完", reachedInState: "sent", kind: "walkthrough", statement: "只走完虚拟传输流程；请用真实设备和文件另行核验。" }],
    evidence: [{ source: { origin: "local", title: "华为计算机一碰传或多屏协同文件传输失败（支持卡 HW-SUPPORT-31）", locator: "P7-常见问题库/07-华为官方支持条目/31-华为计算机一碰传或多屏协同文件传输失败.md" } }],
    knowledgeScope: "pc_knowledge_base", competitionEligible: true, demoBoundary: boundary, isMock: false, rendererKey: "declarative-scene-v1",
  },
  {
    sceneId: "multi-screen-extend", version: 1,
    title: "多屏协同：镜像与扩展", summary: "先核对支持范围，再连接、选模式并观察窗口。",
    task: "理解镜像与扩展的操作差异", techTags: ["多屏协同", "镜像", "扩展屏"],
    roles: [
      { roleId: "computer", label: "电脑", category: "pc", required: true, requiredFeatures: [] },
      { roleId: "display", label: "显示设备", category: "display", required: true, requiredFeatures: [] },
    ],
    relations: [{ feature: "multi_screen", roleIds: ["computer", "display"] }], configSchema: [
      { key: "mode", label: "体验模式", type: "enum", options: [{ value: "mirror", label: "镜像" }, { value: "extend", label: "扩展" }], default: "extend", required: true },
    ],
    states: [
      { stateId: "start", label: "等待核对支持范围", initial: true, terminal: false },
      { stateId: "checked", label: "已核对支持范围", initial: false, terminal: false },
      { stateId: "linked", label: "虚拟连接已建立", initial: false, terminal: false },
      { stateId: "mode_selected", label: "已选择模式", initial: false, terminal: false },
      { stateId: "observed", label: "已观察虚拟结果", initial: false, terminal: true },
    ],
    actions: [
      { actionId: "check", label: "核对两端支持范围", from: ["start"], to: "checked", effect: "display_only" },
      { actionId: "connect", label: "建立示意连接", from: ["checked"], to: "linked", effect: "display_only" },
      { actionId: "select_mode", label: "按配置选择镜像或扩展", from: ["linked"], to: "mode_selected", effect: "display_only" },
      { actionId: "observe", label: "观察两屏虚拟画面", from: ["mode_selected"], to: "observed", effect: "display_only" },
      { actionId: "disconnect", label: "断开并重新开始", from: ["linked", "mode_selected", "observed"], to: "start", effect: "display_only" },
    ],
    outcomes: [{ outcomeId: "walkthrough", label: "流程走完", reachedInState: "observed", kind: "walkthrough", statement: "只观察了虚拟镜像或扩展状态；没有验证真实设备组合。" }],
    evidence: [{ source: { origin: "local", title: "华为Windows电脑与显示器/智慧屏如何连接使用多屏协同（支持卡 HW-SUPPORT-41）", locator: "P7-常见问题库/07-华为官方支持条目/41-华为Windows电脑与显示器-智慧屏如何连接使用多屏协同.md" } }],
    knowledgeScope: "pc_knowledge_base", competitionEligible: true, demoBoundary: boundary, isMock: false, rendererKey: "declarative-scene-v1",
  },
];
