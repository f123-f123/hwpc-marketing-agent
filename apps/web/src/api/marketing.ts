import {
  CatalogDetailSchema,
  CatalogOverviewSchema,
  CatalogSearchHitSchema,
  LibraryDocContentSchema,
  CampaignProgressSchema,
  CampaignSchema,
  ChannelBindingViewSchema,
  LoginResponseSchema,
  MeResponseSchema,
  MARKETING_PATHS,
  PostSchema,
  PublishResponseSchema,
  StoreCampaignViewSchema,
  StoreProfileSchema,
  SystemSettingsViewSchema,
  UserSchema,
  type Article,
  type CampaignInput,
  type Channel,
  type ChannelBindingInput,
  type Platform,
  type StoreProfile,
  type StyleChoice,
  type SystemSettingsInput,
} from "@hwpc/contracts";
import { call, type Schema } from "./client";

export interface ProductOption {
  productId: string;
  model: string;
  family: string;
}

const productsSchema: Schema<ProductOption[]> = {
  safeParse: (d) =>
    Array.isArray(d) && d.every((x) => typeof x?.productId === "string" && typeof x?.model === "string") ? { success: true, data: d as ProductOption[] } : { success: false },
};
const ok: Schema<{ ok: true }> = { safeParse: (d) => ((d as { ok?: unknown })?.ok === true ? { success: true, data: { ok: true } } : { success: false }) };

export const marketingApi = {
  login: (username: string, password: string) => call(MARKETING_PATHS.login, LoginResponseSchema, { username, password }),
  logout: () => call("/api/auth/logout", ok, {}),
  me: async () => (await call(MARKETING_PATHS.me, MeResponseSchema)).user,
  changePassword: (oldPassword: string, newPassword: string) => call("/api/auth/password", ok, { oldPassword, newPassword }),

  products: () => call(MARKETING_PATHS.products, productsSchema),

  // 资料库（门店与总部都能看）
  catalog: () => call(MARKETING_PATHS.catalog, CatalogOverviewSchema),
  catalogProduct: (id: string) => call(MARKETING_PATHS.catalogProduct(id), CatalogDetailSchema),
  catalogDoc: (id: string) => call(MARKETING_PATHS.catalogDoc(id), LibraryDocContentSchema),
  catalogSearch: (q: string) => call(MARKETING_PATHS.catalogSearch(q), CatalogSearchHitSchema.array()),
  /** 知识库图片（服务端只读索引里登记过的文件）。 */
  libraryImage: (imageId: string) => `/api/library/images/${encodeURIComponent(imageId)}`,

  // 总部
  campaigns: () => call(MARKETING_PATHS.campaigns, CampaignSchema.array()),
  createCampaign: (input: CampaignInput) => call(MARKETING_PATHS.campaigns, CampaignSchema, input),
  setCampaignStatus: (id: string, status: "active" | "archived") => call(MARKETING_PATHS.campaign(id), CampaignSchema, { status }, "PATCH"),
  progress: (id: string) => call(MARKETING_PATHS.campaignProgress(id), CampaignProgressSchema),
  stores: () => call(MARKETING_PATHS.stores, StoreProfileSchema.array()),
  createStore: (input: { storeId: string; name: string; password: string }) => call(MARKETING_PATHS.stores, UserSchema, input),
  resetStorePassword: (storeId: string, password: string) => call(`${MARKETING_PATHS.stores}/${encodeURIComponent(storeId)}/password`, ok, { password }),
  settings: () => call(MARKETING_PATHS.settings, SystemSettingsViewSchema),
  saveSettings: (input: SystemSettingsInput) => call(MARKETING_PATHS.settings, SystemSettingsViewSchema, input, "PUT"),

  // 门店
  myCampaigns: () => call(MARKETING_PATHS.myCampaigns, StoreCampaignViewSchema.array()),
  myProfile: () => call(MARKETING_PATHS.myProfile, StoreProfileSchema),
  saveProfile: (input: Omit<StoreProfile, "storeId" | "updatedAt">) => call(MARKETING_PATHS.myProfile, StoreProfileSchema, input, "PUT"),
  channels: () => call(MARKETING_PATHS.myChannels, ChannelBindingViewSchema.array()),
  bindChannel: (input: ChannelBindingInput) => call(MARKETING_PATHS.myChannel(input.channel), ChannelBindingViewSchema, input, "PUT"),
  unbindChannel: (channel: Channel) => call(MARKETING_PATHS.myChannel(channel), ChannelBindingViewSchema, undefined, "DELETE"),
  testChannel: (channel: Channel) => call(MARKETING_PATHS.myChannelTest(channel), ChannelBindingViewSchema, {}),

  // 稿件
  openPost: (campaignId: string, platform: Platform) => call(MARKETING_PATHS.posts, PostSchema, { campaignId, platform }),
  post: (id: string) => call(MARKETING_PATHS.post(id), PostSchema),
  /** style：本次指定的语言 / 视觉风格，不填的一项由系统轮换。 */
  regenerate: (id: string, style: StyleChoice = {}) => call(MARKETING_PATHS.postGenerate(id), PostSchema, style),
  select: (id: string, variantId: string) => call(MARKETING_PATHS.postSelect(id), PostSchema, { variantId }),
  edit: (id: string, article: Article) => call(MARKETING_PATHS.postEdit(id), PostSchema, { article }),
  publish: (id: string) => call(MARKETING_PATHS.postPublish(id), PublishResponseSchema, {}),
  receipt: (id: string, url?: string) => call(MARKETING_PATHS.postReceipt(id), PostSchema, url ? { url } : {}),
  exportUrl: (id: string) => MARKETING_PATHS.postExport(id),
  imageUrl: (id: string, imageId: string) => MARKETING_PATHS.postImage(id, imageId),
};
