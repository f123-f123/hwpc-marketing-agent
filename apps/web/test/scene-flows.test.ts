import { describe, expect, it } from "vitest";
import { registeredSceneDefinitions } from "@hwpc/scenes";
import { FT_ACTIONS, FT_SCENE_ID, FT_STATES, ftCoach, ftInitial, ftReduce, ftView, type FtEvent, type FtLocal, type FtState } from "../src/scenes/flows/fileTransfer";
import { MS_ACTIONS, MS_SCENE_ID, MS_STATES, msCoach, msInitial, msReduce, msView, type MsEvent, type MsLocal, type MsState } from "../src/scenes/flows/multiScreen";

/** 按注册的状态机推进服务端状态，模拟“提交动作 → 新快照”。 */
function serverStep(sceneId: string, state: string, actionId: string): string {
  const def = registeredSceneDefinitions.find((d) => d.sceneId === sceneId)!;
  const a = def.actions.find((x) => x.actionId === actionId)!;
  expect(a.from, `${actionId} 不能从 ${state} 执行`).toContain(state);
  return a.to;
}

function runFt(events: FtEvent[]) {
  let server: FtState = "start";
  let local: FtLocal = ftInitial;
  const actions: string[] = [];
  for (const e of events) {
    const r = ftReduce(server, local, e);
    local = r.local;
    if (r.action) {
      actions.push(r.action);
      server = serverStep(FT_SCENE_ID, server, r.action) as FtState;
    }
  }
  return { server, local, actions };
}

describe("渲染器与注册的状态机一致", () => {
  it("状态与动作名都存在于冻结定义里", () => {
    for (const [id, states, acts] of [[FT_SCENE_ID, FT_STATES, FT_ACTIONS], [MS_SCENE_ID, MS_STATES, MS_ACTIONS]] as const) {
      const def = registeredSceneDefinitions.find((d) => d.sceneId === id)!;
      expect(def.states.map((s) => s.stateId)).toEqual([...states]);
      expect(def.actions.map((a) => a.actionId).sort()).toEqual([...acts].sort());
    }
  });
});

describe("文件互传", () => {
  it("只有两项无线都打开才提交核对", () => {
    expect(runFt([{ type: "panel", open: true }, { type: "toggle", radio: "wlan" }]).actions).toEqual([]);
    const r = runFt([{ type: "panel", open: true }, { type: "toggle", radio: "wlan" }, { type: "toggle", radio: "bt" }]);
    expect(r.actions).toEqual(["check"]);
    expect(r.server).toBe("checked");
  });

  it("完整走一遍：每个手势只在对的时机提交对应动作", () => {
    const r = runFt([
      { type: "accept" }, // 太早，忽略
      { type: "toggle", radio: "wlan" },
      { type: "toggle", radio: "bt" },
      { type: "send_to_pc" }, // 还没选照片，忽略
      { type: "app", app: "gallery" },
      { type: "pick", photoId: "p3" },
      { type: "sheet", open: true },
      { type: "send_to_pc" },
      { type: "decline" },
      { type: "accept" }, // 已拒绝，需先重新发送
      { type: "resend" },
      { type: "accept" },
      { type: "open_file" },
    ]);
    expect(r.actions).toEqual(["check", "connect", "authorize", "send"]);
    expect(r.server).toBe("sent");
    const v = ftView("sent", r.local);
    expect(v.viewer && v.received).toBe(true);
    expect(v.picked?.id).toBe("p3");
    expect(ftCoach("sent", r.local).step).toBe(4);
  });

  it("断开后回到起点，需要重新打开无线", () => {
    const done = runFt([{ type: "toggle", radio: "wlan" }, { type: "toggle", radio: "bt" }, { type: "app", app: "gallery" }, { type: "pick", photoId: "p1" }, { type: "sheet", open: true }, { type: "send_to_pc" }]);
    const r = ftReduce(done.server, done.local, { type: "disconnect" });
    expect(r.action).toBe("disconnect");
    expect(ftView("start", r.local).wlan).toBe(false);
  });

  it("刷新后只剩服务端状态时，画面仍然自洽", () => {
    const v = ftView("authorized", ftInitial);
    expect(v.phone).toBe("sent");
    expect(v.received).toBe(true);
    expect(v.picked).not.toBeNull();
    expect(v.wlan && v.bt).toBe(true);
  });
});

