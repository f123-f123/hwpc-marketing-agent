import { and, eq, ne, not, param, st } from "../dsl";
import type { SceneDefinition } from "../types";

/**
 * 场景二：手机与电脑 文件互传（协同）。
 *
 * 设计依据只用于"流程结构与失败分支"：
 *  - HW-SUPPORT-31：记录传输方向、文件类型与大小，以及卡在发现、发送还是接收；小文件成功大文件失败时关注空间与链路稳定。
 *  - 《多设备协同传播边界》：连接、授权、传输、断线恢复；发布前用目标设备完整走一遍。
 * 演示中的"剩余空间不足导致大文件失败"是为说明排查思路设置的虚拟规则，不是真实阈值。
 */
export const fileTransferScene: SceneDefinition = {
  schemaVersion: 1,
  sceneId: "phone-pc-file-transfer",
  version: 1,
  title: "手机与电脑 文件互传（协同）",
  task: "把手机里的文件送到电脑，观察哪些条件会让传输顺利或失败",
  summary: "先确认两端在支持范围内，再连接、授权、选文件并发送；可以调整虚拟条件，观察结果如何变化。",
  demoType: "flow_demo",
  demoBoundary:
    "功能流程演示：在虚拟手机和虚拟电脑上走一遍操作路径。“空间不足时大文件失败”只是用来说明排查思路的虚拟规则，不是真实阈值，也不代表任何型号的实际表现；不包含速度或耗时结论。",
  serves: {
    problemTags: ["手机文件到电脑", "素材流转", "资料交接"],
    techTags: ["文件互传", "多屏协同", "跨设备协同"],
  },
  deviceRoles: [
    { roleId: "phone", label: "手机", kind: "phone" },
    { roleId: "computer", label: "电脑", kind: "computer" },
  ],
  capabilities: [
    { capId: "collab_ready", roleId: "phone", label: "手机在支持范围内", description: "手机的型号、系统与账号条件满足协同传输" },
    { capId: "collab_ready", roleId: "computer", label: "电脑在支持范围内", description: "电脑的系统与电脑管家版本满足协同传输" },
  ],
  simulatedPresets: [
    { presetId: "phone-ok", roleId: "phone", label: "示意手机（在支持范围内）", note: "虚拟设备，不对应任何真实型号", capabilities: { collab_ready: "yes" } },
    { presetId: "phone-out", roleId: "phone", label: "示意手机（不在支持范围）", note: "虚拟设备，用于演示不适用的组合", capabilities: { collab_ready: "no" } },
    { presetId: "pc-ok", roleId: "computer", label: "示意电脑（在支持范围内）", note: "虚拟设备，不对应任何真实型号", capabilities: { collab_ready: "yes" } },
    { presetId: "pc-out", roleId: "computer", label: "示意电脑（不在支持范围）", note: "虚拟设备，用于演示不适用的组合", capabilities: { collab_ready: "no" } },
  ],
  stateVars: [
    { key: "link", label: "协同连接", type: "enum", options: [{ value: "none", label: "未连接" }, { value: "connected", label: "已连接（虚拟）" }], initial: "none" },
    { key: "authorized", label: "已授权传输", type: "bool", initial: false },
    {
      key: "file",
      label: "待发送文件",
      type: "enum",
      options: [
        { value: "none", label: "未选择" },
        { value: "photo_small", label: "图片（较小）" },
        { value: "video_large", label: "视频（较大）" },
        { value: "doc_small", label: "文档（较小）" },
      ],
      initial: "none",
    },
    {
      key: "space",
      label: "电脑剩余空间（虚拟条件）",
      type: "enum",
      options: [{ value: "ample", label: "充足" }, { value: "low", label: "不足" }],
      initial: "ample",
      virtualEnv: true,
    },
    { key: "result", label: "传输结果", type: "enum", options: [{ value: "idle", label: "尚未发送" }, { value: "done", label: "已送达" }, { value: "failed", label: "未完成" }], initial: "idle" },
  ],
  conditions: [
    {
      condId: "c-phone",
      kind: "capability",
      label: "手机在支持范围内",
      role: "phone",
      cap: "collab_ready",
      onUnmet: { missing: "这台手机不在协同传输的支持范围内", nextStep: "改用其他传输方式（例如数据线或通用文件分享），并以官方页面为准" },
      onUnknown: { missing: "资料还没有证实这台手机在支持范围内", nextStep: "等待资料证据补充，或先选用虚拟示意设备体验流程" },
    },
    {
      condId: "c-pc",
      kind: "capability",
      label: "电脑在支持范围内",
      role: "computer",
      cap: "collab_ready",
      onUnmet: { missing: "这台电脑不在协同传输的支持范围内", nextStep: "改用其他传输方式，并先核对电脑的系统与电脑管家版本" },
      onUnknown: { missing: "资料还没有证实这台电脑在支持范围内", nextStep: "等待资料证据补充，或先选用虚拟示意设备体验流程" },
    },
    { condId: "c-link", kind: "state", label: "已建立协同连接", expr: eq(st("link"), "connected"), onUnmet: { missing: "还没有建立协同连接", nextStep: "先执行“建立协同连接”" } },
    { condId: "c-auth", kind: "state", label: "已授权传输", expr: eq(st("authorized"), true), onUnmet: { missing: "还没有授权传输", nextStep: "先执行“确认授权”" } },
    { condId: "c-file", kind: "state", label: "已选择文件", expr: ne(st("file"), "none"), onUnmet: { missing: "还没有选择要发送的文件", nextStep: "先选择一个文件" } },
  ],
  actions: [
    {
      actionId: "connect",
      label: "建立协同连接",
      guard: ne(st("link"), "connected"),
      blockedReason: "连接已经建立",
      effects: [{ key: "link", value: "connected" }],
      feedback: [{ tone: "info", text: "虚拟手机与虚拟电脑之间建立了示意连接。真实设备需要按官方页面完成发现与授权。" }],
    },
    {
      actionId: "authorize",
      label: "确认授权",
      requires: ["c-link"],
      guard: eq(st("authorized"), false),
      blockedReason: "已经授权",
      effects: [{ key: "authorized", value: true }],
      feedback: [{ tone: "info", text: "已授权传输。用完之后记得撤销不再需要的权限。" }],
    },
    {
      actionId: "pick_file",
      label: "选择要发送的文件",
      options: [{ value: "photo_small", label: "图片（较小）" }, { value: "video_large", label: "视频（较大）" }, { value: "doc_small", label: "文档（较小）" }],
      effects: [{ key: "file", value: param }, { key: "result", value: "idle" }],
      feedback: [{ tone: "info", text: "已选择文件。可以先看看“电脑剩余空间”这个虚拟条件，再发送。" }],
    },
    {
      actionId: "set_space",
      label: "调整电脑剩余空间（虚拟条件）",
      hint: "改变条件，观察同一个文件的结果会怎样变化",
      options: [{ value: "ample", label: "充足" }, { value: "low", label: "不足" }],
      effects: [{ key: "space", value: param }, { key: "result", value: "idle" }],
      feedback: [{ tone: "info", text: "虚拟条件已调整；之前的传输结果已清空，请重新发送。" }],
    },
    {
      actionId: "send",
      label: "发送",
      requires: ["c-auth", "c-file"],
      effects: [
        { key: "result", value: "failed", when: and(eq(st("file"), "video_large"), eq(st("space"), "low")) },
        { key: "result", value: "done", when: not(and(eq(st("file"), "video_large"), eq(st("space"), "low"))) },
      ],
      feedback: [
        { when: eq(st("result"), "done"), tone: "success", text: "文件在虚拟设备上送达。真实使用时请确认文件完整、可以打开、大小一致。" },
        { when: eq(st("result"), "failed"), tone: "error", text: "传输没有完成：这次演示里，较大的文件遇到了不足的电脑剩余空间。" },
      ],
    },
    {
      actionId: "disconnect",
      label: "断开连接",
      hint: "体验断线之后的状态",
      guard: eq(st("link"), "connected"),
      blockedReason: "当前没有连接",
      effects: [{ key: "link", value: "none" }, { key: "authorized", value: false }, { key: "result", value: "idle" }],
      feedback: [{ tone: "warn", text: "连接已断开，授权也已失效。要继续传输，需要重新连接并重新授权。" }],
    },
  ],
  steps: [
    { stepId: "s-link", label: "建立协同连接", doneWhen: eq(st("link"), "connected") },
    { stepId: "s-auth", label: "确认授权", doneWhen: eq(st("authorized"), true) },
    { stepId: "s-file", label: "选择文件", doneWhen: ne(st("file"), "none") },
    { stepId: "s-send", label: "发送并确认结果", doneWhen: ne(st("result"), "idle") },
  ],
  stage: {
    screens: [
      {
        screenId: "phone",
        label: "手机（虚拟）",
        role: "phone",
        items: [
          { itemId: "p-none", label: "还没有选择文件", when: eq(st("file"), "none") },
          { itemId: "p-photo", label: "待发送：图片（较小）", when: eq(st("file"), "photo_small"), tone: "active" },
          { itemId: "p-video", label: "待发送：视频（较大）", when: eq(st("file"), "video_large"), tone: "active" },
          { itemId: "p-doc", label: "待发送：文档（较小）", when: eq(st("file"), "doc_small"), tone: "active" },
          { itemId: "p-link", label: "协同连接：未连接", when: eq(st("link"), "none"), tone: "warn" },
          { itemId: "p-link-on", label: "协同连接：已连接（虚拟）", when: eq(st("link"), "connected") },
        ],
      },
      {
        screenId: "pc",
        label: "电脑（虚拟）",
        role: "computer",
        items: [
          { itemId: "c-space-ample", label: "剩余空间（虚拟条件）：充足", when: eq(st("space"), "ample") },
          { itemId: "c-space-low", label: "剩余空间（虚拟条件）：不足", when: eq(st("space"), "low"), tone: "warn" },
          { itemId: "c-idle", label: "尚未收到文件", when: eq(st("result"), "idle") },
          { itemId: "c-done", label: "已收到文件", when: eq(st("result"), "done"), tone: "active" },
          { itemId: "c-failed", label: "文件没有传完", when: eq(st("result"), "failed"), tone: "warn" },
        ],
      },
    ],
  },
  completion: {
    outcomeId: "done",
    when: eq(st("result"), "done"),
    title: "这一遍流程走完了",
    text: "在虚拟设备上完成了：连接 → 授权 → 选文件 → 发送 → 确认结果。这只是流程演示，不代表任何型号的真实表现。",
    nextSteps: ["可以换成较大的文件，并把电脑剩余空间调成“不足”，看看会发生什么", "回到方案，对照候选产品的资料判断是否适合你"],
  },
  failures: [
    {
      outcomeId: "f-space",
      when: eq(st("result"), "failed"),
      title: "传输没有完成（演示中的虚拟条件）",
      text: "这个演示里，较大的文件遇到了不足的电脑剩余空间。真实设备上的原因需要逐项排查，这里的规则不是真实阈值。",
      nextSteps: ["记录传输方向、文件类型与大小，以及卡在发现、发送还是接收", "查看两端的剩余空间", "把“电脑剩余空间”调回充足后重新发送，观察结果变化"],
    },
  ],
  realWorldChecklist: [
    "打开当前官方页面，核对支持的型号、系统版本与完整步骤",
    "用真实文件确认到达的文件完整、可以打开、大小一致",
    "连续传输几次，确认没有卡住",
    "用完之后撤销不再需要的连接与权限",
  ],
  designBasis: [
    {
      basisId: "hw-support-31",
      title: "华为计算机一碰传或多屏协同文件传输失败（支持卡 HW-SUPPORT-31）",
      origin: "local",
      locator: "P7-常见问题库/07-华为官方支持条目/31-华为计算机一碰传或多屏协同文件传输失败.md",
      supports: "失败分支的排查线索（方向、文件类型与大小、两端空间）与结果验证项",
      note: "资料库整理稿，摘要自官方页面；执行前须复核官方原文，不包含真实阈值",
    },
    {
      basisId: "collab-boundary",
      title: "多设备协同传播边界",
      origin: "local",
      locator: "P6-营销素材库/05-多屏协同/多设备协同传播边界.md",
      supports: "连接、授权、传输、断线的流程结构，以及不把一组组合外推到所有设备",
    },
  ],
  genericModule: false,
  assets: [
    { assetId: "css-stage", kind: "generated_css", usage: "手机与电脑的状态示意", origin: "本项目程序生成", isProductImage: false },
  ],
  persistence: { stateVersion: 1, savedKeys: ["link", "authorized", "file", "space", "result"], accepts: [] },
};
