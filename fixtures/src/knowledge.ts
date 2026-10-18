/**
 * 模拟设备知识（MOCK）：覆盖 supported / unsupported / unknown / 带条件 四种情形。
 * - air-14：有续航与协同依据（协同需登录同一账号）
 * - air-16：没有任何功能依据 → 一律 unknown
 * - phone-a + air-14：协同 supported
 * - phone-b + air-14：协同 unsupported（有明确依据）
 */
import {
  DeviceKnowledgeSnapshotSchema,
  type DeviceKnowledgeService,
  type DeviceKnowledgeSnapshot,
  type EvidenceRef,
  type ProductRef,
} from "@hwpc/contracts";
import { mockProducts } from "./data.js";

const ev = (title: string, locator: string): EvidenceRef => ({
  source: { origin: "mock", title: `【MOCK】${title}`, locator: `mock://${locator}`, capturedAt: "2000-01-01" },
  excerpt: "【MOCK】虚构资料摘录",
});

const ACCOUNT = {
  conditionKey: "same_account",
  kind: "account" as const,
  text: "两台设备需登录同一华为账号（虚构条件）",
  evidence: [ev("协同条件说明", "mock-collab/conditions.md")],
};

export function buildMockKnowledge(): DeviceKnowledgeSnapshot {
  return DeviceKnowledgeSnapshotSchema.parse({
    takenAt: "2026-01-01T00:00:00.000Z",
    products: mockProducts,
    capabilities: [
      {
        capabilityId: "cap-air14-battery",
        product: { productId: "mock-air-14" },
        configurationIds: [],
        feature: "all_day_battery",
        label: "全天续航",
        support: "supported",
        conditions: [],
        evidence: [{ factId: "mock-f-003", ...ev("续航数据", "mock-air-14/facts.md") }],
      },
      {
        capabilityId: "cap-air14-collab",
        product: { productId: "mock-air-14" },
        configurationIds: [],
        feature: "multi_screen_collab",
        label: "多屏协同",
        support: "supported",
        conditions: [ACCOUNT],
        evidence: [ev("协同说明", "mock-air-14/collab.md")],
      },
      {
        capabilityId: "cap-phonea-collab",
        product: { productId: "mock-phone-a" },
        configurationIds: [],
        feature: "multi_screen_collab",
        label: "多屏协同",
        support: "supported",
        conditions: [ACCOUNT],
        evidence: [ev("手机 A 协同说明", "mock-phone-a/collab.md")],
      },
      {
        capabilityId: "cap-phoneb-collab",
        product: { productId: "mock-phone-b" },
        configurationIds: [],
        feature: "multi_screen_collab",
        label: "多屏协同",
        support: "unsupported",
        conditions: [],
        evidence: [ev("手机 B 不支持协同", "mock-phone-b/collab.md")],
      },
    ],
    relations: [
      {
        relationId: "rel-air14-phonea",
        feature: "multi_screen_collab",
        label: "多屏协同",
        participants: [
          { roleId: "a", category: "pc", productIds: ["mock-air-14"] },
          { roleId: "b", category: "phone", productIds: ["mock-phone-a"] },
        ],
        support: "supported",
        conditions: [ACCOUNT],
        evidence: [ev("Air 14 与手机 A 协同", "mock-relations/air14-phonea.md")],
      },
      {
        relationId: "rel-air14-phoneb",
        feature: "multi_screen_collab",
        label: "多屏协同",
        participants: [
          { roleId: "a", category: "pc", productIds: ["mock-air-14"] },
          { roleId: "b", category: "phone", productIds: ["mock-phone-b"] },
        ],
        support: "unsupported",
        conditions: [],
        evidence: [ev("Air 14 与手机 B 不互通", "mock-relations/air14-phoneb.md")],
      },
    ],
    isMock: true,
  });
}

export function createMockKnowledgeService(): DeviceKnowledgeService {
  return {
    async getKnowledge(products: ProductRef[]): Promise<DeviceKnowledgeSnapshot> {
      const ids = new Set(products.map((p) => p.productId));
      const full = buildMockKnowledge();
      return {
        ...full,
        products: full.products.filter((p) => ids.has(p.productId)),
        capabilities: full.capabilities.filter((c) => ids.has(c.product.productId)),
        relations: full.relations.filter((r) => r.participants.some((p) => p.productIds.some((id) => ids.has(id)))),
      };
    },
  };
}
