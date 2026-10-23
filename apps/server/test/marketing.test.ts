import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CampaignSchema, PostSchema, PublishResponseSchema, StoreCampaignViewSchema, type Post } from "@hwpc/contracts";
import { createMockDataService, createMockModelService } from "@hwpc/fixtures";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/marketing/auth.js";
import { MarketingRepo } from "../src/marketing/repo.js";
import { SecretBox, TokenSigner } from "../src/marketing/security.js";
import { MarketingService } from "../src/marketing/service.js";
import { SettingsService } from "../src/marketing/settings.js";

/** 记录调用的假微信接口。 */
function fakeWechat() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url.replace(/\?.*$/, ""));
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/cgi-bin/stable_token")) return json({ access_token: "TOKEN", expires_in: 7200 });
    if (url.includes("/cgi-bin/media/uploadimg")) return json({ url: "http://mmbiz.qpic.cn/x.jpg" });
    if (url.includes("/cgi-bin/material/add_material")) return json({ media_id: "THUMB", url: "http://mmbiz.qpic.cn/t.jpg" });
    if (url.includes("/cgi-bin/draft/add")) return json({ media_id: "DRAFT_ID" });
    return json({ errcode: 40001, errmsg: "unexpected" });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwpc-marketing-"));
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
  const wx = fakeWechat();
  const data = createMockDataService();
  const service = new MarketingService({ repo, data, settings, box, fetchImpl: wx.fetchImpl });
  const app = createApp({
    data,
    model: createMockModelService(),
    tasks: { create: () => { throw new Error("不涉及"); } } as never,
    marketing: { auth, service, settings, secureCookie: false },
    dataMode: "mock",
    corsOrigin: "*",
  });
  return { app, wx, repo };
}

type App = ReturnType<typeof setup>["app"];

async function login(app: App, username: string, password: string): Promise<string> {
  const r = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(r.status).toBe(200);
  const cookie = r.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  return cookie.split(";")[0]!;
}

function client(app: App, cookie: string) {
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await app.request(url, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: (await r.json().catch(() => undefined)) as any };
  };
  return { get: (u: string) => call("GET", u), post: (u: string, b?: unknown) => call("POST", u, b ?? {}), put: (u: string, b: unknown) => call("PUT", u, b) };
}

const PROFILE = { name: "湖滨店", city: "杭州", area: "湖滨银泰", audience: "周边白领", staffName: "小林", contactLine: "地址：湖滨路 18 号", activity: "" };

async function campaign(app: App) {
  const hq = client(app, await login(app, "hq", "hq-pass-123"));
  const c = await hq.post("/api/marketing/campaigns", { title: "通勤季", products: [{ productId: "mock-air-14" }], theme: "通勤路上轻一点", audience: "上班族", platforms: ["wechat_article", "xiaohongshu", "store_moments", "store_poster"], mustAvoid: "不提价格" });
  expect(c.status).toBe(201);
  return { hq, campaign: CampaignSchema.parse(c.json) };
}

describe("登录与权限", () => {
  it("错误口令 401；未登录 401；门店访问总部接口 403", async () => {
    const { app } = setup();
    const bad = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "hq", password: "wrong" }) });
    expect(bad.status).toBe(401);
    expect((await app.request("/api/marketing/my/campaigns")).status).toBe(401);
    const store = client(app, await login(app, "store001", "store-pass-123"));
    expect((await store.get("/api/marketing/campaigns")).status).toBe(403);
    expect((await store.get("/api/auth/me")).json).toMatchObject({ user: { role: "store", storeId: "store001" } });
    expect(await (await app.request("/api/auth/me")).json()).toEqual({ user: null });
  });

  it("改口令后旧登录失效", async () => {
    const { app } = setup();
    const cookie = await login(app, "store001", "store-pass-123");
    const store = client(app, cookie);
    expect((await store.post("/api/auth/password", { oldPassword: "store-pass-123", newPassword: "new-pass-456" })).status).toBe(200);
    expect((await store.get("/api/auth/me")).json).toEqual({ user: null });
    expect((await store.get("/api/marketing/my/campaigns")).status).toBe(401);
    await login(app, "store001", "new-pass-456");
  });
});

