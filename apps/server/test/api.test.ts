import { describe, expect, it } from "vitest";
import { ExportResponseSchema, GetEventsResponseSchema, TaskSnapshotSchema, ConnectionStatusSchema } from "@hwpc/contracts";
import { createMockDataService, createMockModelService, createMockWorkflow, mockTaskInput } from "@hwpc/fixtures";
import { createApp } from "../src/app.js";
import { TaskManager } from "../src/tasks.js";

function setup() {
  const data = createMockDataService();
  const model = createMockModelService();
  const tasks = new TaskManager(createMockWorkflow({ data, model }));
  return createApp({ data, model, tasks, corsOrigin: "http://localhost:5173" });
}
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(app: ReturnType<typeof setup>, id: string, status: string) {
  for (let i = 0; i < 50; i++) {
    const snap = TaskSnapshotSchema.parse(await (await app.request(`/api/tasks/${id}`)).json());
    if (snap.status === status) return snap;
    await sleep(10);
  }
  throw new Error(`任务未进入 ${status}`);
}

describe("HTTP 接口（mock 工作流）", () => {
  it("状态接口标明 mock", async () => {
    const res = await setup().request("/api/status");
    const s = ConnectionStatusSchema.parse(await res.json());
    expect(s.mockInUse).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/apiKey/i);
  });

  it("提交 → 完成 → 事件 → 导出", async () => {
    const app = setup();
    const created = (await (await app.request("/api/tasks", json({ input: mockTaskInput }))).json()) as { taskId: string };
    const snap = await waitFor(app, created.taskId, "completed");
    expect(snap.latestVersion?.version).toBe(1);
    const ev = GetEventsResponseSchema.parse(await (await app.request(`/api/tasks/${created.taskId}/events?after=0`)).json());
    expect(ev.events.length).toBeGreaterThan(0);
    expect(ev.events.some((e) => e.simulated)).toBe(true);
    const exp = ExportResponseSchema.parse(await (await app.request(`/api/tasks/${created.taskId}/export?format=markdown`)).json());
    expect(exp.isMock).toBe(true);
    expect(exp.content).toContain("MOCK");
    const img = await app.request(`/api/tasks/${created.taskId}/images/mock-i-001`);
    expect(img.headers.get("content-type")).toBe("image/svg+xml");
  });

  it("信息不足 → 追问 → 回答 → 完成；修改 → 新版本", async () => {
    const app = setup();
    const { platform: _p, ...noPlatform } = mockTaskInput;
    const created = (await (await app.request("/api/tasks", json({ input: noPlatform }))).json()) as { taskId: string };
    const waiting = await waitFor(app, created.taskId, "awaiting_clarification");
    expect(waiting.pendingQuestions[0]?.field).toBe("platform");

    const bad = await app.request(`/api/tasks/${created.taskId}/revisions`, json({ instruction: "x" }));
    expect(bad.status).toBe(409);

    const ok = await app.request(`/api/tasks/${created.taskId}/answers`, json({ answers: [{ questionId: "q-platform", answer: "wechat_article" }] }));
    expect(ok.status).toBe(202);
    await waitFor(app, created.taskId, "completed");

    const rev = await app.request(`/api/tasks/${created.taskId}/revisions`, json({ instruction: "删掉接口段落" }));
    expect(rev.status).toBe(202);
    await sleep(30);
    const done = await waitFor(app, created.taskId, "completed");
    expect(done.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(done.latestVersion?.reason).toBe("revision");
  });

  it("错误语义", async () => {
    const app = setup();
    expect((await app.request("/api/tasks/nope")).status).toBe(404);
    expect((await app.request("/api/tasks", json({ input: {} }))).status).toBe(400);
    expect((await app.request("/api/tasks", { method: "POST", body: "{bad" })).status).toBe(400);
  });
});
