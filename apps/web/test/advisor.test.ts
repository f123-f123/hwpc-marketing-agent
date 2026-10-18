import { beforeEach, describe, expect, it } from "vitest";

// 模拟浏览器环境（MockAdvisorClient 用到 localStorage 与 window.setTimeout）
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  window: globalThis,
});

const { MockAdvisorClient } = await import("../src/advisor/mock/mockClient");
const { buildInteractiveHtml, buildPlatformCopy, buildReportMarkdown, statusNotice } = await import("../src/advisor/exporters");
const { checkPlan } = await import("../src/advisor/resolve");

type Client = InstanceType<typeof MockAdvisorClient>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | false | undefined>, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("waitFor 超时");
    await sleep(25);
  }
}

function fresh(): Client {
  store.clear();
  const c = new MockAdvisorClient();
  c.speed.value = 40;
  return c;
}

async function toSummary(c: Client, scope = "air14", battery = "omit") {
  let s = await c.createSession("想买轻薄本");
  expect(s.phase).toBe("discussing");
  expect(s.versions).toHaveLength(0); // 模糊输入不出作品
  expect(s.questions.length).toBeGreaterThan(0);
  expect(s.questions.length).toBeLessThanOrEqual(3);
  s = await c.submitAnswers(s.sessionId, { answers: [], freeText: "给大学新生，发小红书，要互动网页，重点看便携", baseRevision: s.revision });
  s = await waitFor(async () => {
    const x = await c.getSnapshot(s.sessionId);
    return x && x.phase === "discussing" && x.questions.some((q) => q.questionId === "q-scope") ? x : false;
  });
  s = await c.submitAnswers(s.sessionId, {
    answers: [
      { questionId: "q-scope", optionValue: scope },
      { questionId: "q-battery", optionValue: battery },
    ],
    baseRevision: s.revision,
  });
  expect(s.phase).toBe("awaiting_confirmation");
  return s;
}

async function delivered(c: Client, scope = "air14") {
  const s = await toSummary(c, scope);
  await c.confirmSummary(s.sessionId, { summaryId: s.summary!.summaryId, requirementVersion: s.summary!.requirementVersion });
  return waitFor(async () => {
    const x = await c.getSnapshot(s.sessionId);
    return x?.phase === "delivered" ? x : false;
  });
}

