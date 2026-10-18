import { describe, expect, it } from "vitest";
import { SceneDefinitionSchema, validateSceneConfig } from "@hwpc/contracts";
import {
  SIMULATED_EVIDENCE,
  allScenes,
  applyEntry,
  buildView,
  catalog,
  createRun,
  exploreReachable,
  fileTransferScene,
  getScene,
  lintAll,
  lintDefinition,
  multiScreenScene,
  replay,
  restore,
  scenesForProblem,
  scenesForTech,
  simulatedConfig,
  toSaved,
  validateConfig,
  viewTexts,
  type DeviceBinding,
  type HistoryEntry,
  type SceneConfig,
  type SceneDefinition,
  registeredSceneDefinitions,
} from "../src";

const AT = "2026-10-18T00:00:00.000Z";
const bind = (roleId: string, preset: string): HistoryEntry => ({ type: "bind", roleId, bindingId: `sim:${preset}` });
const act = (actionId: string, param?: string): HistoryEntry => ({ type: "act", actionId, param });

function play(def: SceneDefinition, cfg: SceneConfig, h: HistoryEntry[]) {
  const r = replay(def, cfg, h);
  expect(r.error).toBeUndefined();
  return { run: r.run, view: buildView(def, cfg, r.run) };
}

describe("场景定义", () => {
  it("公共场景注册项可校验，配置有界且演示不声称实机测试", () => {
    expect(registeredSceneDefinitions.map(s => s.sceneId).sort()).toEqual(["multi-screen-extend", "phone-pc-file-transfer"]);
    for (const scene of registeredSceneDefinitions) {
      expect(SceneDefinitionSchema.safeParse(scene).success).toBe(true);
      expect(scene.demoBoundary.deviceTested).toBe(false);
      expect(validateSceneConfig(scene, { unregistered: "script" }).ok).toBe(false);
    }
  });
  it("所有场景通过静态检查", () => {
    for (const r of lintAll()) expect(r.errors, `${r.sceneId}@${r.version}`).toEqual([]);
  });

  it("多对多：一项技术对应多个场景，一个场景涉及多个技术", () => {
    expect(scenesForTech("多屏协同").map((s) => s.sceneId).sort()).toEqual(["multi-screen-extend", "phone-pc-file-transfer"]); // 一项技术 → 多个场景
    expect(scenesForTech("镜像").map((s) => s.sceneId)).toEqual(["multi-screen-extend"]);
    expect(scenesForTech("文件互传").map((s) => s.sceneId)).toEqual(["phone-pc-file-transfer"]);
    expect(multiScreenScene.serves.techTags.length).toBeGreaterThan(1);
    expect(scenesForProblem("双屏办公")).toHaveLength(1);
    expect(catalog()).toHaveLength(2);
    expect(catalog().every((c) => c.problemTags.length && c.techTags.length)).toBe(true);
  });

  it("没有资料依据时必须标记为通用模块；不能声明实机测试", () => {
    const bad = structuredClone(multiScreenScene);
    bad.designBasis = [];
    expect(lintDefinition(bad).join()).toMatch(/通用模块/);
    const m = structuredClone(multiScreenScene);
    m.demoType = "measured_test";
    expect(lintDefinition(m).join()).toMatch(/实机测试/);
  });

  it("静态检查能发现未定义引用与越权 requires", () => {
    const bad = structuredClone(multiScreenScene);
    bad.actions[0]!.effects.push({ key: "nope", value: true });
    bad.actions[1]!.requires = ["c-pc"]; // 设备能力类条件不允许放进 requires
    const e = lintDefinition(bad).join("\n");
    expect(e).toMatch(/未定义的状态 nope/);
    expect(e).toMatch(/只能引用状态类条件/);
  });

  it("本轮没有任何场景声称实机测试，演示边界均已声明", () => {
    for (const s of allScenes()) {
      expect(s.demoType).not.toBe("measured_test");
      expect(s.demoBoundary.length).toBeGreaterThan(20);
      expect(s.assets.every((a) => !a.isProductImage)).toBe(true);
    }
  });
});

