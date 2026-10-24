import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogDetailSchema, CatalogOverviewSchema, LibraryDocContentSchema, type FactRecord, type PriceRecord } from "@hwpc/contracts";
import { createDataService, createLocalLibrary } from "@hwpc/data";
import { defaultLocalRoot } from "../../../packages/data/src/local.js";
import { createMockDataService, createMockModelService } from "@hwpc/fixtures";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/marketing/auth.js";
import { CatalogService, coverOf, figuresOf, mergeFacts, priceOf } from "../src/marketing/catalog.js";
import { MarketingRepo } from "../src/marketing/repo.js";
import { SecretBox, TokenSigner } from "../src/marketing/security.js";
import { MarketingService } from "../src/marketing/service.js";
import { SettingsService } from "../src/marketing/settings.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwpc-catalog-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const repo = new MarketingRepo(dir);
  const secret = Buffer.from("test-master-secret-0123456789");
  const box = new SecretBox(secret);
  const auth = new AuthService(repo, new TokenSigner(secret));
  auth.seed({ hqPassword: "hq-pass-123", storePassword: "store-pass-123" });
  const settings = new SettingsService(repo, box, { timeoutMs: 1000 });
  const data = createMockDataService();
  const service = new MarketingService({ repo, data, settings, box });
  const app = createApp({
    data,
    model: createMockModelService(),
    tasks: { create: () => { throw new Error("不涉及"); } } as never,
    marketing: { auth, service, settings, catalog: new CatalogService({ data }), secureCookie: false },
    dataMode: "mock",
    corsOrigin: "*",
  });
  return { app };
}

async function cookieOf(app: ReturnType<typeof setup>["app"], username: string, password: string) {
  const r = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  return r.headers.get("set-cookie")!.split(";")[0]!;
}

const fact = (field: string, value: string, category: FactRecord["category"], reviewStatus: FactRecord["reviewStatus"] = "verified"): FactRecord => ({
  factId: `${field}-${value}`,
  productId: "p",
  configurationIds: [],
  category,
  field,
  value,
  qualifiers: [],
  source: { origin: "local", title: "产品事实", locator: "P1/p/产品事实.md" },
  reviewStatus,
});

describe("资料库：关键参数与价格口径", () => {
  it("关键参数取事实原文，已审核优先；只有待审核时照样列出并标注", () => {
    const figs = figuresOf([
      fact("屏幕·尺寸", "14.2 英寸", "display"),
      fact("尺寸与重量·重量", "约 1.33 kg（圆键盘含电池）", "portability", "pending_review"),
      fact("处理器·CPU", "麒麟 X90", "processor"),
      fact("操作系统", "HarmonyOS 6", "os"),
    ]);
    expect(figs.find((f) => f.label === "屏幕")).toMatchObject({ value: "14.2 英寸", pending: false });
    expect(figs.find((f) => f.label === "重量")).toMatchObject({ value: "约 1.33 kg（圆键盘含电池）", pending: true });
    expect(figs.map((f) => f.label)).toEqual(["系统", "屏幕", "处理器", "重量"]);
  });

  it("“尺寸与重量·长度”不会被当成重量", () => {
    const figs = figuresOf([fact("尺寸与重量·长度", "312.6 mm", "portability"), fact("尺寸与重量·重量", "约 980 g", "portability")]);
    expect(figs.find((f) => f.label === "重量")?.value).toBe("约 980 g");
    expect(figuresOf([fact("尺寸与重量·长度", "312.6 mm", "portability")]).find((f) => f.label === "重量")).toBeUndefined();
  });

  it("各版本取值相同的参数合并成一行，限定条件取并集；取值不同的照常分开", () => {
    const a = { ...fact("屏幕·尺寸", "14 英寸", "display"), factId: "a", qualifiers: ["仅 13 代酷睿版"] };
    const b = { ...fact("屏幕·尺寸", "14 英寸", "display"), factId: "b", qualifiers: ["仅 12 代版"] };
    const c = { ...fact("屏幕·亮度", "300 nits", "display"), factId: "c" };
    const merged = mergeFacts([a, b, c]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ value: "14 英寸", qualifiers: ["仅 13 代酷睿版", "仅 12 代版"] });
    expect(mergeFacts([a, { ...b, reviewStatus: "pending_review" }])).toHaveLength(2);
  });

  it("卡片上去掉值里重复的型号全名，只留版本与数值", () => {
    const figs = figuresOf([fact("尺寸与重量·重量", "HUAWEI MateBook Pro S 标准屏版：798 g", "portability")]);
    expect(figs.find((f) => f.label === "重量")?.value).toBe("标准屏版：798 g");
  });

  it("价格保留口径：优先商城页面价；没有金额时说明“没有可引用的公开金额”", () => {
    const base = { productId: "p", productName: "p", conditions: "", stock: "", checkedAt: "2026-10-17T00:00:00Z", status: "", source: { origin: "local" as const, title: "价格快照", locator: "P1/08/官方价格快照.csv" } };
    const rec = (recordId: string, priceType: string, amount?: number): PriceRecord => ({ ...base, recordId, variant: recordId, priceType, ...(amount ? { amount } : {}) });
    expect(priceOf([rec("a", "官网参考起价", 5799), rec("b", "官方商城页面价", 5899)])).toMatchObject({ amount: 5899, priceType: "官方商城页面价", checkedAt: "2026-10-17" });
    expect(priceOf([rec("a", "官网参考起价", 5799)])?.note).toMatch(/不是当前商城成交价/);
    expect(priceOf([rec("a", "已下架")])).toMatchObject({ offShelf: true, note: "资料里没有可引用的公开金额" });
    expect(priceOf([])).toBeUndefined();
  });
});