describe("需求沟通与确认", () => {
  beforeEach(() => store.clear());

  it("模糊输入进入沟通：不出作品，也没有摘要", async () => {
    const c = fresh();
    const s = await c.createSession("想买轻薄本");
    expect(s.versions).toEqual([]);
    expect(s.summary).toBeUndefined();
    expect(s.backend.mockInUse).toBe(true);
  });

  it("一段话同时覆盖多个问题，并区分来源", async () => {
    const c = fresh();
    let s = await c.createSession("想买轻薄本");
    s = await c.submitAnswers(s.sessionId, { answers: [], freeText: "给大学新生，发小红书", baseRevision: s.revision });
    const req = Object.fromEntries(s.requirements.map((r) => [r.key, r]));
    expect(req["audience"]!.value).toBe("大学新生");
    expect(req["channel"]!.value).toBe("小红书");
    expect(req["audience"]!.provenance).toBe("user_said");
    expect(req["goal"]!.provenance).toBe("system_suggested");
    expect(req["constraints"]!.provenance).toBe("assumed_default");
  });

  it("检索进度来自模拟步骤并标明 simulated；未知项不当作满足", async () => {
    const c = fresh();
    let s = await c.createSession("给大学新生发小红书");
    expect(s.phase).toBe("retrieving");
    s = await waitFor(async () => {
      const x = await c.getSnapshot(s.sessionId);
      return x && x.phase !== "retrieving" ? x : false;
    });
    expect(s.progress.length).toBeGreaterThan(0);
    expect(s.progress.every((p) => p.simulated)).toBe(true);
    const air16 = s.candidates.find((x) => x.candidateId === "mock-air-16");
    expect(air16?.evidence.filter((e) => e.status === "unknown").length).toBeGreaterThan(0);
  });

  it("确认前没有任何作品；重复确认不会重复生成", async () => {
    const c = fresh();
    const s = await toSummary(c);
    expect(s.versions).toHaveLength(0);
    const ref = { summaryId: s.summary!.summaryId, requirementVersion: s.summary!.requirementVersion };
    const r1 = await c.confirmSummary(s.sessionId, ref);
    expect(r1.status).toBe("accepted");
    await c.confirmSummary(s.sessionId, ref); // 重复点击
    const fin = await waitFor(async () => {
      const x = await c.getSnapshot(s.sessionId);
      return x?.phase === "delivered" ? x : false;
    });
    expect(fin.versions).toHaveLength(1);
  });

  it("旧摘要标识被拒绝，不触发生成", async () => {
    const c = fresh();
    const s = await toSummary(c);
    const oldRef = { summaryId: s.summary!.summaryId, requirementVersion: s.summary!.requirementVersion };
    c.simulateOtherWindowEdit(s.sessionId);
    const r = await c.confirmSummary(s.sessionId, oldRef);
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") {
      expect(r.reason).toBe("stale_summary");
      expect(r.snapshot.summary!.requirementVersion).toBe(oldRef.requirementVersion + 1);
    }
    await sleep(300);
    const after = await c.getSnapshot(s.sessionId);
    expect(after!.versions).toHaveLength(0);
    expect(after!.phase).toBe("awaiting_confirmation");
  });

  it("修改摘要后产生新版本，旧确认失效", async () => {
    const c = fresh();
    const s = await toSummary(c);
    const ref = { summaryId: s.summary!.summaryId, requirementVersion: s.summary!.requirementVersion };
    const s2 = await c.reviseSummary(s.sessionId, ref, [{ key: "direction", value: "以一次期末周为线索" }]);
    expect(s2.summary!.requirementVersion).toBe(ref.requirementVersion + 1);
    expect(s2.summary!.affected).toContain("核心方向");
    const r = await c.confirmSummary(s.sessionId, ref);
    expect(r.status).toBe("rejected");
  });

  it("存在阻塞项的摘要不能确认", async () => {
    const c = fresh();
    const s = await toSummary(c, "air14", "force");
    expect(s.summary!.blockers.length).toBeGreaterThan(0);
    const r = await c.confirmSummary(s.sessionId, { summaryId: s.summary!.summaryId, requirementVersion: s.summary!.requirementVersion });
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("blocked");
  });

  it("过期的页面修订号被拒绝", async () => {
    const c = fresh();
    const s = await c.createSession("想买轻薄本");
    await expect(c.sendMessage(s.sessionId, "给学生", s.revision - 1)).rejects.toMatchObject({ code: "stale_revision" });
  });

  it("修改前面的表达会重放后续内容", async () => {
    const c = fresh();
    let s = await c.createSession("想买轻薄本");
    s = await c.submitAnswers(s.sessionId, { answers: [], freeText: "给大学新生，发小红书", baseRevision: s.revision });
    const target = s.messages.find((m) => m.role === "user" && m.text.includes("大学新生"))!;
    expect(target.editable).toBe(true);
    s = await c.editMessage(s.sessionId, target.messageId, "给职场人士，发公众号", s.revision);
    const req = Object.fromEntries(s.requirements.map((r) => [r.key, r.value]));
    expect(req["audience"]).toBe("职场/商务用户");
    expect(req["channel"]).toBe("公众号");
  });

  it("刷新恢复：新客户端实例读取同一会话", async () => {
    const c = fresh();
    const s = await toSummary(c);
    const c2 = new MockAdvisorClient();
    const r = await c2.getSnapshot(s.sessionId);
    expect(r!.summary!.summaryId).toBe(s.summary!.summaryId);
    expect(r!.messages.length).toBe(s.messages.length);
    expect(r!.phase).toBe("awaiting_confirmation");
  });
});

