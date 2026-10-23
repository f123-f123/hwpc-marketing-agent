/**
 * 【MOCK】手机与电脑协同：虚拟手机靠近虚拟电脑、在手机上确认连接；电脑上出现手机窗口，
 * 在窗口里直接操作手机，把照片或文档拖到电脑桌面（只在渲染层）。
 *
 * 服务端状态机：idle → connected → done。
 *   手机上点“连接” → connect；把文件从手机窗口拖到电脑桌面 → send。
 * 该场景不在 PC 知识库范围内，界面是通用示意，不复刻任何官方界面与名称。
 */
import { PHOTOS, type PhotoArt } from "./fileTransfer";

export const CB_SCENE_ID = "mock-screen-collab";
export const CB_STATES = ["idle", "connected", "done"] as const;
export const CB_ACTIONS = ["connect", "send"] as const;
export type CbState = (typeof CB_STATES)[number];
export type CbAction = (typeof CB_ACTIONS)[number];
export type CbContent = "photo" | "doc";
export type CbApp = "home" | "gallery" | "files";

export interface CbFile {
  id: string;
  name: string;
  size: string;
  kind: "photo" | "doc" | "sheet" | "pdf";
  art?: PhotoArt;
}

export const PHONE_PHOTOS: CbFile[] = PHOTOS.map((p) => ({ id: p.id, name: p.name, size: p.size, kind: "photo", art: p.art }));
export const PHONE_DOCS: CbFile[] = [
  { id: "d1", name: "季度汇报.docx", size: "1.2 MB", kind: "doc" },
  { id: "d2", name: "客户名单.xlsx", size: "86 KB", kind: "sheet" },
  { id: "d3", name: "产品手册.pdf", size: "4.8 MB", kind: "pdf" },
];
/** 电脑桌面上本来就有的文件，可以反过来拖进手机窗口。 */
export const PC_FILE: CbFile = { id: "pc1", name: "会议纪要.docx", size: "320 KB", kind: "doc" };

export const fileById = (id: string | null): CbFile | undefined => [...PHONE_PHOTOS, ...PHONE_DOCS, PC_FILE].find((f) => f.id === id);
export const appFor = (content: CbContent): CbApp => (content === "photo" ? "gallery" : "files");

export interface CbLocal {
  /** 手机已经放到电脑旁边。 */
  near: boolean;
  app: CbApp;
  /** 拖到电脑桌面上的文件。 */
  dropped: string | null;
  viewer: boolean;
  /** 从电脑拖进手机的文件。 */
  toPhone: string[];
}

export const cbInitial: CbLocal = { near: false, app: "home", dropped: null, viewer: false, toPhone: [] };

export type CbEvent =
  | { type: "near" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "app"; app: CbApp }
  | { type: "drop_pc"; fileId: string }
  | { type: "open"; open: boolean }
  | { type: "drop_phone"; fileId: string };

export function cbReduce(server: CbState, s: CbLocal, e: CbEvent): { local: CbLocal; action?: CbAction } {
  switch (e.type) {
    case "near":
      return server === "idle" ? { local: { ...s, near: true } } : { local: s };
    case "cancel":
      return server === "idle" ? { local: { ...s, near: false } } : { local: s };
    case "confirm":
      return server === "idle" && s.near ? { local: s, action: "connect" } : { local: s };
    case "app":
      return { local: { ...s, app: e.app } };
    case "drop_pc": {
      const f = fileById(e.fileId);
      if (server === "idle" || !f || f.id === PC_FILE.id) return { local: s };
      const local = { ...s, dropped: f.id, viewer: true };
      return server === "connected" ? { local, action: "send" } : { local };
    }
    case "open":
      return server === "done" ? { local: { ...s, viewer: e.open } } : { local: s };
    case "drop_phone":
      return server === "done" && e.fileId === PC_FILE.id && !s.toPhone.includes(e.fileId) ? { local: { ...s, toPhone: [...s.toPhone, e.fileId] } } : { local: s };
  }
}

export interface CbView {
  /** 手机是否放在电脑旁边（连接后总是）。 */
  near: boolean;
  /** 手机上弹出的连接确认。 */
  ask: boolean;
  /** 电脑上的手机窗口。 */
  mirror: boolean;
  app: CbApp;
  dropped: CbFile | null;
  viewer: boolean;
  toPhone: CbFile[];
}

/** 服务端状态优先：刷新后本地细节丢失，画面仍与服务端一致（完成后桌面上至少有一份按配置传过来的文件）。 */
export function cbView(server: CbState, s: CbLocal, content: CbContent): CbView {
  const fallback = content === "photo" ? PHONE_PHOTOS[0]! : PHONE_DOCS[0]!;
  const dropped = fileById(s.dropped) ?? (server === "done" ? fallback : null);
  return {
    near: server !== "idle" || s.near,
    ask: server === "idle" && s.near,
    mirror: server !== "idle",
    app: s.app,
    dropped,
    viewer: server === "done" && s.viewer,
    toPhone: s.toPhone.map((id) => fileById(id)!).filter(Boolean),
  };
}

export const CB_STEPS = ["把手机靠近电脑", "在手机上确认连接", "把文件拖到电脑桌面"];

export interface Coach {
  step: number;
  text: string;
  detail?: string;
}

export function cbCoach(server: CbState, s: CbLocal, content: CbContent): Coach {
  const what = content === "photo" ? "一张照片" : "一份文档";
  const app = content === "photo" ? "图库" : "文件";
  switch (server) {
    case "idle":
      return s.near
        ? { step: 1, text: "手机上弹出了连接确认，点「连接」。", detail: "确认对方是你自己的电脑再连接；陌生设备的请求要拒绝。" }
        : { step: 0, text: "按住右边的手机，把它拖到电脑旁边。", detail: "两台设备靠近后互相发现。真实设备的发现方式、前提条件以官方说明为准。" };
    case "connected":
      return s.app !== appFor(content)
        ? { step: 2, text: `电脑上出现了手机窗口。在窗口里点「${app}」。`, detail: "这个窗口就是手机的画面：在电脑上用鼠标直接操作手机，手机本身也同步变化。" }
        : { step: 2, text: `按住${what}，从手机窗口拖到电脑桌面上。`, detail: "松手后文件会出现在电脑桌面，并直接打开。" };
    case "done":
      return s.toPhone.length
        ? { step: 3, text: "两个方向都试过了：手机 → 电脑，电脑 → 手机。", detail: "这只是虚拟设备上的流程演示，不证明你的设备组合能连接成功。" }
        : { step: 3, text: "文件到电脑了。反过来试试：把桌面上的「会议纪要」拖进手机窗口。", detail: "协同是双向的；真实设备支持哪些文件类型、大小上限以官方说明为准。" };
  }
}

export type CbHint = "phone" | "confirm" | "app" | "file" | "pcfile" | null;

export function cbHint(server: CbState, s: CbLocal, content: CbContent): CbHint {
  switch (server) {
    case "idle":
      return s.near ? "confirm" : "phone";
    case "connected":
      return s.app !== appFor(content) ? "app" : "file";
    case "done":
      return s.toPhone.length ? null : "pcfile";
  }
}
