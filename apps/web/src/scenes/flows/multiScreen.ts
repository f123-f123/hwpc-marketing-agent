/**
 * 多屏协同：镜像与扩展。虚拟电脑 + 虚拟显示器上的操作流程（只在渲染层）。
 *
 * 服务端状态机：start → checked → linked → mode_selected → observed。
 *   查看显示器型号信息并确认在支持范围 → check；在电脑上打开投屏面板、选显示器 → connect；
 *   选镜像或扩展 → select_mode；拖动窗口观察两块屏的变化 → observe。
 * 依据支持卡 HW-SUPPORT-41：“先核对支持性再讨论镜像或扩展”，仅 MateView 无线投屏版与部分智慧屏支持。
 * 面板、按钮均为通用示意，不复刻官方界面的名称与路径。
 */

export const MS_SCENE_ID = "multi-screen-extend";
export const MS_STATES = ["start", "checked", "linked", "mode_selected", "observed"] as const;
export const MS_ACTIONS = ["check", "connect", "select_mode", "observe", "disconnect"] as const;
export type MsState = (typeof MS_STATES)[number];
export type MsAction = (typeof MS_ACTIONS)[number];
export type Mode = "mirror" | "extend";
export type ScreenId = "laptop" | "monitor";

/** 窗口左上角在所在屏幕里的位置（百分比）。窗口尺寸固定。 */
export interface WinPos {
  screen: ScreenId;
  x: number;
  y: number;
}
export const WIN_W = 58;
export const WIN_H = 62;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clampWin = (p: WinPos): WinPos => ({ screen: p.screen, x: clamp(p.x, 0, 100 - WIN_W), y: clamp(p.y, 0, 88 - WIN_H) });

export interface MsLocal {
  info: boolean;
  tray: boolean;
  mode: Mode | null;
  win: WinPos;
}

export const msInitial: MsLocal = { info: false, tray: false, mode: null, win: { screen: "laptop", x: 8, y: 8 } };

export type MsEvent =
  | { type: "info"; open: boolean }
  | { type: "confirm_support" }
  | { type: "tray"; open: boolean }
  | { type: "pick_display" }
  | { type: "pick_mode"; mode: Mode }
  | { type: "move"; to: WinPos }
  | { type: "disconnect" };

const at = (server: MsState, ...states: MsState[]) => states.includes(server);

/** 实际生效的模式：本地选过的优先，其次是方案配置（刷新后本地记录丢失时使用）。 */
export const effectiveMode = (s: MsLocal, configured: Mode): Mode => s.mode ?? configured;

export function msReduce(server: MsState, s: MsLocal, e: MsEvent, configured: Mode): { local: MsLocal; action?: MsAction } {
  switch (e.type) {
    case "info":
      return { local: { ...s, info: e.open } };
    case "confirm_support":
      return server === "start" ? { local: { ...s, info: false }, action: "check" } : { local: { ...s, info: false } };
    case "tray":
      return { local: { ...s, tray: e.open } };
    case "pick_display":
      return server === "checked" ? { local: s, action: "connect" } : { local: s };
    case "pick_mode":
      return server === "linked" ? { local: { ...s, mode: e.mode, tray: false }, action: "select_mode" } : { local: s };
    case "move": {
      const mode = effectiveMode(s, configured);
      // 镜像模式下显示器只是电脑画面的副本，窗口只能在电脑屏幕上移动。
      const to = clampWin(mode === "mirror" ? { ...e.to, screen: "laptop" } : e.to);
      const moved = to.screen !== s.win.screen || Math.abs(to.x - s.win.x) > 2 || Math.abs(to.y - s.win.y) > 2;
      const observed = server === "mode_selected" && (mode === "extend" ? to.screen === "monitor" : moved);
      // 断开或还没进入扩展模式时，窗口只能留在电脑上。
      const allowMonitor = at(server, "mode_selected", "observed") && mode === "extend";
      const local = { ...s, win: allowMonitor ? to : { ...to, screen: "laptop" as const } };
      return observed ? { local, action: "observe" } : { local };
    }
    case "disconnect":
      return at(server, "linked", "mode_selected", "observed") ? { local: { ...msInitial }, action: "disconnect" } : { local: s };
  }
}

