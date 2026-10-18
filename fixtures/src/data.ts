/**
 * 模拟数据（MOCK）。
 * 以下型号、参数、图片均为虚构，仅用于开发联调与测试，
 * 不是真实华为产品资料，也不是 ima 或本地知识库的真实返回。
 * 所有记录 origin="mock"，名称带【MOCK】前缀。
 */
import type { FactRecord, ImageRecord, MarketingTaskInput, MaterialPack, ProductIdentity, SourceRef } from "@hwpc/contracts";

export const MOCK_NOTICE = "【MOCK 模拟数据】非真实华为产品资料，不得用于发布。";

const src = (title: string, locator: string): SourceRef => ({
  origin: "mock",
  title: `【MOCK】${title}`,
  locator: `mock://${locator}`,
  capturedAt: "2000-01-01",
});

export const mockProducts: ProductIdentity[] = [
  {
    productId: "mock-air-14",
    category: "pc",
    family: "【MOCK】示例本 Air",
    model: "【MOCK】示例本 Air 14",
    aliases: ["示例本Air14", "mock air 14"],
    configurations: [
      { configurationId: "mock-air-14-std", label: "标准版", attributes: { 版本: "标准版", 存储: "512GB" } },
      { configurationId: "mock-air-14-se", label: "SE 版", attributes: { 版本: "SE 版", 存储: "256GB" } },
    ],
    origin: "mock",
  },
  {
    productId: "mock-air-16",
    category: "pc",
    family: "【MOCK】示例本 Air",
    model: "【MOCK】示例本 Air 16",
    aliases: ["示例本Air16", "mock air 16"],
    configurations: [{ configurationId: "mock-air-16-std", label: "标准版", attributes: { 版本: "标准版" } }],
    origin: "mock",
  },
  {
    productId: "mock-phone-a",
    category: "phone",
    family: "【MOCK】示例手机",
    model: "【MOCK】示例手机 A",
    aliases: ["示例手机A", "mock phone a"],
    configurations: [],
    origin: "mock",
  },
  {
    productId: "mock-phone-b",
    category: "phone",
    family: "【MOCK】示例手机",
    model: "【MOCK】示例手机 B",
    aliases: ["示例手机B", "mock phone b"],
    configurations: [],
    origin: "mock",
  },
];

const f = (
  factId: string,
  productId: string,
  category: FactRecord["category"],
  field: string,
  value: string,
  opts: { configurationIds?: string[]; qualifiers?: string[]; sourceTitle?: string } = {},
): FactRecord => ({
  factId,
  productId,
  configurationIds: opts.configurationIds ?? [],
  category,
  field,
  value,
  qualifiers: opts.qualifiers ?? [],
  source: src(opts.sourceTitle ?? `${productId} 规格`, `${productId}/facts.md`),
  reviewStatus: "verified",
});

export const mockFacts: FactRecord[] = [
  f("mock-f-001", "mock-air-14", "display", "屏幕尺寸", "14 英寸（虚构）"),
  f("mock-f-002", "mock-air-14", "portability", "重量", "约 1.2 kg（虚构）", { qualifiers: ["实际重量因配置而异（虚构限定条件）"] }),
  f("mock-f-003", "mock-air-14", "battery", "续航", "视频播放最长 10 小时（虚构）", { qualifiers: ["实验室数据，实际使用因场景而异（虚构）"] }),
  f("mock-f-004", "mock-air-14", "memory_storage", "存储", "512GB", { configurationIds: ["mock-air-14-std"] }),
  f("mock-f-005", "mock-air-14", "memory_storage", "存储", "256GB", { configurationIds: ["mock-air-14-se"], qualifiers: ["仅 SE 版"] }),
  f("mock-f-006", "mock-air-14", "ports", "接口", "2 个 Type-C、1 个 HDMI（虚构）"),
  f("mock-f-007", "mock-air-14", "limitation", "系统兼容", "部分第三方软件需确认兼容后使用（虚构）", { qualifiers: ["购买前请确认常用软件"] }),
  f("mock-f-101", "mock-air-16", "display", "屏幕尺寸", "16 英寸（虚构）"),
  f("mock-f-102", "mock-air-16", "portability", "重量", "约 1.7 kg（虚构）"),
];

