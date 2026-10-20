/**
 * 门店推文用例。门控全部在这里由程序执行：
 * - 生成前：任务进行中、平台属于任务、门店资料齐全（名称 + 到店引导）。
 * - 发布前：导购已选定一个版本；该版本（或修改稿）核验状态不是 blocked。
 * - 门店只能看到和操作自己的稿件；总部只读。
 */
import { randomUUID } from "node:crypto";
import { excerptGuide, articleText, generatePostVariants, topicsIn, verifyAndRepair } from "@hwpc/agent";
import { readPlatformGuide } from "@hwpc/data";
import {
  PLATFORM_CHANNEL,
  storeProfileGaps,
  type Article,
  type Campaign,
  type CampaignInput,
  type CampaignProgress,
  type ChannelBindingInput,
  type ChannelBindingView,
  type DataService,
  type MaterialPack,
  type Platform,
  type Post,
  type PostVariant,
  type PublishRecord,
  type PublishResponse,
  type StoreCampaignView,
  type StoreProfile,
  type User,
} from "@hwpc/contracts";

import type { MarketingRepo, BindingRecord } from "./repo.js";
import type { SecretBox } from "./security.js";
import type { SettingsService } from "./settings.js";
import { assistPackage, publishWechat, publishXiaohongshuApi, PublishError, WechatMpClient, type ImageSource, type PublishOutcome } from "./publishers.js";

export class MarketingError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "invalid_state" | "validation_error",
    message: string,
  ) {
    super(message);
    this.name = "MarketingError";
  }
}

const now = () => new Date().toISOString();
const VARIANT_COUNT = 3;

export interface MarketingDeps {
  repo: MarketingRepo;
  data: DataService;
  settings: SettingsService;
  box: SecretBox;
  localKbDir?: string;
  fetchImpl?: typeof fetch;
}

export class MarketingService {
  private inflight = new Map<string, Promise<Post>>();

  constructor(private deps: MarketingDeps) {}

  private get repo() {
    return this.deps.repo;
  }

  /* ------------------------------ 产品与任务 ------------------------------ */

  async products(): Promise<{ productId: string; model: string; family: string }[]> {
    const r = await this.deps.data.searchProducts("");
    return r.candidates.map((p) => ({ productId: p.productId, model: p.model, family: p.family }));
  }

  async createCampaign(input: CampaignInput, user: User): Promise<Campaign> {
    const catalog = await this.products();
    const names = input.products.map((p) => catalog.find((c) => c.productId === p.productId)?.model);
    if (names.some((n) => !n)) throw new MarketingError("validation_error", "任务里有资料库中不存在的型号");
    const campaign: Campaign = { ...input, platforms: [...new Set(input.platforms)], campaignId: randomUUID(), status: "active", createdAt: now(), createdBy: user.username, productNames: names as string[] };
    return this.repo.campaigns.put(campaign.campaignId, campaign);
  }

  setCampaignStatus(id: string, status: Campaign["status"]): Campaign {
    const c = this.repo.campaigns.get(id);
    if (!c) throw new MarketingError("not_found", "任务不存在");
    return this.repo.campaigns.put(id, { ...c, status });
  }