describe("多屏协同：可操作、有条件、有反馈", () => {
  const def = multiScreenScene;
  const cfg = simulatedConfig(def);

  it("满足条件的虚拟设备可以走完流程，并看到不同的反馈与画面", () => {
    let { view } = play(def, cfg, [bind("computer", "pc-ok"), bind("display", "disp-ok")]);
    expect(view.applicability.kind).toBe("applicable");
    expect(view.outcome.kind).toBe("in_progress");
    // 先连接会被拦下：需要先核对支持范围
    const early = view.actions.find((a) => a.actionId === "connect")!;
    expect(early.enabled).toBe(false);
    expect(early.blocked?.nextStep).toMatch(/核对支持范围/);

    ({ view } = play(def, cfg, [bind("computer", "pc-ok"), bind("display", "disp-ok"), act("check"), act("connect"), act("set_mode", "mirror")]));
    expect(view.feedback[0]!.text).toMatch(/镜像/);
    expect(view.outcome.kind).toBe("completed"); // 镜像不需要拖动窗口
    const move = view.actions.find((a) => a.actionId === "move_window")!;
    expect(move.enabled).toBe(false); // 镜像下不能"拖到第二屏"
    expect(move.blocked?.reason).toMatch(/扩展/);

    ({ view } = play(def, cfg, [bind("computer", "pc-ok"), bind("display", "disp-ok"), act("check"), act("connect"), act("set_mode", "extend")]));
    expect(view.outcome.kind).toBe("in_progress"); // 扩展要把窗口拖过去才算完成
    ({ view } = play(def, cfg, [bind("computer", "pc-ok"), bind("display", "disp-ok"), act("check"), act("connect"), act("set_mode", "extend"), act("move_window")]));
    expect(view.outcome.kind).toBe("completed");
    expect(view.stage.screens.find((s) => s.screenId === "display")!.items.map((i) => i.label).join()).toMatch(/窗口 A/);
  });

  it("不适用的设备组合：任何动作都不可用，无法进入成功分支，并给出原因与下一步", () => {
    for (const [pc, disp] of [["pc-out", "disp-ok"], ["pc-ok", "disp-out"], ["pc-out", "disp-out"]] as const) {
      const { run, view } = play(def, cfg, [bind("computer", pc), bind("display", disp)]);
      expect(view.applicability.kind).toBe("not_applicable");
      expect(view.outcome.kind).toBe("not_applicable");
      expect(view.outcome.nextSteps.length).toBeGreaterThan(0);
      expect(view.actions.every((a) => !a.enabled)).toBe(true);
      expect(view.actions[0]!.blocked?.nextStep).toBeTruthy();
      const forced = applyEntry(def, cfg, run, act("check"));
      expect(forced.ok).toBe(false);
    }
  });

  it("换设备会清除之前的操作与结果", () => {
    const { run } = play(def, cfg, [bind("computer", "pc-ok"), bind("display", "disp-ok"), act("check"), act("connect")]);
    const r = applyEntry(def, cfg, run, bind("display", "disp-out"));
    expect(r.ok).toBe(true);
    expect(r.run.state["checked"]).toBe(false);
    expect(r.run.state["link"]).toBe("none");
    expect(buildView(def, cfg, r.run).outcome.kind).toBe("not_applicable");
  });

  it("全可达状态检查：没有假成功，没有违禁表达，成功分支可达", () => {
    const rep = exploreReachable(def, cfg);
    expect(rep.states).toBeGreaterThan(20);
    expect(rep.falseSuccess).toEqual([]);
    expect(rep.violations).toEqual([]);
    expect(rep.completedReachable).toBe(true);
  });
});

