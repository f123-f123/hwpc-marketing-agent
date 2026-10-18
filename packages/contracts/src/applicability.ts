import type { ProductRef, ProductIdentity } from "./product.js";
import type { DeviceCapability, DeviceKnowledgeSnapshot, DeviceRelation } from "./devices.js";
import type { Applicability, SceneDefinition } from "./scenes.js";

export interface ApplicabilityInput {
  def: SceneDefinition;
  bindings: Record<string, ProductRef>;
  /** 绑定设备的身份信息（用于类别检查）。 */
  products: ProductIdentity[];
  knowledge: DeviceKnowledgeSnapshot;
  /** 用户已确认满足的使用条件。 */
  confirmedConditionKeys?: string[];
  /** 场景版本已被标记失效。 */
  sceneInvalid?: { reason: string };
}

export interface ApplicabilityOutput {
  applicability: Applicability;
  /** 判断时用到的能力与关系，供实例冻结证据快照。 */
  usedCapabilities: DeviceCapability[];
  usedRelations: DeviceRelation[];
}

type Reason = Applicability["reasons"][number];

function capabilityFor(k: DeviceKnowledgeSnapshot, ref: ProductRef, feature: string): { cap?: DeviceCapability; reason?: Reason } {
  const same = k.capabilities.filter((c) => c.product.productId === ref.productId && c.feature === feature);
  // 先看是否有明确适用于该配置的记录；配置限定的记录在配置未指定时不能采用
  const scoped = same.filter((c) => c.configurationIds.length > 0);
  const general = same.filter((c) => c.configurationIds.length === 0);
  if (ref.configurationId) {
    const hit = scoped.find((c) => c.configurationIds.includes(ref.configurationId!)) ?? general[0];
    return { cap: hit };
  }
  if (scoped.length > 0) {
    // 该功能因配置而异，而用户未指定配置：不能确认
    const generalHit = general[0];
    if (generalHit) return { cap: generalHit };
    return { reason: { code: "configuration_unspecified", text: `功能 ${feature} 因配置而异，尚未选定配置`, feature } };
  }
  return { cap: general[0] };
}

/**
 * 判断一组设备绑定对场景是否适用。纯函数，无 I/O。
 * 原则：没有证据就是 unknown，绝不推断为 supported；任何 unsupported 直接 not_applicable。
 * 只有 applicable 才可呈现为“可用”。
 */
