import { describe, expect, it } from "vitest";
import { SessionSnapshotSchema, verifyRecoveryPack, type SessionSnapshot } from "@hwpc/contracts";
import { createMockAdvisorEngine, createMockDataService, createMockKnowledgeService, createMockModelService, mockSceneDefinitions } from "@hwpc/fixtures";
import { createApp } from "../src/app.js";
import { SceneRegistry } from "../src/registry.js";
import { MemorySessionStore } from "../src/store.js";
import { SessionManager } from "../src/sessions.js";

/**
 * HTTP 纵向链路：/api/scenes → 建会话 → 确认 → 组装方案 → 说明性体验 → 动作 → 反馈 → 导出。
 * 用 Hono 的 app.request 直接打路由，不监听端口。
 */
function setup() {
  const registry = new SceneRegistry({ definitions: mockSceneDefinitions });
  const sessions = new SessionManager({
    store: new MemorySessionStore(),
    advisor: createMockAdvisorEngine(),
    data: createMockDataService(),
    model: createMockModelService(),
    knowledge: createMockKnowledgeService(),
    registry,
  });
  const app = createApp({
    data: createMockDataService(),
    model: createMockModelService(),
    tasks: { create: () => { throw new Error("本测试不涉及营销任务"); } } as never,
    sessions,
    dataMode: "mock",
    corsOrigin: "*",
  });
  return { app, sessions };
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("HTTP 会话纵向链路", () => {
  it("场景目录非空，且 建会话→确认→方案→体验→动作→反馈→导出 全链路可用", async () => {
    const { app } = setup();

    const catalog = await app.request("/api/scenes");
    expect(catalog.status).toBe(200);
    const scenes = (await catalog.json()) as { sceneId: string; version: number; integrity: string }[];
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.every((s) => s.integrity !== "hash_mismatch")).toBe(true);

    let snap: SessionSnapshot = SessionSnapshotSchema.parse(
      await (await app.request("/api/sessions", json({ text: "我常出差办公，预算6000元，希望轻一点" }))).json(),
    );
    expect(snap.scenes.catalog.length).toBeGreaterThan(0);
    expect(snap.plan.canCompose).toBe(false);

    // 未确认不能组装
    const denied = await app.request(`/api/sessions/${snap.sessionId}/plan`, json({ baseRevision: snap.revision }));
    expect(denied.status).toBe(409);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("needs_confirmation");

    const confirmed = await app.request(
      `/api/sessions/${snap.sessionId}/confirm`,
      json({ needVersion: snap.needs.version, fingerprint: snap.needs.summary.fingerprint, baseRevision: snap.revision }),
    );
    expect(confirmed.status).toBe(200);
    snap = SessionSnapshotSchema.parse(((await confirmed.json()) as { snapshot: unknown }).snapshot);
    expect(snap.needs.status).toBe("confirmed");

    const planned = await app.request(`/api/sessions/${snap.sessionId}/plan`, json({ baseRevision: snap.revision }));
    expect(planned.status).toBe(200);
    snap = SessionSnapshotSchema.parse(await planned.json());
    expect(snap.plan.current?.needVersion).toBe(snap.needs.version);

    const target = scenes[0]!;
    const explored = await app.request(
      `/api/sessions/${snap.sessionId}/explore`,
      json({ sceneId: target.sceneId, version: target.version, baseRevision: snap.revision }),
    );
    expect(explored.status).toBe(200);
    snap = SessionSnapshotSchema.parse(await explored.json());
    const instance = snap.scenes.instances.at(-1)!;
    expect(instance.instance.mode).toBe("exploratory");
    expect(instance.instance.applicability.result).toBe("illustrative");

    const firstAction = instance.definition.actions.find((a) => a.from.includes(instance.experience.currentStateId))!;
    const acted = await app.request(
      `/api/sessions/${snap.sessionId}/instances/${instance.instance.instanceId}/actions`,
      json({ actionId: firstAction.actionId, baseRevision: snap.revision }),
    );
    expect(acted.status).toBe(200);
    snap = SessionSnapshotSchema.parse(await acted.json());
    expect(snap.scenes.instances.at(-1)!.experience.currentStateId).toBe(firstAction.to);

    const needVersionBefore = snap.needs.version;
    const feedback = await app.request(
      `/api/sessions/${snap.sessionId}/feedback`,
      json({ kind: "concern", text: "担心出差时机身太重", baseRevision: snap.revision }),
    );
    expect(feedback.status).toBe(200);
    snap = SessionSnapshotSchema.parse(await feedback.json());
    expect(snap.feedback).toHaveLength(1);
    expect(snap.needs.version).toBeGreaterThanOrEqual(needVersionBefore);

    const exported = await app.request(`/api/sessions/${snap.sessionId}/export?format=recovery_json`);
    expect(exported.status).toBe(200);
    const pack: unknown = await exported.json();
    expect(verifyRecoveryPack(pack).ok).toBe(true);

    const html = await app.request(`/api/sessions/${snap.sessionId}/export?format=recovery_html`);
    expect(html.status).toBe(200);
    const body = await html.text();
    expect(body).toContain("只读副本");
    expect(body).not.toContain("<script");

    const list = (await (await app.request("/api/sessions")).json()) as { sessions: unknown[]; unreadable: unknown[] };
    expect(list.sessions.length).toBe(1);
    expect(list.unreadable.length).toBe(0);
  });
});