const img = (
  imageId: string,
  productId: string,
  role: ImageRecord["role"],
  description: string,
  usageNote: string,
  configurationIds: string[] = [],
): ImageRecord => ({
  imageId,
  productId,
  configurationIds,
  role,
  description: `【MOCK】${description}`,
  usageNote,
  source: src(`${productId} 图片`, `${productId}/images/${imageId}`),
  access: { kind: "mock_placeholder", label: `MOCK ${imageId}` },
  mimeType: "image/svg+xml",
  width: 1200,
  height: 800,
});

export const mockImages: ImageRecord[] = [
  img("mock-i-001", "mock-air-14", "hero", "示例本 Air 14 主视觉（占位图）", "适合作为头图"),
  img("mock-i-002", "mock-air-14", "scene", "示例本 Air 14 校园场景（占位图）", "适合学习/携带场景"),
  img("mock-i-003", "mock-air-14", "ports", "示例本 Air 14 接口细节（占位图）", "适合讲解接口"),
  img("mock-i-004", "mock-air-14", "detail", "示例本 Air 14 SE 版外观（占位图）", "仅 SE 版", ["mock-air-14-se"]),
  img("mock-i-101", "mock-air-16", "hero", "示例本 Air 16 主视觉（占位图）", "适合作为头图"),
];

const NOW = "2026-01-01T00:00:00.000Z";

/** 单型号资料包。 */
export function buildMockMaterialPack(taskId: string, productId = "mock-air-14"): MaterialPack {
  const products = mockProducts.filter((p) => p.productId === productId);
  if (products.length === 0) throw new Error(`未知的 mock 产品: ${productId}`);
  return {
    packId: `mock-pack-${taskId}`,
    taskId,
    products,
    facts: mockFacts.filter((x) => x.productId === productId),
    images: mockImages.filter((x) => x.productId === productId),
    conflicts: [],
    gaps: ["【MOCK】未提供价格资料：不得写入任何价格或优惠"],
    origins: ["mock"],
    isMock: true,
    createdAt: NOW,
  };
}

/** 含未解决冲突的资料包，用于测试“资料冲突 → 停止并请求人工确认”。 */
export function buildMockConflictPack(taskId: string): MaterialPack {
  const base = buildMockMaterialPack(taskId, "mock-air-14");
  const extra = f("mock-f-008", "mock-air-14", "battery", "续航", "视频播放最长 14 小时（虚构，与 mock-f-003 冲突）", {
    sourceTitle: "另一来源的续航数据",
  });
  return {
    ...base,
    facts: [...base.facts, extra],
    conflicts: [
      {
        conflictId: "mock-c-001",
        productId: "mock-air-14",
        field: "续航",
        factIds: ["mock-f-003", "mock-f-008"],
        description: "【MOCK】两条资料给出不同的续航数值，需人工确认",
        status: "unresolved",
      },
    ],
  };
}

/** 信息完整的示例任务。 */
export const mockTaskInput: MarketingTaskInput = {
  rawRequest: "给准备开学的大学新生写一篇小红书图文",
  productQuery: "示例本 Air 14",
  productRef: { productId: "mock-air-14", configurationId: "mock-air-14-std" },
  audience: "大学新生",
  scenario: "back_to_school",
  platform: "xiaohongshu",
  purchaseStage: "consideration",
  extraRequirements: "不要提价格",
};

/** 信息不足的示例任务（只说想买轻薄本）。 */
export const mockIncompleteTaskInput: MarketingTaskInput = { rawRequest: "想买轻薄本" };

/** 型号有歧义的示例任务（"示例本 Air" 命中 14 与 16）。 */
export const mockAmbiguousTaskInput: MarketingTaskInput = {
  productQuery: "示例本 Air",
  audience: "职场新人",
  scenario: "business_office",
  platform: "wechat_article",
};