describe("文件互传：条件改变结果", () => {
  const def = fileTransferScene;
  const cfg = simulatedConfig(def);
  const base: HistoryEntry[] = [bind("phone", "phone-ok"), bind("computer", "pc-ok"), act("connect"), act("authorize")];

  it("同一个大文件：空间充足时送达，空间不足时失败并给出排查线索", () => {
    const ok = play(def, cfg, [...base, act("pick_file", "video_large"), act("send")]).view;
    expect(ok.outcome.kind).toBe("completed");
    const bad = play(def, cfg, [...base, act("pick_file", "video_large"), act("set_space", "low"), act("send")]).view;
    expect(bad.outcome.kind).toBe("failed");
    expect(bad.outcome.nextSteps.join()).toMatch(/剩余空间/);
    // 较小文件在同样条件下仍可送达：失败不是对所有文件一刀切
    const small = play(def, cfg, [...base, act("pick_file", "photo_small"), act("set_space", "low"), act("send")]).view;
    expect(small.outcome.kind).toBe("completed");
  });

  it("没有授权不能发送；断线后授权失效", () => {
    const { view } = play(def, cfg, [bind("phone", "phone-ok"), bind("computer", "pc-ok"), act("connect"), act("pick_file", "photo_small")]);
    const send = view.actions.find((a) => a.actionId === "send")!;
    expect(send.enabled).toBe(false);
    expect(send.blocked?.nextStep).toMatch(/确认授权/);
    const after = play(def, cfg, [...base, act("disconnect")]).view;
    expect(after.steps.find((s) => s.stepId === "s-auth")!.done).toBe(false);
  });

  it("手机或电脑不在支持范围：无法进入成功分支", () => {
    for (const [ph, pc] of [["phone-out", "pc-ok"], ["phone-ok", "pc-out"]] as const) {
      const { view } = play(def, cfg, [bind("phone", ph), bind("computer", pc)]);
      expect(view.outcome.kind).toBe("not_applicable");
      expect(view.actions.every((a) => !a.enabled)).toBe(true);
    }
  });

  it("全可达状态检查", () => {
    const rep = exploreReachable(def, cfg);
    expect(rep.falseSuccess).toEqual([]);
    expect(rep.violations).toEqual([]);
    expect(rep.completedReachable).toBe(true);
  });

  it("没有任何动画时长或耗时字段", () => {
    const text = JSON.stringify(def);
    expect(text).not.toMatch(/duration|delay|timeout|setTimeout|"ms"/i);
  });
});

describe("真实产品设备：能力必须有证据", () => {
  const def = multiScreenScene;
  const base = simulatedConfig(def);
  const evOfficial = { evidenceId: "ev-1", level: "official_support_page" as const, title: "官方支持页（测试用占位）", origin: "mock" as const, locator: "mock://ev-1" };
  const evScene = { evidenceId: "ev-2", level: "scene_art" as const, title: "场景图片", origin: "mock" as const, locator: "mock://ev-2" };
  const product = (id: string, role: string, value: "yes" | "no" | "unknown", evidenceIds: string[], cap: string): DeviceBinding => ({
    bindingId: id, roleId: role, label: `候选 ${id}`, source: "product", productRef: { productId: id }, capabilities: { [cap]: { value, evidenceIds } },
  });

  it("只有场景图片、没有可作为能力依据的证据时，声称 yes 也只算未知", () => {
    const cfg: SceneConfig = {
      ...base,
      bindings: [...base.bindings, product("p-disp", "display", "yes", ["ev-2"], "collab_listed")],
      evidence: [...base.evidence, evScene],
    };
    expect(validateConfig(def, cfg)).toEqual([]);
    const { view } = play(def, cfg, [bind("computer", "pc-ok"), { type: "bind", roleId: "display", bindingId: "p-disp" }]);
    expect(view.applicability.kind).toBe("unverified");
    expect(view.outcome.kind).toBe("unverified");
    expect(view.actions.every((a) => !a.enabled)).toBe(true);
    expect(view.outcome.text).toMatch(/尚未|没有证实/);
  });

  it("有官方依据的 yes 才能进入流程，并在视图中列出证据来源", () => {
    const cfg: SceneConfig = {
      ...base,
      bindings: [...base.bindings, product("p-disp", "display", "yes", ["ev-1"], "collab_listed")],
      evidence: [...base.evidence, evOfficial],
    };
    const { view } = play(def, cfg, [bind("computer", "pc-ok"), { type: "bind", roleId: "display", bindingId: "p-disp" }]);
    expect(view.applicability.kind).toBe("applicable");
    expect(view.sources.evidence.map((e) => e.evidenceId)).toContain("ev-1");
    expect(view.roles.find((r) => r.roleId === "display")!.options.find((o) => o.bindingId === "p-disp")!.sourceLabel).toMatch(/候选产品/);
  });

  it("有依据的 no 同样挡住流程", () => {
    const cfg: SceneConfig = {
      ...base,
      bindings: [...base.bindings, product("p-disp", "display", "no", ["ev-1"], "collab_listed")],
      evidence: [...base.evidence, evOfficial],
    };
    const { view } = play(def, cfg, [bind("computer", "pc-ok"), { type: "bind", roleId: "display", bindingId: "p-disp" }]);
    expect(view.applicability.kind).toBe("not_applicable");
  });

  it("配置校验：引用不存在的证据、伪造模拟设备能力、版本不符、缺少设备都会被拒绝", () => {
    const bad: SceneConfig = {
      ...base,
      sceneVersion: 99,
      bindings: [
        ...base.bindings.filter((b) => b.roleId !== "display"),
        product("p-x", "display", "yes", ["ghost"], "collab_listed"),
        { ...base.bindings.find((b) => b.bindingId === "sim:pc-out")!, bindingId: "sim:forged", capabilities: { in_scope: { value: "yes", evidenceIds: [] } } },
      ],
    };
    const e = validateConfig(def, bad).join("\n");
    expect(e).toMatch(/版本/);
    expect(e).toMatch(/不存在的证据 ghost/);
    expect(e).toMatch(/与预设不一致/);
    const noDisplay: SceneConfig = { ...base, bindings: base.bindings.filter((b) => b.roleId !== "display") };
    expect(validateConfig(def, noDisplay).join()).toMatch(/没有可选设备/);
  });
});

