/**
 * 推文模块 HTTP 路由。登录令牌放在 HttpOnly Cookie（前端无需保存），也接受 Authorization: Bearer。
 * 每个路由显式声明需要的角色；门店只能访问自己的数据由 MarketingService 再校验一次。
 */
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  CampaignInputSchema,
  ChannelBindingInputSchema,
  ChannelSchema,
  LoginRequestSchema,
  MARKETING_PATHS,
  PlatformSchema,
  StoreProfileInputSchema,
  StyleChoiceSchema,
  SystemSettingsInputSchema,
  ArticleSchema,
  type User,
  type UserRole,
} from "@hwpc/contracts";
import { AuthError, type AuthService } from "./auth.js";
import type { MarketingService } from "./service.js";
import type { SettingsService } from "./settings.js";

export interface MarketingModule {
  auth: AuthService;
  service: MarketingService;
  settings: SettingsService;
  /** 生产环境（HTTPS）下设置 Cookie 的 Secure 属性。 */
  secureCookie: boolean;
}

const COOKIE = "hwpc_token";

type Parse = <T extends z.ZodType>(c: Context, schema: T) => Promise<z.infer<T>>;

export function registerMarketingRoutes(app: Hono, m: MarketingModule, body: Parse): void {
  const tokenOf = (c: Context) => {
    const h = c.req.header("authorization");
    return h?.startsWith("Bearer ") ? h.slice(7) : getCookie(c, COOKIE);
  };
  const requireUser = (c: Context, role?: UserRole): User => {
    const user = m.auth.authenticate(tokenOf(c));
    if (!user) throw new AuthError("unauthorized", "请先登录");
    if (role && user.role !== role) throw new AuthError("forbidden", role === "hq" ? "需要总部账号" : "需要门店账号");
    return user;
  };
  const storeOf = (c: Context): User & { storeId: string } => {
    const u = requireUser(c, "store");
    if (!u.storeId) throw new AuthError("forbidden", "该账号没有绑定门店");
    return u as User & { storeId: string };
  };

  /* ---------- 登录 ---------- */
  app.post(MARKETING_PATHS.login, async (c) => {
    const b = await body(c, LoginRequestSchema);
    const r = m.auth.login(b.username, b.password);
    setCookie(c, COOKIE, r.token, { httpOnly: true, sameSite: "Lax", path: "/", secure: m.secureCookie, expires: new Date(r.expiresAt) });
    return c.json(r);
  });
  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  // 未登录时返回 { user: null } 而不是 401：前端每次加载都会查一次，匿名访问选购顾问是正常情况。
  app.get(MARKETING_PATHS.me, (c) => c.json({ user: m.auth.authenticate(tokenOf(c)) ?? null }));
  app.post("/api/auth/password", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ oldPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }));
    m.auth.changePassword(u.username, b.oldPassword, b.newPassword);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /* ---------- 公共 ---------- */
  app.get(MARKETING_PATHS.products, async (c) => {
    requireUser(c);
    return c.json(await m.service.products());
  });

  /* ---------- 总部 ---------- */
  app.get(MARKETING_PATHS.campaigns, (c) => {
    requireUser(c, "hq");
    return c.json(m.service.listCampaigns());
  });
  app.post(MARKETING_PATHS.campaigns, async (c) => {
    const u = requireUser(c, "hq");
    return c.json(await m.service.createCampaign(await body(c, CampaignInputSchema), u), 201);
  });
  app.patch("/api/marketing/campaigns/:id", async (c) => {
    requireUser(c, "hq");
    const b = await body(c, z.object({ status: z.enum(["active", "archived"]) }));
    return c.json(m.service.setCampaignStatus(c.req.param("id"), b.status));
  });
  app.get("/api/marketing/campaigns/:id/progress", (c) => {
    requireUser(c, "hq");
    return c.json(m.service.progress(c.req.param("id")));
  });
  app.get(MARKETING_PATHS.stores, (c) => {
    requireUser(c, "hq");
    return c.json(m.service.listStores());
  });
  app.post(MARKETING_PATHS.stores, async (c) => {
    requireUser(c, "hq");
    const b = await body(c, z.object({ storeId: z.string().min(2).max(40), name: z.string().min(1).max(60), password: z.string().min(8).max(200) }));
    return c.json(m.auth.createStore(b), 201);
  });
  app.post("/api/marketing/stores/:id/password", async (c) => {
    requireUser(c, "hq");
    const b = await body(c, z.object({ password: z.string().min(8).max(200) }));
    m.auth.resetPassword(c.req.param("id"), b.password);
    return c.json({ ok: true });
  });
  app.get(MARKETING_PATHS.settings, (c) => {
    requireUser(c, "hq");
    return c.json(m.settings.view());
  });
  app.put(MARKETING_PATHS.settings, async (c) => {
    requireUser(c, "hq");
    return c.json(m.settings.update(await body(c, SystemSettingsInputSchema)));
  });

  /* ---------- 门店 ---------- */
  app.get(MARKETING_PATHS.myCampaigns, (c) => c.json(m.service.storeCampaigns(storeOf(c).storeId)));
  app.get(MARKETING_PATHS.myProfile, (c) => c.json(m.service.profile(storeOf(c).storeId)));
  app.put(MARKETING_PATHS.myProfile, async (c) => {
    const u = storeOf(c);
    return c.json(m.service.updateProfile(u.storeId, await body(c, StoreProfileInputSchema)));
  });
  app.get(MARKETING_PATHS.myChannels, (c) => c.json(m.service.channels(storeOf(c).storeId)));
  app.put("/api/marketing/my/channels/:channel", async (c) => {
    const u = storeOf(c);
    const b = await body(c, ChannelBindingInputSchema);
    if (b.channel !== c.req.param("channel")) throw new AuthError("validation_error", "路径与请求体中的平台不一致");
    return c.json(m.service.bindChannel(u.storeId, b));
  });
  app.delete("/api/marketing/my/channels/:channel", (c) => {
    const u = storeOf(c);
    return c.json(m.service.unbindChannel(u.storeId, ChannelSchema.parse(c.req.param("channel"))));
  });
  app.post("/api/marketing/my/channels/:channel/test", async (c) => {
    const u = storeOf(c);
    return c.json(await m.service.testChannel(u.storeId, ChannelSchema.parse(c.req.param("channel"))));
  });

  /* ---------- 稿件 ---------- */
  app.post(MARKETING_PATHS.posts, async (c) => {
    const u = storeOf(c);
    const b = await body(c, z.object({ campaignId: z.string().min(1), platform: PlatformSchema }));
    return c.json(await m.service.openPost(u, b.campaignId, b.platform));
  });
  app.get("/api/marketing/posts/:id", (c) => c.json(m.service.getPost(c.req.param("id"), requireUser(c))));
  app.post("/api/marketing/posts/:id/generate", async (c) => {
    // 可选：本次指定的语言 / 视觉风格；空 body 表示按平台与人群轮换
    const b = await body(c, StyleChoiceSchema.default({}));
    return c.json(await m.service.regenerate(c.req.param("id"), requireUser(c), b));
  });
  app.post("/api/marketing/posts/:id/select", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ variantId: z.string().min(1) }));
    return c.json(m.service.select(c.req.param("id"), b.variantId, u));
  });
  app.post("/api/marketing/posts/:id/edit", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ article: ArticleSchema }));
    return c.json(await m.service.edit(c.req.param("id"), b.article, u));
  });
  app.post("/api/marketing/posts/:id/publish", async (c) => c.json(await m.service.publish(c.req.param("id"), requireUser(c))));
  app.post("/api/marketing/posts/:id/receipt", async (c) => {
    const u = requireUser(c);
    const b = await body(c, z.object({ url: z.string().max(500).optional() }));
    return c.json(m.service.receipt(c.req.param("id"), b.url?.trim() || undefined, u));
  });
  app.get("/api/marketing/posts/:id/export", (c) => {
    const r = m.service.exportMarkdown(c.req.param("id"), requireUser(c));
    return new Response(r.content, {
      headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}` },
    });
  });
  app.get("/api/marketing/posts/:id/images/:imageId", async (c) => {
    const img = await m.service.image(c.req.param("id"), c.req.param("imageId"), requireUser(c));
    return new Response(img.bytes as unknown as ConstructorParameters<typeof Response>[0], {
      headers: { "content-type": img.mimeType, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" },
    });
  });
}
