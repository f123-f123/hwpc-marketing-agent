/**
 * 门店推文：总部下发推广任务 → 门店导购按平台生成多个版本 → 核验 → 选定 → 发布 / 辅助发布。
 *
 * 角色：
 * - hq：总部，维护推广任务、门店账号与系统设置。
 * - store：门店导购，维护本店资料与平台账号绑定，生成并发布推文。
 *
 * 约束：
 * - 平台密钥只写入服务端（加密保存），任何接口都只返回“是否已设置”，不返回明文。
 * - 发布前必须由导购选定一个版本；核验状态为 blocked 的版本不能发布（程序门控，不靠提示词）。
 */
import { z } from "zod";
import { ArticleSchema } from "./article.js";
import { IdSchema, IsoDateTimeSchema, PlatformSchema } from "./common.js";
import { FactRecordSchema, ImageRecordSchema } from "./material.js";
import { ProductRefSchema } from "./product.js";
import { VerificationReportSchema } from "./verification.js";

/* ------------------------------ 登录 ------------------------------ */

export const UserRoleSchema = z.enum(["hq", "store"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  username: z.string().min(1).max(64),
  displayName: z.string().min(1).max(64),
  role: UserRoleSchema,
  /** role=store 时必填。 */
  storeId: IdSchema.optional(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginRequestSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
export const MeResponseSchema = z.object({ user: UserSchema.nullable() });
export const LoginResponseSchema = z.object({ token: z.string().min(1), user: UserSchema, expiresAt: IsoDateTimeSchema });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/* ------------------------------ 门店资料 ------------------------------ */

export const StoreProfileSchema = z.object({
  storeId: IdSchema,
  name: z.string().min(1).max(60),
  city: z.string().max(30).default(""),
  /** 商圈 / 地段，如“万象城 B1”。 */
  area: z.string().max(60).default(""),
  /** 主要客群，如“周边写字楼白领、大学生”。 */
  audience: z.string().max(200).default(""),
  /** 导购在文案中的自称，如“小林”。为空时不出现个人称呼。 */
  staffName: z.string().max(20).default(""),
  /** 到店 / 咨询引导，如“地址：xx 路 xx 号，营业 10:00–22:00”。生成内容的行动引导只能用这里的信息。 */
  contactLine: z.string().max(200).default(""),
  /** 本店真实在做的到店活动。为空表示无活动，生成内容不得出现优惠。 */
  activity: z.string().max(200).default(""),
  updatedAt: IsoDateTimeSchema,
});
export type StoreProfile = z.infer<typeof StoreProfileSchema>;
export const StoreProfileInputSchema = StoreProfileSchema.omit({ storeId: true, updatedAt: true });

/** 生成前必须具备的门店字段。缺失时程序拒绝生成，并告诉导购补哪一项。 */
export function storeProfileGaps(p: StoreProfile | undefined): string[] {
  if (!p) return ["门店资料"];
  const gaps: string[] = [];
  if (!p.name.trim()) gaps.push("门店名称");
  if (!p.contactLine.trim()) gaps.push("到店 / 咨询引导（地址或联系方式）");
  return gaps;
}

/* ------------------------------ 平台账号绑定 ------------------------------ */

export const ChannelSchema = z.enum(["wechat_mp", "xiaohongshu"]);
export type Channel = z.infer<typeof ChannelSchema>;

/** 平台 → 发布渠道。朋友圈与海报没有可用的发布接口，只做辅助发布 / 下载。 */
export const PLATFORM_CHANNEL: Record<z.infer<typeof PlatformSchema>, Channel | undefined> = {
  wechat_article: "wechat_mp",
  xiaohongshu: "xiaohongshu",
  store_moments: undefined,
  store_poster: undefined,
};

export const WechatMpBindingInputSchema = z.object({
  channel: z.literal("wechat_mp"),
  displayName: z.string().max(60).default(""),
  appId: z.string().max(64).default(""),
  /** 只写：留空表示不修改已保存的密钥。 */
  appSecret: z.string().max(200).optional(),
  /** draft：只进草稿箱，由店长在公众号后台确认后发布；publish：草稿后立即提交发布。 */
  publishMode: z.enum(["draft", "publish"]).default("draft"),
  /** 文章作者署名。 */
  author: z.string().max(16).default(""),
});

export const XiaohongshuBindingInputSchema = z.object({
  channel: z.literal("xiaohongshu"),
  /** 小红书账号昵称或号码，仅用于展示与核对。 */
  displayName: z.string().max(60).default(""),
  /** assist：复制文案、下载图片、打开小红书由导购手动发布；api：调用系统设置中的小红书发布接口。 */
  mode: z.enum(["assist", "api"]).default("assist"),
  /** api 模式下该门店在发布接口侧的账号标识。 */
  accountId: z.string().max(120).default(""),
  /** 只写：api 模式下的门店级访问令牌（若发布接口需要）。 */
  accessToken: z.string().max(500).optional(),
});

export const ChannelBindingInputSchema = z.discriminatedUnion("channel", [WechatMpBindingInputSchema, XiaohongshuBindingInputSchema]);
export type ChannelBindingInput = z.infer<typeof ChannelBindingInputSchema>;

/** 对外展示的绑定状态：不含任何密钥。 */
export const ChannelBindingViewSchema = z.object({
  channel: ChannelSchema,
  bound: z.boolean(),
  displayName: z.string(),
  /** 非敏感配置（appId、模式等）。 */
  settings: z.record(z.string(), z.string()),
  /** 已保存的密钥字段名，如 ["appSecret"]。 */
  secretsSet: z.array(z.string()),
  lastCheck: z.object({ ok: z.boolean(), message: z.string(), at: IsoDateTimeSchema }).optional(),
  updatedAt: IsoDateTimeSchema.optional(),
});
export type ChannelBindingView = z.infer<typeof ChannelBindingViewSchema>;

/* ------------------------------ 系统设置（总部） ------------------------------ */

export const SystemSettingsInputSchema = z.object({
  model: z.object({
    /** OpenAI 兼容接口地址，如 https://api.example.com/v1 */
    baseUrl: z.string().max(300).default(""),
    name: z.string().max(100).default(""),
    /** 只写。 */
    apiKey: z.string().max(500).optional(),
    /** 写作温度：越高越多样；事实由占位符填充，不受温度影响。 */
    temperature: z.number().min(0).max(1.5).default(0.85),
  }),
  wechat: z.object({
    /** 默认 https://api.weixin.qq.com，可改为自建代理。 */
    apiBase: z.string().max(300).default(""),
  }),
  xiaohongshu: z.object({
    /** 小红书发布接口地址（自建中转或开放平台网关）。为空时只能辅助发布。 */
    publishUrl: z.string().max(300).default(""),
    /** 只写：调用发布接口的系统级密钥。 */
    apiKey: z.string().max(500).optional(),
  }),
});
export type SystemSettingsInput = z.infer<typeof SystemSettingsInputSchema>;

export const SystemSettingsViewSchema = z.object({
  model: z.object({ baseUrl: z.string(), name: z.string(), temperature: z.number(), apiKeySet: z.boolean(), source: z.enum(["settings", "env", "none"]) }),
  wechat: z.object({ apiBase: z.string() }),
  xiaohongshu: z.object({ publishUrl: z.string(), apiKeySet: z.boolean() }),
  updatedAt: IsoDateTimeSchema.optional(),
});
export type SystemSettingsView = z.infer<typeof SystemSettingsViewSchema>;

/* ------------------------------ 推广任务（总部下发） ------------------------------ */

export const CampaignStatusSchema = z.enum(["active", "archived"]);

export const CampaignInputSchema = z.object({
  title: z.string().min(1).max(60),
  products: z.array(ProductRefSchema).min(1).max(3),
  /** 推广主题 / 想让顾客记住的一件事，如“开学季轻薄本，宿舍到图书馆一台搞定”。 */
  theme: z.string().min(1).max(200),
  /** 目标人群，如“大一新生及家长”。 */
  audience: z.string().min(1).max(120),
  platforms: z.array(PlatformSchema).min(1),
  /** 不得出现的内容，如“不提价格”“不与竞品对比”。 */
  mustAvoid: z.string().max(200).default(""),
  dueAt: z.string().max(30).default(""),
  notes: z.string().max(500).default(""),
});
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

export const CampaignSchema = CampaignInputSchema.extend({
  campaignId: IdSchema,
  status: CampaignStatusSchema,
  createdAt: IsoDateTimeSchema,
  createdBy: z.string(),
  /** 冗余保存型号名，便于列表展示。 */
  productNames: z.array(z.string()),
});
export type Campaign = z.infer<typeof CampaignSchema>;

/* ------------------------------ 推文稿 ------------------------------ */

export const PostStatusSchema = z.enum(["draft", "selected", "published"]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

export const PostVariantSchema = z.object({
  variantId: IdSchema,
  /** 切入角度，如“通勤一天”“宿舍到图书馆”。 */
  angle: z.string(),
  article: ArticleSchema,
  report: VerificationReportSchema,
  /** model：模型写作 + 程序填事实；template：模型不可用时的模板稿。 */
  mode: z.enum(["model", "template"]),
  /** 与同一任务、同一平台其他门店已选稿件的最高相似度（0–1）。 */
  similarity: z.number().min(0).max(1).default(0),
  createdAt: IsoDateTimeSchema,
});
export type PostVariant = z.infer<typeof PostVariantSchema>;

export const PublishMethodSchema = z.enum(["api", "assist", "download"]);
export const PublishStateSchema = z.enum(["draft_created", "published", "pending_manual", "failed"]);

export const PublishRecordSchema = z.object({
  recordId: IdSchema,
  platform: PlatformSchema,
  method: PublishMethodSchema,
  state: PublishStateSchema,
  message: z.string(),
  url: z.string().optional(),
  externalId: z.string().optional(),
  at: IsoDateTimeSchema,
  by: z.string(),
});
export type PublishRecord = z.infer<typeof PublishRecordSchema>;

export const PostSchema = z.object({
  postId: IdSchema,
  campaignId: IdSchema,
  storeId: IdSchema,
  platform: PlatformSchema,
  status: PostStatusSchema,
  /** 场景判断（四段式第一段）：人群、场景、平台策略。 */
  judgement: z.object({ audience: z.string(), scene: z.string(), strategy: z.string() }),
  /** 本稿可用的知识库事实（四段式导出中的“知识库依据”）。 */
  facts: z.array(FactRecordSchema),
  images: z.array(ImageRecordSchema),
  /** 资料缺口与冲突说明。 */
  gaps: z.array(z.string()),
  isMock: z.boolean(),
  variants: z.array(PostVariantSchema),
  selectedVariantId: IdSchema.optional(),
  /** 导购修改后的稿件（重新核验过）。 */
  edited: z.object({ article: ArticleSchema, report: VerificationReportSchema, at: IsoDateTimeSchema }).optional(),
  publishes: z.array(PublishRecordSchema),
  /** 第几轮生成（重新生成时 +1，用于换一批角度）。 */
  round: z.number().int().nonnegative().default(0),
  revision: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Post = z.infer<typeof PostSchema>;

/** 门店任务列表项：任务 + 本店在各平台的进度。 */
export const StoreCampaignViewSchema = z.object({
  campaign: CampaignSchema,
  posts: z.array(z.object({ platform: PlatformSchema, postId: IdSchema.optional(), status: PostStatusSchema.or(z.literal("not_started")) })),
});
export type StoreCampaignView = z.infer<typeof StoreCampaignViewSchema>;

/** 总部看板：每个门店 × 平台的状态。 */
export const CampaignProgressSchema = z.object({
  campaign: CampaignSchema,
  stores: z.array(
    z.object({
      storeId: IdSchema,
      storeName: z.string(),
      platforms: z.array(z.object({ platform: PlatformSchema, status: PostStatusSchema.or(z.literal("not_started")), url: z.string().optional() })),
    }),
  ),
});
export type CampaignProgress = z.infer<typeof CampaignProgressSchema>;

/** 辅助发布包：前端据此复制文案、下载图片、打开平台。 */
export const AssistPackageSchema = z.object({
  platform: PlatformSchema,
  title: z.string(),
  /** 封面大字（小红书）：前端据此生成带字的封面图。 */
  coverText: z.string().optional(),
  text: z.string(),
  tags: z.array(z.string()),
  images: z.array(z.object({ imageId: IdSchema, url: z.string(), caption: z.string() })),
  /** 打开平台的链接（手机端 App 深链与网页端），可能为空。 */
  openUrls: z.object({ app: z.string().optional(), web: z.string().optional() }),
});
export type AssistPackage = z.infer<typeof AssistPackageSchema>;

export const PublishResponseSchema = z.object({ post: PostSchema, record: PublishRecordSchema, assist: AssistPackageSchema.optional() });
export type PublishResponse = z.infer<typeof PublishResponseSchema>;

export const PLATFORM_NAME: Record<z.infer<typeof PlatformSchema>, string> = {
  wechat_article: "微信公众号",
  xiaohongshu: "小红书",
  store_moments: "朋友圈",
  store_poster: "门店海报",
};

export const MARKETING_PATHS = {
  login: "/api/auth/login",
  me: "/api/auth/me",
  products: "/api/marketing/products",
  campaigns: "/api/marketing/campaigns",
  campaign: (id: string) => `/api/marketing/campaigns/${encodeURIComponent(id)}`,
  campaignProgress: (id: string) => `/api/marketing/campaigns/${encodeURIComponent(id)}/progress`,
  stores: "/api/marketing/stores",
  settings: "/api/marketing/settings",
  myCampaigns: "/api/marketing/my/campaigns",
  myProfile: "/api/marketing/my/profile",
  myChannels: "/api/marketing/my/channels",
  myChannel: (c: string) => `/api/marketing/my/channels/${encodeURIComponent(c)}`,
  myChannelTest: (c: string) => `/api/marketing/my/channels/${encodeURIComponent(c)}/test`,
  posts: "/api/marketing/posts",
  post: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}`,
  postGenerate: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}/generate`,
  postSelect: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}/select`,
  postEdit: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}/edit`,
  postPublish: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}/publish`,
  postReceipt: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}/receipt`,
  postExport: (id: string) => `/api/marketing/posts/${encodeURIComponent(id)}/export`,
  postImage: (id: string, imageId: string) => `/api/marketing/posts/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`,
} as const;