export type MonitorScreen = "standby" | "connected" | "mirror" | "extend";

export interface MsView {
  monitor: MonitorScreen;
  mode: Mode | null;
  win: WinPos;
  info: boolean;
  tray: boolean;
  checked: boolean;
  canPickDisplay: boolean;
  canPickMode: boolean;
  canDisconnect: boolean;
}

export function msView(server: MsState, s: MsLocal, configured: Mode): MsView {
  const modeOn = at(server, "mode_selected", "observed");
  const mode = modeOn ? effectiveMode(s, configured) : null;
  const win = mode === "extend" ? s.win : { ...s.win, screen: "laptop" as const };
  return {
    monitor: mode ?? (server === "linked" ? "connected" : "standby"),
    mode,
    win,
    info: s.info,
    tray: s.tray,
    checked: server !== "start",
    canPickDisplay: server === "checked",
    canPickMode: server === "linked",
    canDisconnect: at(server, "linked", "mode_selected", "observed"),
  };
}

export const MS_STEPS = ["核对显示器", "连接显示器", "选择模式", "拖动窗口观察"];

export interface Coach {
  step: number;
  text: string;
  detail?: string;
}

export function msCoach(server: MsState, s: MsLocal, configured: Mode): Coach {
  const mode = effectiveMode(s, configured);
  switch (server) {
    case "start":
      return s.info
        ? { step: 0, text: "看完型号信息后，点「已核对，在支持范围内」。", detail: "真实设备：仅华为 MateView 无线投屏版显示器和部分智慧屏支持，以官方支持列表为准；不在范围内要改用普通的有线显示连接。" }
        : { step: 0, text: "先点显示器下方的「型号信息」，确认它在支持范围内。", detail: "先核对支持性，再讨论镜像还是扩展。" };
    case "checked":
      return s.tray
        ? { step: 1, text: "在面板里点「示意显示器」。" }
        : { step: 1, text: "点电脑任务栏右侧的投屏图标，打开连接面板。" };
    case "linked":
      return s.tray
        ? { step: 2, text: "选一种模式：镜像（两块屏一样）或扩展（多出一块桌面）。", detail: `你的方案建议用「${configured === "extend" ? "扩展" : "镜像"}」，两种都可以试。` }
        : { step: 2, text: "已经连上。再点投屏图标，选择镜像或扩展。" };
    case "mode_selected":
      return mode === "extend"
        ? { step: 3, text: "按住文档窗口的标题栏，把它拖到右边的显示器上。", detail: "扩展：显示器是一块新桌面，窗口可以在两块屏之间移动。" }
        : { step: 3, text: "按住文档窗口的标题栏拖动，看看显示器上的画面。", detail: "镜像：显示器显示和电脑一模一样的画面，适合给别人看。" };
    case "observed":
      return mode === "extend"
        ? { step: 4, text: "窗口到了显示器上：扩展模式下两块屏是一张连起来的桌面。", detail: "可以断开后改用镜像再试一次，比较两种用法。" }
        : { step: 4, text: "显示器跟着电脑同步变化：这就是镜像。", detail: "可以断开后改用扩展再试一次，比较两种用法。" };
  }
}

export type MsHint = "sticker" | "confirm" | "cast" | "peer" | "mode" | "window" | null;

/** 指引所指的那个界面元素（加高亮环），和 msCoach 的文字一一对应。 */
export function msHint(server: MsState, s: MsLocal): MsHint {
  switch (server) {
    case "start":
      return s.info ? "confirm" : "sticker";
    case "checked":
      return s.tray ? "peer" : "cast";
    case "linked":
      return s.tray ? "mode" : "cast";
    case "mode_selected":
      return "window";
    case "observed":
      return null;
  }
}