describe("门店推文全流程", () => {
  it("资料不全不能生成；补齐后生成 3 个版本；选定后辅助发布、回填链接；总部看板可见", async () => {
    const { app } = setup();
    const { hq, campaign: c } = await campaign(app);
    const store = client(app, await login(app, "store001", "store-pass-123"));

    const list = await store.get("/api/marketing/my/campaigns");
    expect(StoreCampaignViewSchema.array().parse(list.json)[0]!.posts).toHaveLength(4);

    const blocked = await store.post("/api/marketing/posts", { campaignId: c.campaignId, platform: "xiaohongshu" });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.message).toContain("门店资料");

    expect((await store.put("/api/marketing/my/profile", PROFILE)).status).toBe(200);
    const opened = await store.post("/api/marketing/posts", { campaignId: c.campaignId, platform: "xiaohongshu" });
    expect(opened.status).toBe(200);
    const post: Post = PostSchema.parse(opened.json);
    expect(post.variants).toHaveLength(3);
    expect(new Set(post.variants.map((v) => v.angle)).size).toBe(3);
    expect(post.variants[0]!.article.callToAction).toContain("湖滨路 18 号");

    // 未选定不能发布
    expect((await store.post(`/api/marketing/posts/${post.postId}/publish`)).status).toBe(409);
    const selected = PostSchema.parse((await store.post(`/api/marketing/posts/${post.postId}/select`, { variantId: post.variants[1]!.variantId })).json);
    expect(selected.status).toBe("selected");

    const pub = PublishResponseSchema.parse((await store.post(`/api/marketing/posts/${post.postId}/publish`)).json);
    expect(pub.record).toMatchObject({ method: "assist", state: "pending_manual" });
    expect(pub.assist?.openUrls.app).toContain("xhsdiscover");
    expect(pub.assist?.text).toContain("#");

    const img = pub.assist!.images[0];
    if (img) expect((await app.request(img.url, { headers: { cookie: (await login(app, "store001", "store-pass-123")) } })).status).toBe(200);

    const done = PostSchema.parse((await store.post(`/api/marketing/posts/${post.postId}/receipt`, { url: "https://www.xiaohongshu.com/explore/abc" })).json);
    expect(done.status).toBe("published");

    const progress = (await hq.get(`/api/marketing/campaigns/${c.campaignId}/progress`)).json;
    const row = progress.stores.find((s: { storeId: string }) => s.storeId === "store001");
    expect(row.platforms.find((p: { platform: string }) => p.platform === "xiaohongshu")).toMatchObject({ status: "published", url: "https://www.xiaohongshu.com/explore/abc" });

    const md = await app.request(`/api/marketing/posts/${post.postId}/export`, { headers: { cookie: await login(app, "store001", "store-pass-123") } });
    const text = await md.text();
    for (const h of ["一、场景判断", "二、知识库依据", "三、图文软文", "四、核验结果"]) expect(text).toContain(h);
  });

  it("公众号：密钥加密保存且不回显；发布时依次调用 token → 上传图片 → 新建草稿", async () => {
    const { app, wx } = setup();
    const { campaign: c } = await campaign(app);
    const store = client(app, await login(app, "store001", "store-pass-123"));
    await store.put("/api/marketing/my/profile", PROFILE);

    const bound = await store.put("/api/marketing/my/channels/wechat_mp", { channel: "wechat_mp", displayName: "湖滨店公众号", appId: "wx123", appSecret: "SUPER-SECRET-VALUE", publishMode: "draft", author: "小林" });
    expect(bound.json).toMatchObject({ bound: true, secretsSet: ["appSecret"] });
    expect(JSON.stringify(bound.json)).not.toContain("SUPER-SECRET-VALUE");
    const onDisk = fs.readdirSync(path.join(dir, "bindings")).map((f) => fs.readFileSync(path.join(dir, "bindings", f), "utf8")).join();
    expect(onDisk).not.toContain("SUPER-SECRET-VALUE");

    const tested = await store.post("/api/marketing/my/channels/wechat_mp/test");
    expect(tested.json.lastCheck).toMatchObject({ ok: true });

    const post = PostSchema.parse((await store.post("/api/marketing/posts", { campaignId: c.campaignId, platform: "wechat_article" })).json);
    const deliverable = post.variants.find((v) => v.report.deliveryStatus !== "blocked")!;
    await store.post(`/api/marketing/posts/${post.postId}/select`, { variantId: deliverable.variantId });
    wx.calls.length = 0;
    const pub = PublishResponseSchema.parse((await store.post(`/api/marketing/posts/${post.postId}/publish`)).json);
    expect(pub.record).toMatchObject({ method: "api", state: "draft_created", externalId: "DRAFT_ID" });
    expect(wx.calls[0]).toContain("/cgi-bin/stable_token");
    expect(wx.calls).toContain("https://api.weixin.qq.com/cgi-bin/draft/add");
    expect(wx.calls.some((u) => u.endsWith("/cgi-bin/material/add_material"))).toBe(true);
  });

  it("修改稿核验不通过（被删空）时不能发布", async () => {
    const { app } = setup();
    const { campaign: c } = await campaign(app);
    const store = client(app, await login(app, "store001", "store-pass-123"));
    await store.put("/api/marketing/my/profile", PROFILE);
    const post = PostSchema.parse((await store.post("/api/marketing/posts", { campaignId: c.campaignId, platform: "store_moments" })).json);
    await store.post(`/api/marketing/posts/${post.postId}/select`, { variantId: post.variants[0]!.variantId });
    const article = { ...post.variants[0]!.article, blocks: [{ type: "paragraph", text: "这是史上最好的电脑，保证你满意。", factIds: [] }] };
    const editRes = await store.post(`/api/marketing/posts/${post.postId}/edit`, { article });
    const edited = PostSchema.parse(editRes.json);
    expect(edited.edited?.report.deliveryStatus).toBe("blocked");
    expect(edited.edited?.article.blocks[0]).toMatchObject({ text: "这是史上最好的电脑，保证你满意。" });
    const pub = await store.post(`/api/marketing/posts/${post.postId}/publish`);
    expect(pub.status).toBe(409);
    expect(pub.json.error.message).toContain("核验未通过");
  });

  it("门店不能读取其他门店的稿件", async () => {
    const { app } = setup();
    const { hq, campaign: c } = await campaign(app);
    expect((await hq.post("/api/marketing/stores", { storeId: "store002", name: "西湖店", password: "store2-pass" })).status).toBe(201);
    const s1 = client(app, await login(app, "store001", "store-pass-123"));
    await s1.put("/api/marketing/my/profile", PROFILE);
    const post = PostSchema.parse((await s1.post("/api/marketing/posts", { campaignId: c.campaignId, platform: "store_poster" })).json);
    const s2 = client(app, await login(app, "store002", "store2-pass"));
    expect((await s2.get(`/api/marketing/posts/${post.postId}`)).status).toBe(403);
  });
});

