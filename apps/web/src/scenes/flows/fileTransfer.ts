/**
 * 手机 → 电脑 文件互传：虚拟设备上的操作流程（只在渲染层）。
 *
 * 服务端状态机只有 start → checked → linked → authorized → sent 五个状态（见 scenes/src/publicDefinitions.ts）。
 * 这里把每一步拆成用户在虚拟手机、虚拟电脑上真正要做的操作，只在关键节点提交对应的服务端动作：
 *   打开 WLAN 与蓝牙 → check；在图库选照片并分享给附近的电脑 → connect；电脑上点“接收” → authorize；
 *   在电脑上打开收到的文件、核对大小 → send。
 * 界面元素是通用示意：支持卡 HW-SUPPORT-31 只给出“发现 / 发送 / 接收”与结果核验项，
 * 没有列出的官方菜单、按钮名称一律不复刻（“卡内没有列出的路径与键位一律不猜测”）。
 */

export const FT_SCENE_ID = "phone-pc-file-transfer";
export const FT_STATES = ["start", "checked", "linked", "authorized", "sent"] as const;
export const FT_ACTIONS = ["check", "connect", "authorize", "send", "disconnect"] as const;
export type FtState = (typeof FT_STATES)[number];
export type FtAction = (typeof FT_ACTIONS)[number];

export type PhotoArt = "harbor" | "lake" | "city" | "field" | "desk" | "snow";
export interface Photo {
  id: string;
  name: string;
  /** 示意文件大小：只用于“两端大小一致”的核对演示，不代表任何设备的传输能力。 */
  size: string;
  pixels: string;
  art: PhotoArt;
}

export const PHOTOS: Photo[] = [
  { id: "p1", name: "IMG_20261018_172406.jpg", size: "3.4 MB", pixels: "4096 × 3072", art: "harbor" },
  { id: "p2", name: "IMG_20261017_081532.jpg", size: "2.9 MB", pixels: "4096 × 3072", art: "lake" },
  { id: "p3", name: "IMG_20261016_201145.jpg", size: "4.1 MB", pixels: "4096 × 3072", art: "city" },
  { id: "p4", name: "IMG_20261015_103018.jpg", size: "3.1 MB", pixels: "4096 × 3072", art: "field" },
  { id: "p5", name: "IMG_20261014_143350.jpg", size: "2.2 MB", pixels: "3072 × 4096", art: "desk" },
  { id: "p6", name: "IMG_20261012_090205.jpg", size: "3.7 MB", pixels: "4096 × 3072", art: "snow" },
];

export const photoById = (id: string | null) => PHOTOS.find((p) => p.id === id) ?? PHOTOS[0]!;

/** 只存在于浏览器里的界面细节；刷新后从服务端状态推回一致的画面。 */
export interface FtLocal {
  panel: boolean;
  wlan: boolean;
  bt: boolean;
  app: "home" | "gallery";
  picked: string | null;
  sheet: boolean;
  declined: boolean;
}

export const ftInitial: FtLocal = { panel: false, wlan: false, bt: false, app: "home", picked: null, sheet: false, declined: false };

export type FtEvent =
  | { type: "panel"; open: boolean }
  | { type: "toggle"; radio: "wlan" | "bt" }
  | { type: "app"; app: "home" | "gallery" }
  | { type: "pick"; photoId: string }
  | { type: "sheet"; open: boolean }
  | { type: "send_to_pc" }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "resend" }
  | { type: "open_file" }
  | { type: "disconnect" };

const at = (server: FtState, ...states: FtState[]) => states.includes(server);

/**
 * 处理一次界面操作：返回新的本地状态，以及需要提交给服务端的动作（如果有）。
 * 不合时宜的操作（例如还没连接就点“接收”）原样返回，不提交任何动作。
 */
export function ftReduce(server: FtState, s: FtLocal, e: FtEvent): { local: FtLocal; action?: FtAction } {
  switch (e.type) {
    case "panel":
      return { local: { ...s, panel: e.open } };
    case "toggle": {
      // 核对完成后无线开关保持开启；要重新开始请断开连接。
      if (server !== "start") return { local: s };
      const next = { ...s, [e.radio]: !s[e.radio] };
      return next.wlan && next.bt ? { local: { ...next, panel: false }, action: "check" } : { local: next };
    }
    case "app":
      return { local: { ...s, app: e.app, sheet: false, panel: false } };
    case "pick":
      return { local: { ...s, picked: s.picked === e.photoId ? null : e.photoId } };
    case "sheet":
      return { local: { ...s, sheet: e.open && s.picked !== null } };
    case "send_to_pc":
      return at(server, "checked") && s.picked ? { local: { ...s, sheet: false, declined: false }, action: "connect" } : { local: s };
    case "accept":
      return at(server, "linked") && !s.declined ? { local: s, action: "authorize" } : { local: s };
    case "decline":
      return at(server, "linked") ? { local: { ...s, declined: true } } : { local: s };
    case "resend":
      return { local: { ...s, declined: false } };
    case "open_file":
      return at(server, "authorized") ? { local: s, action: "send" } : { local: s };
    case "disconnect":
      return at(server, "linked", "authorized", "sent") ? { local: { ...ftInitial }, action: "disconnect" } : { local: s };
  }
}