export function checkApplicability(input: ApplicabilityInput): ApplicabilityOutput {
  const { def, bindings, products, knowledge } = input;
  const confirmed = new Set(input.confirmedConditionKeys ?? []);
  const reasons: Reason[] = [];
  const usedCaps: DeviceCapability[] = [];
  const usedRels: DeviceRelation[] = [];
  const conditions = new Map<string, { conditionKey: string; text: string; satisfied: boolean }>();
  let blocked = false; // not_applicable
  let unknown = false;

  const addCondition = (c: { conditionKey: string; text: string }) => {
    if (!conditions.has(c.conditionKey)) conditions.set(c.conditionKey, { ...c, satisfied: confirmed.has(c.conditionKey) });
  };

  if (input.sceneInvalid) {
    reasons.push({ code: "scene_invalid", text: `该场景版本已失效：${input.sceneInvalid.reason}` });
    blocked = true;
  }

  const byId = new Map(products.map((p) => [p.productId, p]));

  for (const role of def.roles) {
    const ref = bindings[role.roleId];
    if (!ref) {
      if (role.required) {
        reasons.push({ code: "role_unbound", text: `角色“${role.label}”尚未绑定设备`, roleId: role.roleId });
        unknown = true;
      }
      continue;
    }
    const product = byId.get(ref.productId);
    if (!product?.category) {
      reasons.push({ code: "category_unknown", text: `设备 ${ref.productId} 的类别未知，无法确认能否担任“${role.label}”`, roleId: role.roleId });
      unknown = true;
    } else if (product.category !== role.category) {
      reasons.push({ code: "category_mismatch", text: `设备 ${product.model} 是 ${product.category}，不能担任“${role.label}”（需要 ${role.category}）`, roleId: role.roleId });
      blocked = true;
      continue;
    }
    for (const feature of role.requiredFeatures) {
      const { cap, reason } = capabilityFor(knowledge, ref, feature);
      if (reason) {
        reasons.push({ ...reason, roleId: role.roleId });
        unknown = true;
      } else if (!cap || cap.support === "unknown") {
        reasons.push({ code: "feature_unknown", text: `资料中没有 ${ref.productId} 的“${feature}”依据，不视为支持`, roleId: role.roleId, feature });
        unknown = true;
        if (cap) usedCaps.push(cap);
      } else if (cap.support === "unsupported") {
        reasons.push({ code: "feature_unsupported", text: `${ref.productId} 不支持“${cap.label}”`, roleId: role.roleId, feature });
        blocked = true;
        usedCaps.push(cap);
      } else {
        usedCaps.push(cap);
        cap.conditions.forEach(addCondition);
      }
    }
  }

  for (const req of def.relations) {
    const refs = req.roleIds.map((id) => ({ roleId: id, ref: bindings[id], role: def.roles.find((r) => r.roleId === id)! }));
    if (refs.some((r) => !r.ref)) {
      reasons.push({ code: "relation_unknown", text: `关系“${req.feature}”涉及的角色未全部绑定`, feature: req.feature });
      unknown = true;
      continue;
    }
    const candidates = knowledge.relations.filter((rel) => rel.feature === req.feature);
    // 每个角色都要在关系参与方里找到匹配（类别一致，且型号限定时包含该型号），且参与方不复用
    const matches = (rel: DeviceRelation) => {
      const remaining = [...rel.participants];
      for (const r of refs) {
        const idx = remaining.findIndex(
          (p) => p.category === r.role.category && (p.productIds.length === 0 || p.productIds.includes(r.ref!.productId)),
        );
        if (idx < 0) return false;
        remaining.splice(idx, 1);
      }
      return true;
    };
    const matched = candidates.filter(matches);
    if (matched.length === 0) {
      reasons.push({ code: "relation_unknown", text: `资料中没有这组设备的“${req.feature}”协同依据，不视为支持`, feature: req.feature });
      unknown = true;
      continue;
    }
    // 同组设备出现矛盾记录：保守处理，任一 unsupported 即不可用
    const worst = matched.find((m) => m.support === "unsupported") ?? matched.find((m) => m.support === "unknown") ?? matched[0]!;
    usedRels.push(...matched);
    if (worst.support === "unsupported") {
      reasons.push({ code: "relation_unsupported", text: `这组设备不支持“${worst.label}”`, feature: req.feature });
      blocked = true;
    } else if (worst.support === "unknown") {
      reasons.push({ code: "relation_unknown", text: `“${worst.label}”对这组设备的支持情况未知`, feature: req.feature });
      unknown = true;
    } else {
      worst.conditions.forEach(addCondition);
    }
  }

  const openConditions = [...conditions.values()];
  const open = openConditions.filter((c) => !c.satisfied);
  for (const c of open) reasons.push({ code: "condition_open", text: `需要满足：${c.text}` });

  const result: Applicability["result"] = blocked ? "not_applicable" : unknown ? "unknown" : open.length > 0 ? "conditional" : "applicable";
  const isMock =
    def.isMock ||
    usedCaps.some((c) => c.evidence.some((e) => e.source.origin === "mock")) ||
    usedRels.some((r) => r.evidence.some((e) => e.source.origin === "mock")) ||
    knowledge.isMock;

  return {
    applicability: { result, presentAsAvailable: result === "applicable", reasons, openConditions, isMock },
    usedCapabilities: dedupe(usedCaps, (c) => c.capabilityId),
    usedRelations: dedupe(usedRels, (r) => r.relationId),
  };
}

/** 说明性浏览（未绑定设备）：不做适用性判断，且明确不是个性化推荐。 */
export function illustrativeApplicability(def: SceneDefinition): Applicability {
  return {
    result: "illustrative",
    presentAsAvailable: false,
    reasons: [{ code: "illustrative_only", text: "通用说明，尚未结合你的已确认需求与设备，不是个性化推荐" }],
    openConditions: [],
    isMock: def.isMock,
  };
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