describe("资料库：卡片封面", () => {
  const im = (imageId: string, role: "hero" | "color" | "detail", description: string, width: number) => ({
    imageId, productId: "p", configurationIds: [], role, description, width, height: Math.round(width * 0.6),
    source: { origin: "local" as const, title: "图片索引", locator: "P1/p/图片索引.csv" }, access: { kind: "local_file" as const, path: `/kb/${imageId}.jpg` },
  });
  it("外观主视觉优先，处理器、键盘这类细节图排后面", () => {
    expect(coverOf([im("cpu", "detail", "强劲处理器性能", 1920), im("look", "hero", "精致产品外观", 745)])?.imageId).toBe("look");
    expect(coverOf([im("cpu", "detail", "强劲处理器性能", 370), im("collab", "detail", "超级终端协同", 370)])?.imageId).toBe("collab");
    expect(coverOf([im("kb", "detail", "舒适键盘细节", 2175), im("purple", "color", "仲夏紫外观特写", 1260)])?.imageId).toBe("purple");
    expect(coverOf([])).toBeUndefined();
  });
});

describe("资料库接口", () => {
  it("未登录不能看；门店与总部都能看；不存在的型号与文档 404", async () => {
    const { app } = setup();
    expect((await app.request("/api/marketing/catalog")).status).toBe(401);
    for (const [u, p] of [["store001", "store-pass-123"], ["hq", "hq-pass-123"]] as const) {
      const cookie = await cookieOf(app, u, p);
      const r = await app.request("/api/marketing/catalog", { headers: { cookie } });
      expect(r.status).toBe(200);
      const overview = CatalogOverviewSchema.parse(await r.json());
      expect(overview.entries.length).toBeGreaterThan(0);
      expect(overview.isMock).toBe(true);
    }
    const cookie = await cookieOf(app, "store001", "store-pass-123");
    expect((await app.request("/api/marketing/catalog/products/nope", { headers: { cookie } })).status).toBe(404);
    expect((await app.request("/api/marketing/catalog/docs/nope", { headers: { cookie } })).status).toBe(404);
  });

  it("型号详情按类别分组，没有价格资料时写进资料缺口", async () => {
    const { app } = setup();
    const cookie = await cookieOf(app, "store001", "store-pass-123");
    const overview = CatalogOverviewSchema.parse(await (await app.request("/api/marketing/catalog", { headers: { cookie } })).json());
    const id = overview.entries[0]!.productId;
    const detail = CatalogDetailSchema.parse(await (await app.request(`/api/marketing/catalog/products/${encodeURIComponent(id)}`, { headers: { cookie } })).json());
    expect(detail.groups.length).toBeGreaterThan(0);
    expect(detail.groups.every((g) => g.facts.length > 0 && g.label.length > 0)).toBe(true);
    expect(detail.gaps.some((g) => /没有官方公开价格/.test(g))).toBe(true);
  });
});

describe.skipIf(!fs.existsSync(defaultLocalRoot()))("资料库（真实知识库）", () => {
  const data = createDataService({ mode: "local", ima: { kbName: "" } });
  const catalog = new CatalogService({ data, library: createLocalLibrary() });

  it("列出全部型号，每款有价格口径、资料覆盖与关键参数", async () => {
    const o = await catalog.overview();
    expect(o.entries.length).toBeGreaterThanOrEqual(10);
    expect(o.library?.general.some((d) => d.section === "faq")).toBe(true);
    for (const e of o.entries) {
      expect(e.figures.some((f) => f.label === "屏幕")).toBe(true);
      expect(e.coverage.docs).toBeGreaterThan(0);
    }
    expect(o.entries.filter((e) => e.price?.amount).length).toBeGreaterThan(5);
  });

  it("原文标签错位的型号：待审核参数照样列出、标注，并写进资料缺口", async () => {
    const o = await catalog.overview();
    const flagged = o.entries.find((e) => e.coverage.pendingFacts > 0);
    expect(flagged).toBeDefined();
    const d = await catalog.product(flagged!.productId);
    expect(d.groups.flatMap((g) => g.facts).some((f) => f.reviewStatus === "pending_review")).toBe(true);
    expect(d.gaps.some((g) => /待审核/.test(g))).toBe(true);
    const doc = LibraryDocContentSchema.parse(await catalog.doc(d.docs[0]!.docId));
    expect(doc.parts.length).toBeGreaterThan(0);
  });

  it("全库搜索：顾客原话里的软件名能搜到常见问题原文，并能按编号打开全文", async () => {
    const hits = await catalog.search("鸿蒙版能装 Photoshop 吗");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.section === "faq")).toBe(true);
    expect((await catalog.doc(hits[0]!.docId)).parts.length).toBeGreaterThan(0);
    expect(await catalog.search("   ")).toEqual([]);
  });
});