function runMs(events: MsEvent[], configured: "mirror" | "extend" = "extend") {
  let server: MsState = "start";
  let local: MsLocal = msInitial;
  const actions: string[] = [];
  for (const e of events) {
    const r = msReduce(server, local, e, configured);
    local = r.local;
    if (r.action) {
      actions.push(r.action);
      server = serverStep(MS_SCENE_ID, server, r.action) as MsState;
    }
  }
  return { server, local, actions };
}

describe("多屏协同", () => {
  const toMode = (mode: "mirror" | "extend"): MsEvent[] => [
    { type: "info", open: true },
    { type: "confirm_support" },
    { type: "tray", open: true },
    { type: "pick_display" },
    { type: "pick_mode", mode },
  ];

  it("扩展：窗口拖到显示器上才算观察到", () => {
    const r1 = runMs([...toMode("extend"), { type: "move", to: { screen: "laptop", x: 30, y: 10 } }]);
    expect(r1.actions).toEqual(["check", "connect", "select_mode"]);
    const r2 = runMs([...toMode("extend"), { type: "move", to: { screen: "monitor", x: 10, y: 10 } }]);
    expect(r2.actions.at(-1)).toBe("observe");
    expect(msView(r2.server, r2.local, "extend").win.screen).toBe("monitor");
  });

  it("镜像：窗口不会跑到显示器上，在电脑上移动即可观察", () => {
    const r = runMs([...toMode("mirror"), { type: "move", to: { screen: "monitor", x: 30, y: 20 } }], "extend");
    expect(r.actions.at(-1)).toBe("observe");
    const v = msView(r.server, r.local, "extend");
    expect(v.mode).toBe("mirror");
    expect(v.win.screen).toBe("laptop");
    expect(v.monitor).toBe("mirror");
  });

  it("没连上之前不能选显示器、不能选模式", () => {
    expect(runMs([{ type: "pick_display" }, { type: "pick_mode", mode: "extend" }]).actions).toEqual([]);
  });

  it("刷新丢失本地模式时，按方案配置的模式显示", () => {
    expect(msView("mode_selected", msInitial, "mirror").mode).toBe("mirror");
    expect(msCoach("mode_selected", msInitial, "extend").text).toContain("拖到右边的显示器");
  });
});

describe("高亮指引跟着进度走", () => {
  it("文件互传每一步都指向下一个要点的元素", async () => {
    const { ftHint } = await import("../src/scenes/flows/fileTransfer");
    expect(ftHint("start", ftInitial)).toBe("status");
    expect(ftHint("start", { ...ftInitial, panel: true, wlan: true })).toBe("bt");
    expect(ftHint("checked", { ...ftInitial, app: "gallery", picked: "p1" })).toBe("share");
    expect(ftHint("linked", { ...ftInitial, declined: true })).toBe("resend");
    expect(ftHint("sent", ftInitial)).toBeNull();
  });
  it("多屏协同在选模式前指向投屏图标", async () => {
    const { msHint } = await import("../src/scenes/flows/multiScreen");
    expect(msHint("linked", msInitial)).toBe("cast");
    expect(msHint("linked", { ...msInitial, tray: true })).toBe("mode");
    expect(msHint("mode_selected", msInitial)).toBe("window");
  });
});

describe("体验空间：热点角度与三维陈设一致", () => {
  it("space.ts 的 yaw/pitch 由房间锚点换算而来", async () => {
    const THREE = await import("three");
    const { ANCHORS, yawPitchOf } = await import("../src/scenes/room/build");
    const { showroomSpace } = await import("@hwpc/scenes");
    for (const h of showroomSpace.hotspots) {
      const a = ANCHORS[h.hotspotId];
      expect(a, h.hotspotId).toBeDefined();
      const { yaw, pitch } = yawPitchOf(new THREE.Vector3(...a!));
      expect(Math.abs(yaw - h.yaw), `${h.hotspotId} yaw=${yaw.toFixed(1)}`).toBeLessThan(0.6);
      expect(Math.abs(pitch - h.pitch), `${h.hotspotId} pitch=${pitch.toFixed(1)}`).toBeLessThan(0.6);
    }
  });
});