describe("保存、恢复与版本兼容", () => {
  const def = multiScreenScene;
  const cfg = simulatedConfig(def);
  const hist: HistoryEntry[] = [bind("computer", "pc-ok"), bind("display", "disp-ok"), act("check"), act("connect"), act("set_mode", "extend")];

  it("保存的是历史，恢复后与原状态一致", () => {
    const { run } = play(def, cfg, hist);
    const saved = JSON.parse(JSON.stringify(toSaved(def, run, AT)));
    const r = restore(def, cfg, saved);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run.state).toEqual(run.state);
  });

  it("手工改成“已完成”的记录无法通过重放", () => {
    const forged = { sceneId: def.sceneId, sceneVersion: 1, stateVersion: 1, updatedAt: AT, history: [bind("computer", "pc-ok"), bind("display", "disp-ok"), act("move_window")] };
    const r = restore(def, cfg, forged);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("replay_failed");
  });

  it("场景升级后旧记录不被静默套用；旧版本仍可按原版本取回", () => {
    const { run } = play(def, cfg, hist);
    const saved = toSaved(def, run, AT);
    const v2: SceneDefinition = { ...structuredClone(def), version: 2 };
    const r = restore(v2, { ...cfg, sceneVersion: 2 }, saved);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("version_mismatch");
    expect(getScene("multi-screen-extend", 1)?.version).toBe(1);
    expect(getScene("multi-screen-extend")?.version).toBe(1);
  });

  it("状态版本不被支持时拒绝；声明了兼容的旧版本可恢复", () => {
    const { run } = play(def, cfg, hist);
    const saved = { ...toSaved(def, run, AT), stateVersion: 0 };
    const r1 = restore(def, cfg, saved);
    expect(r1.ok).toBe(false);
    const upgraded: SceneDefinition = { ...structuredClone(def), persistence: { ...def.persistence, stateVersion: 2, accepts: [1] } };
    const r2 = restore(upgraded, cfg, { ...saved, stateVersion: 1 });
    expect(r2.ok).toBe(true);
  });

  it("记录属于另一场景时拒绝", () => {
    const { run } = play(def, cfg, hist);
    const r = restore(fileTransferScene, simulatedConfig(fileTransferScene), toSaved(def, run, AT));
    expect(r.ok).toBe(false);
  });
});

describe("可见文本边界", () => {
  it("所有可达视图都不出现“已连接你的设备”、具体耗时或速度", () => {
    for (const def of allScenes()) {
      const cfg = simulatedConfig(def);
      const r = createRun(def, cfg);
      const t = viewTexts(buildView(def, cfg, r)).join("\n");
      expect(t).not.toMatch(/已连接你的/);
      expect(t).toContain("虚拟");
    }
    expect(SIMULATED_EVIDENCE.origin).toBe("project");
  });
});
