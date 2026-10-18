import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SessionSnapshotSchema, verifyRecoveryPack } from "@hwpc/contracts";
import { createMockAdvisorEngine, createMockDataService, createMockKnowledgeService, createMockModelService, mockSceneDefinitions } from "@hwpc/fixtures";
import { SceneRegistry } from "../src/registry.js";
import { FileSessionStore } from "../src/store.js";
import { SessionManager } from "../src/sessions.js";

describe("会话确认、场景动作与文件恢复", () => {
  it("未确认无法组装；确认绑定版本；动作不改需求；反馈后旧方案过期；重开恢复", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwpc-session-test-"));
    let sessionFile: string | undefined;
    try {
      const deps = { store: new FileSessionStore(dir), advisor: createMockAdvisorEngine(), data: createMockDataService(), model: createMockModelService(), knowledge: createMockKnowledgeService(), registry: new SceneRegistry({ definitions: mockSceneDefinitions }) };
      const manager = new SessionManager(deps);
      let snap = SessionSnapshotSchema.parse(await manager.create("我经常出差办公，预算5000元，希望轻一点"));
      sessionFile = path.join(dir, `${snap.sessionId}.json`);
      expect(snap.isMock).toBe(true);
      expect(snap.needs.summary.confirmable).toBe(true);
      expect(snap.plan.canCompose).toBe(false);
      await expect(manager.compose(snap.sessionId, snap.revision)).rejects.toMatchObject({ code: "needs_confirmation" });
      expect(() => manager.confirm(snap.sessionId, snap.needs.version, "old", snap.revision)).toThrow("摘要已更新");
      const confirmed = manager.confirm(snap.sessionId, snap.needs.version, snap.needs.summary.fingerprint, snap.revision);
      expect(confirmed.duplicate).toBe(false);
      snap = confirmed.snapshot;
      expect(manager.confirm(snap.sessionId, snap.needs.version, snap.needs.summary.fingerprint, snap.revision).duplicate).toBe(true);
      snap = await manager.compose(snap.sessionId, snap.revision);
      expect(snap.plan.current?.needVersion).toBe(snap.needs.version);
      const planVersion = snap.plan.current!.version;
      const pack = manager.export(snap.sessionId);
      expect(verifyRecoveryPack(pack).ok).toBe(true);
      snap = await manager.explore(snap.sessionId, "mock-commute-day", 1, snap.revision);
      const instance = snap.scenes.instances.at(-1)!.instance;
      const beforeNeed = snap.needs.version;
      snap = manager.action(snap.sessionId, instance.instanceId, "go_meeting", snap.revision);
      expect(snap.needs.version).toBe(beforeNeed);
      expect(snap.scenes.instances.at(-1)!.experience.currentStateId).toBe("meeting");
      snap = await manager.feedback(snap.sessionId, { kind: "change_need", text: "以后主要剪视频", needKey: "task", entryId: snap.needs.entries.find((e) => e.key === "task")!.entryId, baseRevision: snap.revision });
      expect(snap.needs.version).toBeGreaterThan(beforeNeed);
      expect(snap.plan.versions.find((p) => p.version === planVersion)?.status).toBe("stale");
      const reopened = new SessionManager({ ...deps, store: new FileSessionStore(dir) }).get(snap.sessionId);
      expect(reopened.revision).toBe(snap.revision);
      expect(reopened.scenes.instances.at(-1)!.experience.currentStateId).toBe("meeting");
    } finally {
      if (sessionFile && fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
      fs.rmdirSync(dir);
    }
  });
});