describe("作品、版本与互动", () => {
  it("确认后才有作品，且标注 MOCK 与当前需求", async () => {
    const c = fresh();
    const s = await delivered(c);
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0]!.currentRequirement).toBe(true);
    const w = await c.getWork(s.sessionId, 1);
    expect(w.result.isMock).toBe(true);
    expect(w.interactive).toBeDefined();
  });

  it("互动网页：所有状态（含非默认状态）都已核验且引用属于当前版本", async () => {
    const c = fresh();
    const s = await delivered(c, "compare");
    const w = await c.getWork(s.sessionId, 1);
    const chk = checkPlan(w.interactive!, w.result);
    expect(chk.blocked).toEqual([]);
    expect(chk.renderable.size).toBe(w.interactive!.verifiedStateIds.length);
    const ports = w.interactive!.compare!.rows.find((r) => r.rowId === "r-ports")!;
    expect(ports.cells.find((x) => x.productId === "mock-air-16")!.factIds).toEqual([]);
  });

  it("未核验或引用缺失的互动状态被拒绝渲染", async () => {
    const c = fresh();
    const s = await delivered(c);
    const w = await c.getWork(s.sessionId, 1);
    const plan = structuredClone(w.interactive!);
    plan.claims.push({ stateId: "claim-ghost", headline: "幽灵", factIds: ["mock-f-002"], imageIds: [] });
    plan.claims.push({ stateId: "claim-bad", headline: "坏引用", factIds: ["no-such-fact"], imageIds: [] });
    plan.verifiedStateIds.push("claim-bad");
    const chk = checkPlan(plan, w.result);
    expect(chk.renderable.has("claim-ghost")).toBe(false);
    expect(chk.renderable.has("claim-bad")).toBe(false);
    expect(chk.blocked.map((b) => b.stateId).sort()).toEqual(["claim-bad", "claim-ghost"]);
  });

  it("续航被省略时，作品与互动里都没有续航，核验记录了删除", async () => {
    const c = fresh();
    const s = await delivered(c);
    const w = await c.getWork(s.sessionId, 1);
    expect(w.result.article.blocks.some((b) => b.type === "paragraph" && b.heading === "撑一天")).toBe(false);
    expect(w.result.verification.findings.some((f) => f.resolution === "removed")).toBe(true);
    expect(JSON.stringify(w.interactive)).not.toContain("mock-f-003");
  });

  it("关键需求变更：旧版本失效，需重新确认，重新确认后新旧版本各自标注", async () => {
    const c = fresh();
    const s = await delivered(c);
    const s2 = await c.requestRequirementChange(s.sessionId, "改成只看 16 寸", 1);
    expect(s2.phase).toBe("awaiting_confirmation");
    expect(s2.summary!.requirementVersion).toBeGreaterThan(1);
    expect(s2.summary!.affected).toContain("产品范围");
    expect(s2.versions[0]!.currentRequirement).toBe(false);
    expect(s2.versions[0]!.staleReason).toMatch(/需求/);
    const r = await c.confirmSummary(s.sessionId, { summaryId: s2.summary!.summaryId, requirementVersion: s2.summary!.requirementVersion });
    expect(r.status).toBe("accepted");
    const s3 = await waitFor(async () => {
      const x = await c.getSnapshot(s.sessionId);
      return x?.versions.length === 2 && x.phase === "delivered" ? x : false;
    });
    expect(s3.versions[0]!.currentRequirement).toBe(false);
    expect(s3.versions[1]!.currentRequirement).toBe(true);
    expect(statusNotice(await c.getWork(s.sessionId, 1)).join("")).toContain("历史版本");
  });

  it("内容修改生成新版本且不改变需求版本", async () => {
    const c = fresh();
    const s = await delivered(c);
    await c.requestWorkRevision(s.sessionId, "语气更轻松", 1);
    const s2 = await waitFor(async () => {
      const x = await c.getSnapshot(s.sessionId);
      return x?.versions.length === 2 && x.phase === "delivered" ? x : false;
    });
    expect(s2.versions[1]!.requirementVersion).toBe(s2.versions[0]!.requirementVersion);
    expect(s2.versions[0]!.currentRequirement).toBe(false);
    expect(s2.versions[1]!.currentRequirement).toBe(true);
  });

  it("制作中断：刷新后显示中断，可继续", async () => {
    const c = fresh();
    c.speed.value = 1;
    const s = await toSummary(c);
    await c.confirmSummary(s.sessionId, { summaryId: s.summary!.summaryId, requirementVersion: s.summary!.requirementVersion });
    const c2 = new MockAdvisorClient();
    const r = await c2.getSnapshot(s.sessionId);
    expect(r!.phase).toBe("interrupted");
    expect(r!.error?.recoverable).toBe(true);
    c2.speed.value = 40;
    await c2.resume(s.sessionId);
    const fin = await waitFor(async () => {
      const x = await c2.getSnapshot(s.sessionId);
      return x?.phase === "delivered" ? x : false;
    });
    expect(fin.versions).toHaveLength(1);
  });
});