  listCampaigns(): Campaign[] {
    return this.repo.campaigns.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private postsOf(storeId: string): Post[] {
    return this.repo.posts.list().filter((p) => p.storeId === storeId);
  }

  storeCampaigns(storeId: string): StoreCampaignView[] {
    const posts = this.postsOf(storeId);
    return this.listCampaigns()
      .filter((c) => c.status === "active")
      .map((campaign) => ({
        campaign,
        posts: campaign.platforms.map((platform) => {
          const p = posts.find((x) => x.campaignId === campaign.campaignId && x.platform === platform);
          return { platform, ...(p ? { postId: p.postId } : {}), status: p?.status ?? ("not_started" as const) };
        }),
      }));
  }

  progress(campaignId: string): CampaignProgress {
    const campaign = this.repo.campaigns.get(campaignId);
    if (!campaign) throw new MarketingError("not_found", "任务不存在");
    const posts = this.repo.posts.list().filter((p) => p.campaignId === campaignId);
    return {
      campaign,
      stores: this.repo.stores.list().map((s) => ({
        storeId: s.storeId,
        storeName: s.name,
        platforms: campaign.platforms.map((platform) => {
          const p = posts.find((x) => x.storeId === s.storeId && x.platform === platform);
          const url = p?.publishes.findLast((r) => r.url)?.url;
          return { platform, status: p?.status ?? ("not_started" as const), ...(url ? { url } : {}) };
        }),
      })),
    };
  }

  /* ------------------------------ 门店资料与账号绑定 ------------------------------ */

  listStores(): StoreProfile[] {
    return this.repo.stores.list().sort((a, b) => a.storeId.localeCompare(b.storeId));
  }

  profile(storeId: string): StoreProfile {
    const p = this.repo.stores.get(storeId);
    if (!p) throw new MarketingError("not_found", "门店不存在");
    return p;
  }

  updateProfile(storeId: string, input: Omit<StoreProfile, "storeId" | "updatedAt">): StoreProfile {
    this.profile(storeId);
    return this.repo.stores.put(storeId, { ...input, storeId, updatedAt: now() });
  }

  private bindingView(storeId: string, channel: ChannelBindingView["channel"]): ChannelBindingView {
    const b = this.repo.bindings.get(this.repo.bindingId(storeId, channel));
    if (!b) return { channel, bound: false, displayName: "", settings: {}, secretsSet: [] };
    const bound = channel === "wechat_mp" ? Boolean(b.settings.appId && b.secrets.appSecret) : true;
    return { channel, bound, displayName: b.displayName, settings: b.settings, secretsSet: Object.keys(b.secrets), ...(b.lastCheck ? { lastCheck: b.lastCheck } : {}), updatedAt: b.updatedAt };
  }

  channels(storeId: string): ChannelBindingView[] {
    return (["wechat_mp", "xiaohongshu"] as const).map((c) => this.bindingView(storeId, c));
  }

  bindChannel(storeId: string, input: ChannelBindingInput): ChannelBindingView {
    const id = this.repo.bindingId(storeId, input.channel);
    const prev = this.repo.bindings.get(id);
    const secrets = { ...(prev?.secrets ?? {}) };
    const setSecret = (name: string, value: string | undefined) => {
      if (value === undefined) return;
      if (value.trim()) secrets[name] = this.deps.box.seal(value.trim());
      else delete secrets[name];
    };
    let settings: Record<string, string>;
    if (input.channel === "wechat_mp") {
      settings = { appId: input.appId.trim(), publishMode: input.publishMode, author: input.author.trim() };
      setSecret("appSecret", input.appSecret);
    } else {
      settings = { mode: input.mode, accountId: input.accountId.trim() };
      setSecret("accessToken", input.accessToken);
    }
    const rec: BindingRecord = { storeId, channel: input.channel, displayName: input.displayName.trim(), settings, secrets, updatedAt: now() };
    this.repo.bindings.put(id, rec);
    return this.bindingView(storeId, input.channel);
  }

  unbindChannel(storeId: string, channel: ChannelBindingView["channel"]): ChannelBindingView {
    this.repo.bindings.delete(this.repo.bindingId(storeId, channel));
    return this.bindingView(storeId, channel);
  }

  private secret(b: BindingRecord, name: string): string | undefined {
    const s = b.secrets[name];
    return s ? this.deps.box.open(s) : undefined;
  }

  async testChannel(storeId: string, channel: ChannelBindingView["channel"]): Promise<ChannelBindingView> {
    const id = this.repo.bindingId(storeId, channel);
    const b = this.repo.bindings.get(id);
    if (!b) throw new MarketingError("invalid_state", "还没有绑定该平台");
    let result: { ok: boolean; message: string };
    if (channel === "wechat_mp") {
      const secret = this.secret(b, "appSecret");
      if (!b.settings.appId || !secret) result = { ok: false, message: "缺少 AppID 或 AppSecret" };
      else {
        try {
          await new WechatMpClient(this.deps.settings.wechatApiBase(), this.deps.fetchImpl).token(b.settings.appId, secret);
          result = { ok: true, message: "已成功获取 access_token" };
        } catch (e) {
          result = { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      }
    } else if (b.settings.mode === "api") {
      const xhs = this.deps.settings.xiaohongshu();
      result = xhs.publishUrl ? { ok: true, message: `将调用发布接口 ${xhs.publishUrl}（未实际发送）` } : { ok: false, message: "总部尚未在系统设置中填写小红书发布接口地址" };
    } else {
      result = { ok: true, message: "辅助发布模式：无需接口，由导购在小红书 App 中发布" };
    }
    this.repo.bindings.put(id, { ...b, lastCheck: { ...result, at: now() } });
    return this.bindingView(storeId, channel);
  }

  /* ------------------------------ 稿件 ------------------------------ */

  private ownPost(postId: string, user: User): Post {
    const p = this.repo.posts.get(postId);
    if (!p) throw new MarketingError("not_found", "稿件不存在");
    if (user.role === "store" && p.storeId !== user.storeId) throw new MarketingError("forbidden", "不能访问其他门店的稿件");
    return p;
  }

  getPost(postId: string, user: User): Post {
    return this.ownPost(postId, user);
  }

  private async loadPack(campaign: Campaign): Promise<MaterialPack> {
    const packs = await Promise.all(campaign.products.map((product) => this.deps.data.getMaterialPack({ taskId: campaign.campaignId, product })));
    const first = packs[0]!;
    return {
      ...first,
      products: packs.flatMap((p) => p.products),
      facts: packs.flatMap((p) => p.facts),
      images: packs.flatMap((p) => p.images),
      conflicts: packs.flatMap((p) => p.conflicts),
      gaps: [...new Set(packs.flatMap((p) => p.gaps))],
      origins: [...new Set(packs.flatMap((p) => p.origins))],
      isMock: packs.some((p) => p.isMock),
    };
  }

  private chosen(p: Post): { article: Article; report: PostVariant["report"] } | undefined {
    if (p.edited) return p.edited;
    return p.variants.find((v) => v.variantId === p.selectedVariantId);
  }

  private peers(campaignId: string, platform: Platform, storeId: string): string[] {
    return this.repo.posts
      .list()
      .filter((p) => p.campaignId === campaignId && p.platform === platform && p.storeId !== storeId)
      .flatMap((p) => {
        const c = this.chosen(p);
        return c ? [articleText(c.article)] : [];
      });
  }

  /** 生成门控：返回不能生成的原因（为空表示可以）。 */
  private gate(campaign: Campaign, platform: Platform, store: StoreProfile): string | undefined {
    if (campaign.status !== "active") return "该推广任务已结束";
    if (!campaign.platforms.includes(platform)) return "该任务不包含这个平台";
    const gaps = storeProfileGaps(store);
    if (gaps.length) return `请先在“门店资料”里补充：${gaps.join("、")}`;
    return undefined;
  }

  private async generateInto(post: Post, campaign: Campaign, store: StoreProfile, round: number): Promise<Post> {
    const pack = await this.loadPack(campaign);
    const unresolved = pack.conflicts.filter((c) => c.status === "unresolved");
    const guide = await readPlatformGuide(post.platform, this.deps.localKbDir);
    const model = this.deps.settings.model();
    const variants = await generatePostVariants({
      platform: post.platform,
      campaign: { title: campaign.title, theme: campaign.theme, audience: campaign.audience, mustAvoid: campaign.mustAvoid, productIds: campaign.products.map((p) => p.productId) },
      store,
      pack,
      ...(guide ? { styleGuide: excerptGuide(guide) } : {}),
      peerTexts: this.peers(campaign.campaignId, post.platform, store.storeId),
      count: VARIANT_COUNT,
      round,
      seed: `${store.storeId}:${campaign.campaignId}:${post.platform}`,
      ...(model.service ? { model: model.service } : {}),
      temperature: model.temperature,
      now: () => new Date(),
    });
    const t = now();
    const next: Post = {
      ...post,
      status: post.status === "published" ? "published" : "draft",
      judgement: {
        audience: [campaign.audience, store.audience].filter(Boolean).join("；"),
        scene: campaign.theme,
        strategy: `切入角度：${variants.map((v) => v.angle).join(" / ")}。${model.source === "none" ? "未配置写作模型，使用模板稿。" : ""}`,
      },
      facts: pack.facts.filter((f) => f.reviewStatus === "verified" && f.category !== "price"),
      images: pack.images,
      gaps: [...pack.gaps, ...unresolved.map((c) => `资料冲突未解决：${c.field}`)],
      isMock: pack.isMock,
      variants: variants.map((v) => ({ variantId: randomUUID(), angle: v.angle, article: v.article, report: v.report, mode: v.mode, similarity: v.similarity, createdAt: t })),
      round,
      revision: post.revision + 1,
      updatedAt: t,
    };
    delete next.selectedVariantId;
    delete next.edited;
    return this.repo.posts.put(next.postId, next);
  }

  /** 同一稿件同时只跑一次生成，避免连点产生两批版本。 */
  private once(key: string, fn: () => Promise<Post>): Promise<Post> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async openPost(user: User, campaignId: string, platform: Platform): Promise<Post> {
    if (user.role !== "store" || !user.storeId) throw new MarketingError("forbidden", "只有门店账号可以生成推文");
    const storeId = user.storeId;
    const campaign = this.repo.campaigns.get(campaignId);
    if (!campaign) throw new MarketingError("not_found", "任务不存在");
    const existing = this.postsOf(storeId).find((p) => p.campaignId === campaignId && p.platform === platform);
    if (existing && existing.variants.length) return existing;
    const store = this.profile(storeId);
    const reason = this.gate(campaign, platform, store);
    if (reason) throw new MarketingError("invalid_state", reason);
    const t = now();
    const base: Post = existing ?? {
      postId: randomUUID(),
      campaignId,
      storeId,
      platform,
      status: "draft",
      judgement: { audience: "", scene: "", strategy: "" },
      facts: [],
      images: [],
      gaps: [],
      isMock: false,
      variants: [],
      publishes: [],
      round: 0,
      revision: 0,
      createdAt: t,
      updatedAt: t,
    };
    return this.once(`${storeId}:${campaignId}:${platform}`, () => this.generateInto(base, campaign, store, 0));
  }

  async regenerate(postId: string, user: User): Promise<Post> {
    const post = this.ownPost(postId, user);
    if (user.role !== "store") throw new MarketingError("forbidden", "只有门店账号可以生成推文");
    if (post.status === "published") throw new MarketingError("invalid_state", "已发布的稿件不能重新生成");
    const campaign = this.repo.campaigns.get(post.campaignId);
    if (!campaign) throw new MarketingError("not_found", "任务不存在");
    const store = this.profile(post.storeId);
    const reason = this.gate(campaign, post.platform, store);
    if (reason) throw new MarketingError("invalid_state", reason);
    return this.once(`${post.storeId}:${post.campaignId}:${post.platform}`, () => this.generateInto(post, campaign, store, post.round + 1));
  }

  select(postId: string, variantId: string, user: User): Post {
    const post = this.ownPost(postId, user);
    if (user.role !== "store") throw new MarketingError("forbidden", "只有门店账号可以选稿");
    if (!post.variants.some((v) => v.variantId === variantId)) throw new MarketingError("not_found", "版本不存在");
    const next: Post = { ...post, selectedVariantId: variantId, status: post.status === "published" ? "published" : "selected", revision: post.revision + 1, updatedAt: now() };
    delete next.edited;
    return this.repo.posts.put(post.postId, next);
  }

  /** 导购修改选定稿：去掉程序追加的门店信息后重新核验，再把门店信息追加回去。 */
  async edit(postId: string, article: Article, user: User): Promise<Post> {
    const post = this.ownPost(postId, user);
    if (user.role !== "store") throw new MarketingError("forbidden", "只有门店账号可以修改稿件");
    if (!post.selectedVariantId) throw new MarketingError("invalid_state", "请先选定一个版本再修改");
    if (article.platform !== post.platform) throw new MarketingError("validation_error", "稿件平台不一致");
    const campaign = this.repo.campaigns.get(post.campaignId);
    if (!campaign) throw new MarketingError("not_found", "任务不存在");
    const store = this.profile(post.storeId);
    const storeLines = [store.contactLine.trim(), store.activity.trim() ? `本店活动：${store.activity.trim()}` : ""].filter(Boolean);
    const ctaBase = article.callToAction.split("\n").filter((l) => !storeLines.includes(l.trim())).join("\n").trim();
    const pack = await this.loadPack(campaign);
    const out = verifyAndRepair(
      {
        scope: { productIds: campaign.products.map((p) => p.productId), configurationIds: [], avoidTopics: topicsIn(campaign.mustAvoid), noPrice: true, otherModels: [] },
        pack,
        article: { ...article, callToAction: ctaBase || "欢迎到店了解" },
        allowedFactIds: post.facts.map((f) => f.factId),
      },
      now(),
    );
    // 核验把违规句子全部删掉时，保留导购的原文并标记不可交付，让他看到问题出在哪，而不是得到一篇空稿。
    const kept = out.article.blocks.some((b) => b.type === "paragraph") ? out.article : { ...article, callToAction: ctaBase || "欢迎到店了解" };
    const final: Article = { ...kept, callToAction: [kept.callToAction, ...storeLines].join("\n") };
    return this.repo.posts.put(post.postId, { ...post, edited: { article: final, report: out.report, at: now() }, revision: post.revision + 1, updatedAt: now() });
  }

  private images(post: Post): ImageSource[] {
    return post.images.map((img) => ({
      imageId: img.imageId,
      caption: img.description,
      url: `/api/marketing/posts/${encodeURIComponent(post.postId)}/images/${encodeURIComponent(img.imageId)}`,
      read: async () => {
        const c = await this.deps.data.readImage(img);
        return { bytes: c.bytes, mimeType: c.mimeType };
      },
    }));
  }

  async publish(postId: string, user: User): Promise<PublishResponse> {
    const post = this.ownPost(postId, user);
    if (user.role !== "store") throw new MarketingError("forbidden", "只有门店账号可以发布");
    const chosen = this.chosen(post);
    if (!chosen) throw new MarketingError("invalid_state", "请先选定一个版本");
    if (chosen.report.deliveryStatus === "blocked") throw new MarketingError("invalid_state", "该版本核验未通过（存在阻断问题），不能发布；请换一个版本或修改后重新核验");
    const store = this.profile(post.storeId);
    const images = this.images(post);
    const pkg = assistPackage(post.platform, chosen.article, images);
    const channel = PLATFORM_CHANNEL[post.platform];
    const binding = channel ? this.repo.bindings.get(this.repo.bindingId(post.storeId, channel)) : undefined;

    let outcome: PublishOutcome;
    try {
      if (post.platform === "wechat_article" && binding?.settings.appId && binding.secrets.appSecret) {
        outcome = await publishWechat({
          client: new WechatMpClient(this.deps.settings.wechatApiBase(), this.deps.fetchImpl),
          appId: binding.settings.appId,
          appSecret: this.secret(binding, "appSecret")!,
          mode: binding.settings.publishMode === "publish" ? "publish" : "draft",
          author: binding.settings.author ?? "",
          article: chosen.article,
          images,
        });
      } else if (post.platform === "xiaohongshu" && binding?.settings.mode === "api" && this.deps.settings.xiaohongshu().publishUrl) {
        const xhs = this.deps.settings.xiaohongshu();
        const token = this.secret(binding, "accessToken");
        outcome = await publishXiaohongshuApi({
          publishUrl: xhs.publishUrl,
          ...(xhs.apiKey ? { systemKey: xhs.apiKey } : {}),
          accountId: binding.settings.accountId ?? "",
          ...(token ? { accessToken: token } : {}),
          store,
          post,
          pkg,
          images,
          ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
        });
      } else if (post.platform === "store_poster") {
        outcome = { method: "download", state: "pending_manual", message: "海报已生成，请下载后打印或转发", assist: pkg };
      } else {
        const why =
          post.platform === "wechat_article" ? "公众号未绑定 AppID / AppSecret，" : post.platform === "xiaohongshu" ? "" : "朋友圈没有发布接口，";
        outcome = { method: "assist", state: "pending_manual", message: `${why}请复制文案、保存图片后在 App 中发布，发布后回填链接`, assist: pkg };
      }
    } catch (e) {
      outcome = { method: "api", state: "failed", message: e instanceof PublishError ? e.message : `发布失败：${e instanceof Error ? e.message : e}` };
    }

    const record: PublishRecord = {
      recordId: randomUUID(),
      platform: post.platform,
      method: outcome.method,
      state: outcome.state,
      message: outcome.message,
      ...(outcome.url ? { url: outcome.url } : {}),
      ...(outcome.externalId ? { externalId: outcome.externalId } : {}),
      at: now(),
      by: user.username,
    };
    const saved = this.repo.posts.put(post.postId, {
      ...post,
      status: outcome.state === "published" ? "published" : post.status,
      publishes: [...post.publishes, record],
      revision: post.revision + 1,
      updatedAt: now(),
    });
    const assist = outcome.assist ?? (outcome.state === "failed" ? pkg : undefined);
    return { post: saved, record, ...(assist ? { assist } : {}) };
  }

  /** 手动发布后回填：标记为已发布，可附链接（总部看板据此统计）。 */
  receipt(postId: string, url: string | undefined, user: User): Post {
    const post = this.ownPost(postId, user);
    if (user.role !== "store") throw new MarketingError("forbidden", "只有门店账号可以回填");
    if (!this.chosen(post)) throw new MarketingError("invalid_state", "请先选定一个版本");
    if (url && !/^https?:\/\//.test(url)) throw new MarketingError("validation_error", "链接需要以 http:// 或 https:// 开头");
    const record: PublishRecord = { recordId: randomUUID(), platform: post.platform, method: "assist", state: "published", message: "导购确认已发布", ...(url ? { url } : {}), at: now(), by: user.username };
    return this.repo.posts.put(post.postId, { ...post, status: "published", publishes: [...post.publishes, record], revision: post.revision + 1, updatedAt: now() });
  }

  async image(postId: string, imageId: string, user: User): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const post = this.ownPost(postId, user);
    const src = this.images(post).find((i) => i.imageId === imageId);
    if (!src) throw new MarketingError("not_found", "图片不在该稿件资料中");
    return src.read();
  }

  /** 四段式导出（赛题要求）：场景判断 / 知识库依据 / 图文软文 / 核验结果。 */
  exportMarkdown(postId: string, user: User): { filename: string; content: string } {
    const post = this.ownPost(postId, user);
    const chosen = this.chosen(post) ?? post.variants[0];
    if (!chosen) throw new MarketingError("invalid_state", "稿件还没有生成内容");
    const campaign = this.repo.campaigns.get(post.campaignId);
    const store = this.repo.stores.get(post.storeId);
    return { filename: `${post.platform}-${post.storeId}${post.isMock ? "-MOCK" : ""}.md`, content: renderExport({ post, chosen, campaign, store }) };
  }
}

const PLATFORM_LABEL: Record<Platform, string> = { wechat_article: "微信公众号", xiaohongshu: "小红书", store_moments: "朋友圈", store_poster: "门店海报" };
const STATUS_LABEL: Record<string, string> = { deliverable: "可交付", deliverable_with_notes: "可交付（有说明）", needs_confirmation: "需人工确认", blocked: "不可交付" };

function renderExport(input: { post: Post; chosen: { article: Article; report: PostVariant["report"] }; campaign?: Campaign; store?: StoreProfile }): string {
  const { post, chosen, campaign, store } = input;
  const a = chosen.article;
  const used = new Set(a.blocks.flatMap((b) => (b.type === "paragraph" ? b.factIds : [])));
  const facts = post.facts.filter((f) => used.has(f.factId));
  const lines: string[] = [];
  lines.push(`# ${PLATFORM_LABEL[post.platform]} · ${campaign?.title ?? ""}${post.isMock ? "（含模拟资料 MOCK）" : ""}`, "");
  lines.push("## 一、场景判断", "");
  lines.push(`- 门店：${store?.name ?? post.storeId}${store?.city ? `（${store.city}${store.area ? ` · ${store.area}` : ""}）` : ""}`);
  lines.push(`- 目标人群：${post.judgement.audience}`, `- 推广主题：${post.judgement.scene}`, `- 平台策略：${post.judgement.strategy}`);
  if (campaign?.mustAvoid) lines.push(`- 内容限制：${campaign.mustAvoid}`);
  lines.push("", "## 二、知识库依据", "");
  if (facts.length) for (const f of facts) lines.push(`- ${f.field}：${f.value}${f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : ""} —— 来源：${f.source.title}（${f.source.locator}）`);
  else lines.push("- 本稿没有引用产品参数。");
  const imgs = a.blocks.flatMap((b) => (b.type === "image" ? [b] : []));
  for (const b of imgs) {
    const img = post.images.find((i) => i.imageId === b.imageId);
    if (img) lines.push(`- 图片：${img.description} —— 来源：${img.source.title}（${img.source.locator}）`);
  }
  if (post.gaps.length) lines.push("", `资料缺口：${post.gaps.join("；")}`);
  lines.push("", "## 三、图文软文", "", `### ${a.title}`, "");
  if (a.lead) lines.push(`> ${a.lead}`, "");
  for (const b of a.blocks) {
    if (b.type === "paragraph") {
      if (b.heading) lines.push(`**${b.heading}**`, "");
      lines.push(b.text, "");
    } else lines.push(`[图片：${b.caption}]`, "");
  }
  lines.push(a.callToAction, "");
  if (a.tags.length) lines.push(a.tags.map((t) => `#${t}`).join(" "), "");
  lines.push("## 四、核验结果", "", `交付状态：${STATUS_LABEL[chosen.report.deliveryStatus] ?? chosen.report.deliveryStatus}`, "");
  for (const f of chosen.report.findings) lines.push(`- [${f.resolution}] ${f.message}${f.excerpt ? `：「${f.excerpt}」` : ""}`);
  return lines.join("\n");
}
