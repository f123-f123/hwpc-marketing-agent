import { describe, expect, it } from "vitest";
import { registeredSceneDefinitions } from "@hwpc/scenes";
import { FT_ACTIONS, FT_SCENE_ID, FT_STATES, ftCoach, ftInitial, ftReduce, ftView, type FtEvent, type FtLocal, type FtState } from "../src/scenes/flows/fileTransfer";
import { mockSceneDefinitions } from "@hwpc/fixtures";
import { CB_SCENE_ID, PC_FILE, cbHint, cbInitial, cbReduce, cbView, type CbEvent, type CbLocal, type CbState } from "../src/scenes/flows/collab";
import { CM_SCENE_ID, RATE, SLIDES, bagOf, cafeHoursOf, cmCoach, cmHint, cmInitial, cmReduce, cmReview, cmSteps, type CmConfig, type CmEvent, type CmLocal, type CmState } from "../src/scenes/flows/commute";
import { GenericStage } from "../src/scenes/stages/GenericStage";
import { stageFor } from "../src/scenes/stages";
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

/* ------------------------------ 两个模拟场景 ------------------------------ */

function mockStep(sceneId: string, version: number, state: string, actionId: string): string {
  const def = mockSceneDefinitions.find((d) => d.sceneId === sceneId && d.version === version)!;
  const a = def.actions.find((x) => x.actionId === actionId)!;
  expect(a.from, `${actionId} 不能从 ${state} 执行`).toContain(state);
  return a.to;
}

describe("模拟场景的渲染器与冻结定义一致", () => {
  it("通勤一天 v1 / v2、手机与电脑协同都能选到专属渲染器", () => {
    for (const def of mockSceneDefinitions) expect(stageFor(def), `${def.sceneId}@${def.version}`).not.toBe(GenericStage);
  });
});

function runCm(events: CmEvent[], cfg: CmConfig) {
  let server: CmState = "morning";
  let local: CmLocal = cmInitial;
  const actions: string[] = [];
  for (const e of events) {
    const r = cmReduce(server, local, e, cfg);
    local = r.local;
    if (r.action) {
      actions.push(r.action);
      server = mockStep(CM_SCENE_ID, cfg.hasCafe ? 2 : 1, server, r.action) as CmState;
    }
  }
  return { server, local, actions };
}