export type PhoneScreen = "home" | "gallery" | "waiting" | "declined" | "sent";

export interface FtView {
  wlan: boolean;
  bt: boolean;
  phone: PhoneScreen;
  panel: boolean;
  sheet: boolean;
  picked: Photo | null;
  /** 电脑右下角的接收请求。 */
  request: boolean;
  /** “接收的文件”文件夹里有没有这张照片。 */
  received: boolean;
  viewer: boolean;
  canDisconnect: boolean;
}

/** 服务端状态 + 本地细节 → 两台设备该显示什么。服务端状态优先：刷新、换设备后画面仍然一致。 */
export function ftView(server: FtState, s: FtLocal): FtView {
  const past = server !== "start";
  const linkedOrLater = at(server, "linked", "authorized", "sent");
  const picked = s.picked ? photoById(s.picked) : linkedOrLater ? PHOTOS[0]! : null;
  const phone: PhoneScreen = at(server, "authorized", "sent")
    ? "sent"
    : server === "linked"
      ? (s.declined ? "declined" : "waiting")
      : s.app;
  return {
    wlan: past || s.wlan,
    bt: past || s.bt,
    phone,
    panel: server === "start" && s.panel,
    sheet: server === "checked" && s.sheet && s.picked !== null,
    picked,
    request: server === "linked" && !s.declined,
    received: at(server, "authorized", "sent"),
    viewer: server === "sent",
    canDisconnect: linkedOrLater,
  };
}

export const FT_STEPS = ["打开 WLAN 和蓝牙", "选照片发给电脑", "在电脑上接收", "打开文件核对"];

export interface Coach {
  /** 0 起；等于步骤数表示已走完。 */
  step: number;
  text: string;
  detail?: string;
}

export function ftCoach(server: FtState, s: FtLocal): Coach {
  const v = ftView(server, s);
  switch (server) {
    case "start": {
      const missing = [!s.wlan && "WLAN", !s.bt && "蓝牙"].filter(Boolean).join("和");
      return v.panel
        ? { step: 0, text: `在控制面板里打开${missing}。`, detail: "两端要能互相发现。真实设备还要核对是否在支持范围内、电脑管家与系统版本、两端剩余空间。" }
        : { step: 0, text: "点手机顶部的状态栏，下拉控制面板。", detail: "先让手机具备被电脑发现的条件。" };
    }
    case "checked":
      if (s.app !== "gallery") return { step: 1, text: "在手机上打开「图库」。" };
      if (!s.picked) return { step: 1, text: "点一张照片选中它。" };
      if (!s.sheet) return { step: 1, text: "点底部的「分享」。" };
      return { step: 1, text: "在“附近设备”里点「示意电脑」。", detail: "这一步对应“发现”：电脑出现在列表里，说明两端互相找到了。" };
    case "linked":
      return s.declined
        ? { step: 2, text: "你在电脑上拒绝了这次接收。在手机上点「重新发送」再试一次。" }
        : { step: 2, text: "看电脑右下角弹出的请求，点「接收」。", detail: "接收前确认来源是你自己的手机；陌生设备的请求不要接收。" };
    case "authorized":
      return { step: 3, text: "照片已到电脑的「接收的文件」里。双击打开它。", detail: "核对三件事：能打开、大小与手机上一致、内容完整。" };
    case "sent":
      return { step: 4, text: "流程走完了：两端显示的文件名和大小一致。", detail: "可以点「断开连接」重来一遍，或回到空间看看别的任务。" };
  }
}

export type FtHint = "status" | "wlan" | "bt" | "gallery" | "photo" | "share" | "peer" | "accept" | "resend" | "open" | null;

/** 指引所指的那个界面元素（加高亮环），和 ftCoach 的文字一一对应。 */
export function ftHint(server: FtState, s: FtLocal): FtHint {
  switch (server) {
    case "start":
      return !s.panel ? "status" : !s.wlan ? "wlan" : "bt";
    case "checked":
      return s.app !== "gallery" ? "gallery" : !s.picked ? "photo" : !s.sheet ? "share" : "peer";
    case "linked":
      return s.declined ? "resend" : "accept";
    case "authorized":
      return "open";
    case "sent":
      return null;
  }
}
