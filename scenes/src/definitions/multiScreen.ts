import { and, eq, ne, or, param, st } from "../dsl";
import type { SceneDefinition } from "../types";

/**
 * 场景一：显示器 / 智慧屏 多屏协同（镜像与扩展）。
 *
 * 设计依据只用于"流程结构与失败分支"，不是产品功能结论：
 *  - HW-SUPPORT-41：先核对支持性，再讨论镜像或扩展；不在支持范围时改用普通显示连接方案。
 *  - 《多设备协同传播边界》：协同内容要写清参与设备与前提；演示要包含断线与恢复；不得把某一组合外推到所有设备。
 * 具体哪些型号支持，本定义不写；由 A 的证据绑定到设备能力后决定。
 */
export const multiScreenScene: SceneDefinition = {
  schemaVersion: 1,
  sceneId: "multi-screen-extend",
  version: 1,
  title: "显示器 / 智慧屏 多屏协同：镜像与扩展",
  task: "把电脑画面送到更大的屏幕，选择镜像或扩展，并确认是否生效",
  summary: "先核对设备是否在支持范围内，再建立连接、选择镜像或扩展，最后验证窗口是否按预期出现。",
  demoType: "flow_demo",
  demoBoundary:
    "功能流程演示：在虚拟电脑和虚拟显示设备上走一遍操作路径。不是原理/参数示意，更不是实机测试；不代表任何具体型号的实际表现，不包含速度、延迟或画质结论。",
  serves: {
    problemTags: ["双屏办公", "大屏显示", "会议演示"],
    techTags: ["多屏协同", "镜像", "扩展屏"],
  },
  deviceRoles: [
    { roleId: "computer", label: "电脑", kind: "computer" },
    { roleId: "display", label: "显示器 / 智慧屏", kind: "display" },
  ],
  capabilities: [
    { capId: "in_scope", roleId: "computer", label: "电脑在支持范围内", description: "系统与产品类型满足多屏协同的适用范围（资料：Windows 10/11，台式机或笔记本）" },
    { capId: "collab_listed", roleId: "display", label: "显示设备在多屏协同支持列表内", description: "并非所有显示器 / 智慧屏都支持多屏协同，需在支持列表内" },
  ],
  simulatedPresets: [
    { presetId: "pc-ok", roleId: "computer", label: "示意电脑（在支持范围内）", note: "虚拟设备，不对应任何真实型号", capabilities: { in_scope: "yes" } },
    { presetId: "pc-out", roleId: "computer", label: "示意电脑（不在支持范围，例如系统不符）", note: "虚拟设备，用于演示不适用的组合", capabilities: { in_scope: "no" } },
    { presetId: "disp-ok", roleId: "display", label: "示意显示设备（在支持列表内）", note: "虚拟设备，不对应任何真实型号", capabilities: { collab_listed: "yes" } },
    { presetId: "disp-out", roleId: "display", label: "示意普通显示器（不在支持列表）", note: "虚拟设备，用于演示不适用的组合", capabilities: { collab_listed: "no" } },
  ],
  stateVars: [
    { key: "checked", label: "已核对支持范围", type: "bool", initial: false },
    { key: "link", label: "协同连接", type: "enum", options: [{ value: "none", label: "未连接" }, { value: "connected", label: "已连接（虚拟）" }], initial: "none" },
    { key: "mode", label: "显示模式", type: "enum", options: [{ value: "none", label: "未选择" }, { value: "mirror", label: "镜像" }, { value: "extend", label: "扩展" }], initial: "none" },
    { key: "moved", label: "窗口已拖到第二屏", type: "bool", initial: false },
  ],
  conditions: [
    {
      condId: "c-pc",
      kind: "capability",
      label: "电脑在支持范围内",
      role: "computer",
      cap: "in_scope",
      onUnmet: { missing: "这台电脑不在多屏协同的支持范围内（系统或产品类型不符）", nextStep: "先核对电脑的系统版本与产品类型；不在范围内时改用普通显示连接方案，并以官方页面为准" },
      onUnknown: { missing: "资料还没有证实这台电脑在支持范围内", nextStep: "等待资料证据补充，或先选用虚拟示意设备体验流程" },
    },
    {
      condId: "c-disp",
      kind: "capability",
      label: "显示设备在支持列表内",
      role: "display",
      cap: "collab_listed",
      onUnmet: { missing: "这台显示设备不在多屏协同的支持列表内", nextStep: "改用普通显示连接方案（有线或标准无线显示），具体以官方页面为准" },
      onUnknown: { missing: "资料还没有证实这台显示设备在支持列表内", nextStep: "等待资料证据补充，或先选用虚拟示意设备体验流程" },
    },
    { condId: "c-checked", kind: "state", label: "已核对支持范围", expr: eq(st("checked"), true), onUnmet: { missing: "还没有核对支持范围", nextStep: "先执行“核对支持范围”" } },
    { condId: "c-link", kind: "state", label: "已建立协同连接", expr: eq(st("link"), "connected"), onUnmet: { missing: "还没有建立协同连接", nextStep: "先执行“建立协同连接”" } },
  ],
  actions: [
    {
      actionId: "check",
      label: "核对支持范围",
      hint: "先确认电脑和显示设备都在支持范围内，再讨论镜像或扩展",
      guard: eq(st("checked"), false),
      blockedReason: "已经核对过了",
      effects: [{ key: "checked", value: true }],
      feedback: [{ tone: "success", text: "已核对：这组虚拟设备都在支持范围内。真实设备请以当前官方页面为准。" }],
    },
    {
      actionId: "connect",
      label: "建立协同连接",
      requires: ["c-checked"],
      guard: ne(st("link"), "connected"),
      blockedReason: "连接已经建立",
      effects: [{ key: "link", value: "connected" }],
      feedback: [{ tone: "info", text: "虚拟电脑与虚拟显示设备之间建立了示意连接。真实设备需要按官方页面完成发现与授权。" }],
    },
    {
      actionId: "set_mode",
      label: "选择显示模式",
      hint: "镜像：两个屏幕显示相同内容；扩展：第二块屏幕是额外的桌面空间",
      options: [{ value: "mirror", label: "镜像" }, { value: "extend", label: "扩展" }],
      requires: ["c-link"],
      effects: [{ key: "mode", value: param }, { key: "moved", value: false }],
      feedback: [
        { when: eq(param, "mirror"), tone: "info", text: "已切换为镜像：显示设备显示与电脑相同的画面，没有额外的桌面空间。" },
        { when: eq(param, "extend"), tone: "info", text: "已切换为扩展：显示设备成为额外的桌面空间，可以把窗口拖过去。" },
      ],
    },
    {
      actionId: "move_window",
      label: "把窗口 A 拖到第二屏",
      requires: ["c-link"],
      guard: and(eq(st("mode"), "extend"), eq(st("moved"), false)),
      blockedReason: "只有在“扩展”模式下才有第二块桌面可以拖入；镜像时两个屏幕显示同一画面。请先把模式切换为扩展",
      effects: [{ key: "moved", value: true }],
      feedback: [{ tone: "success", text: "窗口 A 出现在第二屏，电脑屏幕上不再显示它——这就是扩展与镜像的区别。" }],
    },
    {
      actionId: "disconnect",
      label: "断开连接",
      hint: "体验断线之后的状态",
      guard: eq(st("link"), "connected"),
      blockedReason: "当前没有连接",
      effects: [{ key: "link", value: "none" }, { key: "mode", value: "none" }, { key: "moved", value: false }],
      feedback: [{ tone: "warn", text: "连接已断开，画面回到电脑本机。要继续使用，需要重新建立连接并重新选择模式。" }],
    },
  ],
  steps: [
    { stepId: "s-check", label: "核对支持范围", doneWhen: eq(st("checked"), true) },
    { stepId: "s-link", label: "建立协同连接", doneWhen: eq(st("link"), "connected") },
    { stepId: "s-mode", label: "选择镜像或扩展", doneWhen: ne(st("mode"), "none") },
    { stepId: "s-move", label: "（扩展模式）把窗口拖到第二屏", doneWhen: eq(st("moved"), true) },
  ],
  stage: {
    screens: [
      {
        screenId: "pc",
        label: "电脑屏幕（虚拟）",
        role: "computer",
        items: [
          { itemId: "pc-desk", label: "桌面", when: true },
          { itemId: "pc-win", label: "窗口 A", when: or(ne(st("mode"), "extend"), eq(st("moved"), false)), tone: "active" },
        ],
        notes: [{ when: and(eq(st("mode"), "extend"), eq(st("moved"), true)), text: "窗口 A 已移到第二屏" }],
      },
      {
        screenId: "display",
        label: "显示设备（虚拟）",
        role: "display",
        items: [
          { itemId: "d-off", label: "未连接", when: eq(st("link"), "none"), tone: "warn" },
          { itemId: "d-wait", label: "已连接，等待选择镜像或扩展", when: and(eq(st("link"), "connected"), eq(st("mode"), "none")) },
          { itemId: "d-mirror", label: "与电脑相同的画面（镜像）", when: eq(st("mode"), "mirror"), tone: "active" },
          { itemId: "d-extend-empty", label: "空白的扩展桌面", when: and(eq(st("mode"), "extend"), eq(st("moved"), false)) },
          { itemId: "d-extend-win", label: "窗口 A（已拖到这里）", when: and(eq(st("mode"), "extend"), eq(st("moved"), true)), tone: "active" },
        ],
      },
    ],
  },
  completion: {
    outcomeId: "done",
    when: and(eq(st("link"), "connected"), or(eq(st("mode"), "mirror"), and(eq(st("mode"), "extend"), eq(st("moved"), true)))),
    title: "这一遍流程走完了",
    text: "在虚拟设备上完成了：核对支持范围 → 建立连接 → 选择模式 → 观察结果。这只是流程演示，不代表任何型号的真实表现。",
    nextSteps: ["可以断开连接，换另一种模式再看一遍", "回到方案，对照候选产品的资料判断是否适合你"],
  },
  failures: [],
  realWorldChecklist: [
    "打开当前官方页面，核对支持的型号、系统版本与完整步骤",
    "在真实设备上确认协同连接是否稳定",
    "确认选定的模式是否生效",
    "检查窗口移动、输入以及音画是否满足你的办公场景",
  ],
  designBasis: [
    {
      basisId: "hw-support-41",
      title: "华为Windows电脑与显示器/智慧屏如何连接使用多屏协同（支持卡 HW-SUPPORT-41）",
      origin: "local",
      locator: "P7-常见问题库/07-华为官方支持条目/41-华为Windows电脑与显示器-智慧屏如何连接使用多屏协同.md",
      supports: "操作顺序（先核对支持性，再选镜像或扩展）与“不在支持范围时改用普通显示连接方案”的分支",
      note: "资料库整理稿，摘要自官方页面；执行前须复核官方原文，型号列表与界面细节不在本场景中",
    },
    {
      basisId: "collab-boundary",
      title: "多设备协同传播边界",
      origin: "local",
      locator: "P6-营销素材库/05-多屏协同/多设备协同传播边界.md",
      supports: "必须写清参与设备与前提、包含断线场景、不把一组组合外推到所有设备",
    },
  ],
  genericModule: false,
  assets: [
    { assetId: "css-stage", kind: "generated_css", usage: "两块虚拟屏幕的状态示意", origin: "本项目程序生成", isProductImage: false },
  ],
  persistence: { stateVersion: 1, savedKeys: ["checked", "link", "mode", "moved"], accepts: [] },
};