describe("导出", () => {
  it("平台正文保留事实限制与 MOCK 说明；历史版本带警示", async () => {
    const c = fresh();
    const s = await delivered(c);
    const copy = buildPlatformCopy(await c.getWork(s.sessionId, 1));
    expect(copy.content).toContain("MOCK");
    expect(copy.content).toContain("注：");
    expect(copy.content).toContain("实际重量因配置而异");
    await c.requestRequirementChange(s.sessionId, "改成只看 16 寸", 1);
    expect(buildPlatformCopy(await c.getWork(s.sessionId, 1)).content).toContain("历史版本");
  });

  it("阻止交付状态不会被导出隐藏", async () => {
    const c = fresh();
    const s = await delivered(c);
    const w = await c.getWork(s.sessionId, 1);
    w.result.verification.deliveryStatus = "blocked";
    expect(statusNotice(w).join("")).toContain("阻止交付");
    expect(buildReportMarkdown(w).content).toContain("阻止交付");
    expect(buildPlatformCopy(w).content).toContain("阻止交付");
  });

  it("报告包含赛题四部分", async () => {
    const c = fresh();
    const s = await delivered(c);
    const md = buildReportMarkdown(await c.getWork(s.sessionId, 1)).content;
    for (const h of ["一、场景判断", "二、知识库依据", "三、图文软文", "四、核验结果"]) expect(md).toContain(h);
  });

  it("互动 HTML 自包含：无外部引用，模型文本被转义，未核验状态不写入", async () => {
    const c = fresh();
    const s = await delivered(c, "compare");
    const w = await c.getWork(s.sessionId, 1);
    w.interactive!.intro = `<img src=x onerror=alert(1)> & "q"`;
    w.interactive!.claims.push({ stateId: "ghost", headline: "ghost-claim", factIds: ["mock-f-002"], imageIds: [] });
    const imgs: Record<string, string> = {};
    for (const id of ["mock-i-002", "mock-i-003"]) imgs[id] = c.imageUrl(s.sessionId, 1, id)!;
    const r = buildInteractiveHtml(w, imgs);
    expect(r.content).not.toMatch(/<img src=x/);
    expect(r.content).toContain("&lt;img src=x");
    expect(r.content).not.toMatch(/(src|href)="https?:\/\//);
    expect(r.content).not.toContain("localhost");
    expect(r.content).not.toContain("ghost-claim");
    expect(r.skippedStates.map((x) => x.stateId)).toContain("ghost");
    expect(r.imageCount).toBeGreaterThan(0);
    expect(r.content).toContain("MOCK");
    expect(r.content).toContain("资料未提供");
    expect(r.content.match(/<script>/g)).toHaveLength(1);
  });

  it("图片不可用时 HTML 如实标明", async () => {
    const c = fresh();
    const s = await delivered(c);
    const r = buildInteractiveHtml(await c.getWork(s.sessionId, 1), {});
    expect(r.missingImages.length).toBeGreaterThan(0);
    expect(r.content).toContain("图片暂不可用");
  });
});
