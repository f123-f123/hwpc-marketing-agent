import { describe, expect, it } from "vitest";
import { SessionRecordSchema, SessionSnapshotSchema, type ImageSlot, type SessionSnapshot } from "@hwpc/contracts";
import { createMockAdvisorEngine, createMockDataService, createMockKnowledgeService, createMockModelService, createMockQaEngine, mockSceneDefinitions } from "@hwpc/fixtures";
import type { ImageProvider, PageFillers } from "../src/page/fill.js";
import { SceneRegistry } from "../src/registry.js";
import { MemorySessionStore } from "../src/store.js";
import { SessionManager } from "../src/sessions.js";

function managerWith(opts: { qa?: boolean; fillers?: PageFillers } = {}) {
  const store = new MemorySessionStore();
  const manager = new SessionManager({
    store,
    advisor: createMockAdvisorEngine(),
    ...(opts.qa === false ? {} : { qa: createMockQaEngine() }),
    ...(opts.fillers ? { fillers: opts.fillers } : {}),
    data: createMockDataService(),
    model: createMockModelService(),
    knowledge: createMockKnowledgeService(),
    registry: new SceneRegistry({ definitions: mockSceneDefinitions }),
  });
  return { manager, store };
}

async function composed(manager: SessionManager): Promise<SessionSnapshot> {
  let snap = await manager.create("我经常出差办公，预算6000元，希望轻一点");
  snap = (await manager.confirm(snap.sessionId, snap.needs.version, snap.needs.summary.fingerprint, snap.revision)).snapshot;
  return manager.compose(snap.sessionId, snap.revision);
}

const until = async (check: () => boolean, ms = 500) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};

describe("体验页生成", () => {
  it("方案组装时一起生成，版块顺序固定，推荐的候选在前", async () => {
    const { manager } = managerWith();
    const snap = SessionSnapshotSchema.parse(await composed(manager));
    const page = snap.page!;
    expect(page.planVersion).toBe(snap.plan.current!.version);
    const kinds = page.sections.map((s) => s.kind);
    expect(kinds[0]).toBe("hero");
    expect(kinds[1]).toBe("needs");
    expect(kinds.slice(-2)).toEqual(["experience", "plan"]);
    const cands = page.sections.filter((s) => s.kind === "candidate");
    expect(cands.length).toBe(snap.plan.current!.candidates.length);
    const primary = snap.plan.current!.recommendation.primary?.productId;
    if (primary) expect(cands[0]!.kind === "candidate" && cands[0]!.product.productId).toBe(primary);
  });

  it("没有填充器时图片位保持占位，不轮询；文案只用资料原值", async () => {
    const { manager } = managerWith();
    const snap = await composed(manager);
    const page = snap.page!;
    expect(page.filling).toBe(false);
    for (const s of page.sections) {
      if (s.kind === "hero" || s.kind === "candidate") expect(s.image.status).toBe("pending");
      if (s.kind === "candidate") {
        // 大字数字必须出自该候选的知识库事实
        const pack = await createMockDataService().getMaterialPack({ taskId: "t", product: s.product });
        for (const h of s.highlights) expect(pack.facts.some((f) => f.factId === h.factId && f.value === h.value)).toBe(true);
        if (s.intro.status === "filled") expect(s.intro.origin).toBe("template");
      }
    }
  });

  it("配置了填充器时异步补图，写回后标明来源；找不到的位置记为失败", async () => {
    const found: ImageProvider = {
      name: "测试图源",
      canFill: (slot) => slot.product !== undefined,
      fill: async (slot) => ({ url: `/img/${slot.product!.productId}.png`, alt: slot.intent, origin: "local" }),
    };
    const { manager } = managerWith({ fillers: { images: [found], copies: [] } });
    const snap = await composed(manager);
    expect(snap.page!.filling).toBe(true);
    await until(() => manager.get(snap.sessionId).page?.filling === false);
    const after = manager.get(snap.sessionId).page!;
    const imgs = after.sections.flatMap((s): ImageSlot[] => (s.kind === "candidate" || s.kind === "hero" ? [s.image] : []));
    const candImgs = after.sections.flatMap((s) => (s.kind === "candidate" ? [s.image] : []));
    expect(candImgs.every((i) => i.status === "filled" && i.image?.origin === "local")).toBe(true);
    // 开场图没有绑定产品，这个填充器不处理，仍是占位
    expect(imgs.find((i) => !i.product)?.status).toBe("pending");
  });

  it("旧的会话记录没有 pages / qa 字段也能读出", () => {
    const parsed = SessionRecordSchema.safeParse({
      schema: "hwpc.session.v1", sessionId: "s", createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", revision: 0,
      usedMock: { engine: true, knowledge: false, data: true }, messages: [],
      needVersions: [{ version: 1, fingerprint: "f", criticalFingerprint: "c", createdAt: "2026-10-20T00:00:00.000Z", reason: "init", entries: [] }],
      confirmations: [], questions: [], candidates: [], rejectedProductIds: [], excludedScenes: [], sceneDefinitions: {}, instances: [], experiences: [],
      plans: [], planNotes: [], feedback: [], impacts: [], runState: { state: "idle", at: "2026-10-20T00:00:00.000Z" }, audit: [],
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 2))).toBe(true);
    if (parsed.success) expect(parsed.data.pages).toEqual([]);
  });
});

describe("体验页侧边提问（答疑智能体）", () => {
  it("只记录问答，需求、方案、页面都不变", async () => {
    const { manager } = managerWith();
    const before = await composed(manager);
    const after = await manager.ask(before.sessionId, "推荐哪一款？为什么", before.revision);
    expect(after.qa).toHaveLength(1);
    expect(after.qa[0]!.reply).toContain("模拟答疑");
    expect(after.qa[0]!.isMock).toBe(true);
    expect(after.needs.version).toBe(before.needs.version);
    expect(after.needs.status).toBe("confirmed");
    expect(after.plan.current!.version).toBe(before.plan.current!.version);
    expect(after.page).toEqual(before.page);
  });

  it("问题像是在改需求时，只提示回到需求沟通", async () => {
    const { manager } = managerWith();
    const before = await composed(manager);
    const after = await manager.ask(before.sessionId, "其实我预算能提高到 8000", before.revision);
    expect(after.qa[0]!.suggestNeedChange).toBe(true);
    expect(after.needs.version).toBe(before.needs.version);
  });

  it("问资料里没有的参数时如实说没有依据", async () => {
    const { manager } = managerWith();
    const before = await composed(manager);
    const after = await manager.ask(before.sessionId, "处理器性能怎么样", before.revision);
    expect(after.qa[0]!.reply).toMatch(/没有找到|处理器/);
  });

  it("没有接入答疑智能体时记一条失败回复，而不是假装回答", async () => {
    const { manager } = managerWith({ qa: false });
    const before = await composed(manager);
    const after = await manager.ask(before.sessionId, "推荐哪一款", before.revision);
    expect(after.qa[0]!.failed).toBe(true);
    expect(after.qa[0]!.reply).toContain("未配置");
  });

  it("还没有体验页时不能提问", async () => {
    const { manager } = managerWith();
    const snap = await manager.create("我经常出差办公");
    await expect(manager.ask(snap.sessionId, "推荐哪一款", snap.revision)).rejects.toMatchObject({ code: "invalid_state" });
  });
});