describe("通勤一天", () => {
  const v2: CmConfig = { mode: "metro", hoursOutside: 4, hasCafe: true };
  const slides: CmEvent[] = Array.from({ length: SLIDES }, () => ({ type: "next_slide" }));

  it("没装电脑不能出门；装好后通勤结束才提交 go_meeting", () => {
    expect(runCm([{ type: "leave" }, { type: "arrive" }], v2).actions).toEqual([]);
    const r = runCm([{ type: "pack", item: "laptop" }, { type: "leave" }], v2);
    expect(r.actions).toEqual([]);
    expect(r.local.leaving).toBe(true);
    expect(runCm([{ type: "pack", item: "laptop" }, { type: "leave" }, { type: "arrive" }], v2).server).toBe("meeting");
  });

  it("没带充电器插不上电；带了可以边讲边充", () => {
    const base: CmEvent[] = [{ type: "pack", item: "laptop" }, { type: "leave" }, { type: "arrive" }, { type: "take_out" }, { type: "plug" }];
    const noCharger = runCm([...base, ...slides], v2);
    expect(noCharger.local.plugged).toBe(false);
    expect(noCharger.local.battery).toBeCloseTo(100 - RATE.present);
    const charger = runCm([{ type: "pack", item: "charger" }, ...base, ...slides], v2);
    expect(charger.local.plugged).toBe(true);
    expect(charger.local.battery).toBe(100);
  });

  it("v2 完整走一遍：会议 → 咖啡厅（窗边没插座）→ 收工，电量按时长结算", () => {
    const r = runCm([
      { type: "pack", item: "laptop" }, { type: "pack", item: "charger" }, { type: "leave" }, { type: "arrive" },
      { type: "go_cafe" }, // 会还没开完，忽略
      { type: "take_out" }, ...slides, { type: "go_cafe" },
      { type: "seat", seat: "window" }, { type: "take_out" }, { type: "plug" }, { type: "hours", hours: 3 }, { type: "wrap_up" },
    ], v2);
    expect(r.actions).toEqual(["go_meeting", "go_cafe", "wrap_up"]);
    expect(r.server).toBe("evening");
    expect(r.local.log.map((x) => x.place)).toEqual(["meeting", "cafe"]);
    expect(r.local.log[1]!.plugged).toBe(false);
    expect(r.local.battery).toBeCloseTo(100 - RATE.present - 3 * RATE.office);
    expect(cmCoach("evening", r.local, v2).step).toBe(cmSteps(v2).length);
  });

  it("在外时间长又没充电器：咖啡厅里电量耗尽，回顾提醒核对续航", () => {
    const long: CmConfig = { mode: "car", hoursOutside: 12, hasCafe: true };
    const r = runCm([{ type: "pack", item: "laptop" }, { type: "leave" }, { type: "arrive" }, { type: "take_out" }, ...slides, { type: "go_cafe" }, { type: "seat", seat: "wall" }, { type: "take_out" }, { type: "wrap_up" }], long);
    expect(cafeHoursOf({ ...cmInitial, cafeHours: null }, long)).toBe(11);
    expect(r.local.battery).toBe(0);
    expect(cmReview(r.local, long, r.server).join("")).toContain("耗尽");
  });

  it("v1 没有咖啡厅：会开完直接收工", () => {
    const v1: CmConfig = { ...v2, hasCafe: false };
    const r = runCm([{ type: "pack", item: "laptop" }, { type: "leave" }, { type: "arrive" }, { type: "take_out" }, ...slides, { type: "go_cafe" }, { type: "wrap_up" }], v1);
    expect(r.actions).toEqual(["go_meeting", "wrap_up"]);
  });

  it("刷新后背包丢失，出门之后仍认为电脑在包里", () => {
    expect(bagOf("meeting", cmInitial)).toEqual(["laptop"]);
    expect(cmHint("meeting", cmInitial, v2)).toBe("bag");
  });
});

function runCb(events: CbEvent[]) {
  let server: CbState = "idle";
  let local: CbLocal = cbInitial;
  const actions: string[] = [];
  for (const e of events) {
    const r = cbReduce(server, local, e);
    local = r.local;
    if (r.action) {
      actions.push(r.action);
      server = mockStep(CB_SCENE_ID, 1, server, r.action) as CbState;
    }
  }
  return { server, local, actions };
}

describe("手机与电脑协同", () => {
  it("手机没靠近不能确认；靠近后在手机上确认才连接", () => {
    expect(runCb([{ type: "confirm" }]).actions).toEqual([]);
    expect(runCb([{ type: "near" }, { type: "cancel" }, { type: "confirm" }]).actions).toEqual([]);
    expect(runCb([{ type: "near" }, { type: "confirm" }]).server).toBe("connected");
  });

  it("把手机上的文件拖到电脑桌面才提交 send；电脑上的文件只能在完成后拖回手机", () => {
    const r = runCb([
      { type: "drop_pc", fileId: "p2" }, // 还没连接，忽略
      { type: "near" }, { type: "confirm" },
      { type: "drop_phone", fileId: PC_FILE.id }, // 还没完成，忽略
      { type: "app", app: "files" }, { type: "drop_pc", fileId: "d3" },
      { type: "drop_phone", fileId: PC_FILE.id },
    ]);
    expect(r.actions).toEqual(["connect", "send"]);
    expect(r.server).toBe("done");
    const v = cbView(r.server, r.local, "photo");
    expect(v.dropped?.name).toBe("产品手册.pdf");
    expect(v.toPhone.map((f) => f.id)).toEqual([PC_FILE.id]);
    expect(cbHint(r.server, r.local, "photo")).toBeNull();
  });

  it("指引按配置的内容指向图库或文件；刷新后完成态仍有一份文件在桌面", () => {
    expect(cbHint("connected", cbInitial, "photo")).toBe("app");
    expect(cbHint("connected", { ...cbInitial, app: "files" }, "doc")).toBe("file");
    expect(cbView("done", cbInitial, "doc").dropped?.kind).toBe("doc");
  });
});
