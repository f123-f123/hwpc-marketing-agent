import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { EvidenceRefSchema } from "./evidence.js";
import { DeviceCategorySchema, ProductIdentitySchema, ProductRefSchema } from "./product.js";

/** 功能键：小写 slug，如 "multi_screen_collab"。由资料层（Agent A）与场景定义共同使用。 */
export const FeatureKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, "功能键须为小写字母、数字、下划线");

export const SupportSchema = z.enum(["supported", "unsupported", "unknown"]);
export type Support = z.infer<typeof SupportSchema>;

export const ConditionKindSchema = z.enum(["os", "software", "accessory", "setting", "account", "network", "other"]);

/**
 * 使用条件：功能成立所需的前置。conditionKey 稳定，用于记录“用户已确认满足”。
 * 条件本身也要有证据，否则只是未经证实的说法。
 */
export const CapabilityConditionSchema = z.object({
  conditionKey: z.string().min(1).max(80),
  kind: ConditionKindSchema,
  text: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).default([]),
});
export type CapabilityCondition = z.infer<typeof CapabilityConditionSchema>;

/** 某型号（可限定配置）的功能。supported 必须有证据。 */
export const DeviceCapabilitySchema = z
  .object({
    capabilityId: IdSchema,
    product: ProductRefSchema,
    /** 非空 = 仅这些配置具备；空 = 型号下所有配置（依据 evidence 的适用范围）。 */
    configurationIds: z.array(IdSchema).default([]),
    feature: FeatureKeySchema,
    label: z.string().min(1),
    support: SupportSchema,
    conditions: z.array(CapabilityConditionSchema).default([]),
    evidence: z.array(EvidenceRefSchema).default([]),
    note: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.support === "supported" && c.evidence.length === 0) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "support=supported 必须有证据；没有证据只能是 unknown" });
    }
  });
export type DeviceCapability = z.infer<typeof DeviceCapabilitySchema>;

export const RelationParticipantSchema = z.object({
  roleId: z.string().min(1),
  category: DeviceCategorySchema,
  /** 空 = 该类别下证据覆盖的任何型号；非空 = 仅限这些型号。 */
  productIds: z.array(IdSchema).default([]),
});

/** 设备间关系/协同：两台及以上设备组合后才成立的功能。 */
export const DeviceRelationSchema = z
  .object({
    relationId: IdSchema,
    feature: FeatureKeySchema,
    label: z.string().min(1),
    participants: z.array(RelationParticipantSchema).min(2),
    support: SupportSchema,
    /** 系统/软件/配件/账号等组合条件。 */
    conditions: z.array(CapabilityConditionSchema).default([]),
    evidence: z.array(EvidenceRefSchema).default([]),
  })
  .superRefine((r, ctx) => {
    if (r.support === "supported" && r.evidence.length === 0) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "support=supported 必须有证据" });
    }
  });
export type DeviceRelation = z.infer<typeof DeviceRelationSchema>;

export const DeviceKnowledgeSnapshotSchema = z.object({
  takenAt: IsoDateTimeSchema,
  /** 涉及设备的身份（含类别）。类别缺失视为未知，不会被当作 PC。 */
  products: z.array(ProductIdentitySchema),
  capabilities: z.array(DeviceCapabilitySchema),
  relations: z.array(DeviceRelationSchema),
  isMock: z.boolean(),
});
export type DeviceKnowledgeSnapshot = z.infer<typeof DeviceKnowledgeSnapshotSchema>;

/**
 * 设备知识服务（Agent A 实现）。只返回有资料依据的能力与关系；
 * 查不到就返回 support="unknown" 的记录或不返回，绝不推断为 supported。
 */
export interface DeviceKnowledgeService {
  getKnowledge(
    products: z.infer<typeof ProductRefSchema>[],
    signal?: AbortSignal,
  ): Promise<DeviceKnowledgeSnapshot>;
}
