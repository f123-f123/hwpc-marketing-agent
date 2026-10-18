import { describe, expect, it } from "vitest";
import type { AdvisorEngine } from "@hwpc/contracts";
import { createMockAdvisorEngine, createMockDataService, createMockKnowledgeService, createMockModelService, mockSceneDefinitions } from "@hwpc/fixtures";
import { SceneRegistry } from "../src/registry.js";
import { MemorySessionStore } from "../src/store.js";
import { SessionManager } from "../src/sessions.js";

/** 回复前先等待一段时间的引擎，模拟真实模型的响应延迟。 */
function slowEngine(ms: number): AdvisorEngine {
  const inner = createMockAdvisorEngine();
  const wait = () => new Promise((r) => setTimeout(r, ms));
  return {
    isMock: inner.isMock,
    respond: async (...args) => { await wait(); return inner.respond(...args); },
    answer: (...args) => inner.answer(...args),
    interpretFeedback: (...args) => inner.interpretFeedback(...args),
    composePlan: (...args) => inner.composePlan(...args),
  };
}

function managerOn(store: MemorySessionStore, advisor: AdvisorEngine = createMockAdvisorEngine()) {
  return new SessionManager({
    store,
    advisor,
    data: createMockDataService(),
    model: createMockModelService(),
    knowledge: createMockKnowledgeService(),
    registry: new SceneRegistry({ definitions: mockSceneDefinitions }),
  });
}

const FIRST = "我经常出差办公，预算5000元，希望轻一点";

describe("会话写入一致性", () => {
  it("同一进程：确认排在等待模型的消息之后，基于旧快照的确认被拒绝而不是被覆盖", async () => {
    const store = new MemorySessionStore();
    const manager = managerOn(store, slowEngine(30));
    const snap = await manager.create(FIRST);

    const pendingMessage = manager.message(snap.sessionId, "主要写文档", snap.revision);
    const pendingConfirm = manager.confirm(snap.sessionId, snap.needs.version, snap.needs.summary.fingerprint, snap.revision);

    const afterMessage = await pendingMessage;
    await expect(pendingConfirm).rejects.toMatchObject({ code: "stale_revision" });
    expect(afterMessage.conversation.messages.at(-1)?.role).toBe("advisor");
    expect(manager.get(snap.sessionId).revision).toBe(afterMessage.revision);
  });

  it("两个管理器共用存储：后提交的过期写入在落盘前被发现", async () => {
    const store = new MemorySessionStore();
    const slow = managerOn(store, slowEngine(30));
    const fast = managerOn(store);
    const snap = await fast.create(FIRST);

    const pendingMessage = slow.message(snap.sessionId, "主要写文档", snap.revision);
    await new Promise((r) => setTimeout(r, 5)); // 让慢请求先读入记录、进入等待模型的阶段
    const confirmed = await fast.confirm(snap.sessionId, snap.needs.version, snap.needs.summary.fingerprint, snap.revision);

    await expect(pendingMessage).rejects.toMatchObject({ code: "stale_revision" });
    expect(fast.get(snap.sessionId).needs.confirmation?.confirmationId).toBe(confirmed.snapshot.needs.confirmation?.confirmationId);
  });

  it("不能确认已经不是当前版本的需求", async () => {
    const manager = managerOn(new MemorySessionStore());
    const first = await manager.create(FIRST);
    const next = await manager.message(first.sessionId, "以后主要剪视频，预算8000元", first.revision);
    expect(next.needs.version).toBeGreaterThan(first.needs.version);
    await expect(manager.confirm(first.sessionId, first.needs.version, first.needs.summary.fingerprint, next.revision)).rejects.toMatchObject({ code: "confirm_rejected" });
  });

  it("重新组装方案时，旧方案的个人场景实例一并被取代", async () => {
    const manager = managerOn(new MemorySessionStore());
    let snap = await manager.create(FIRST);
    snap = (await manager.confirm(snap.sessionId, snap.needs.version, snap.needs.summary.fingerprint, snap.revision)).snapshot;
    snap = await manager.compose(snap.sessionId, snap.revision);
    const v1 = snap.plan.current!.version;
    expect(snap.plan.current!.scenes.length).toBeGreaterThan(0);

    snap = await manager.compose(snap.sessionId, snap.revision);
    const v2 = snap.plan.current!.version;
    expect(v2).toBe(v1 + 1);
    const personal = snap.scenes.instances.filter((v) => v.instance.mode === "personal");
    expect(personal.filter((v) => v.instance.planVersion === v1).every((v) => v.instance.status === "superseded")).toBe(true);
    expect(personal.filter((v) => v.instance.status === "active").every((v) => v.instance.planVersion === v2)).toBe(true);
  });

  it("恢复接口校验 baseRevision", async () => {
    const manager = managerOn(new MemorySessionStore());
    const snap = await manager.create(FIRST);
    await expect(manager.resume(snap.sessionId, snap.revision + 5)).rejects.toMatchObject({ code: "stale_revision" });
    await expect(manager.resume(snap.sessionId, snap.revision)).resolves.toMatchObject({ sessionId: snap.sessionId });
  });
});