describe("创作风格", () => {
  it("总部默认视觉风格生效；门店重写时可指定语言风格；未知风格 400", async () => {
    const { app } = setup();
    const hq = client(app, await login(app, "hq", "hq-pass-123"));
    const created = await hq.post("/api/marketing/campaigns", { title: "海报季", products: [{ productId: "mock-air-14" }], theme: "通勤路上轻一点", audience: "上班族", platforms: ["store_poster"], mustAvoid: "不提价格", style: { visual: "gallery-dark" } });
    expect(created.status).toBe(201);
    const c = CampaignSchema.parse(created.json);
    expect(c.style).toEqual({ visual: "gallery-dark" });
    expect((await hq.post("/api/marketing/campaigns", { ...created.json, style: { voice: "不存在" } })).status).toBe(400);

    const store = client(app, await login(app, "store001", "store-pass-123"));
    await store.put("/api/marketing/my/profile", PROFILE);
    const post = PostSchema.parse((await store.post("/api/marketing/posts", { campaignId: c.campaignId, platform: "store_poster" })).json);
    expect(post.variants.every((v) => v.style?.visual === "gallery-dark")).toBe(true);
    expect(new Set(post.variants.map((v) => v.style?.voice)).size).toBe(3);

    const again = PostSchema.parse((await store.post(`/api/marketing/posts/${post.postId}/generate`, { voice: "restrained-premium" })).json);
    expect(again.variants.every((v) => v.style?.voice === "restrained-premium" && v.style.visual === "gallery-dark")).toBe(true);
    expect((await store.post(`/api/marketing/posts/${post.postId}/generate`, { visual: "不存在" })).status).toBe(400);
    // 不指定时仍可重新生成（旧客户端发送空对象）
    expect((await store.post(`/api/marketing/posts/${post.postId}/generate`, {})).status).toBe(200);
  });
});
