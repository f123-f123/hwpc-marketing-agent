import {
  isCriticalNeedKey,
  type ImpactRecord,
  type NeedKey,
  type PersonalPlan,
  type SceneInstance,
  type SessionRecord,
} from "@hwpc/contracts";

export interface NeedChangeInfo {
  cause: ImpactRecord["cause"];
  at: string;
  feedbackId?: string;
  fromNeedVersion: number;
  toNeedVersion: number;
  changedKeys: NeedKey[];
  changedEntryIds: string[];
  /** 额外说明（如“否决了机型”）。 */
  extraCritical?: boolean;
  newQuestionIds: string[];
  idFactory: () => string;
}

/**
 * 需求变化的影响分析与落实（原地修改 record，调用方负责保存）。确定性规则，无模型参与：
 * - 任何需求变化：有效确认作废；已保存候选评价过期（由 stale 比较体现）。
 * - 关键变化（任务/环境/预算/已有设备/必要软件/硬条件）：当前方案 → stale。
 * - 仅偏好/顾虑变化：当前方案 → 保持 current，但 needsReview。
 */
export function applyNeedChangeImpact(record: SessionRecord, info: NeedChangeInfo): ImpactRecord {
  const critical = info.extraCritical === true || info.changedKeys.some(isCriticalNeedKey);
  const invalidated: string[] = [];
  for (const c of record.confirmations) {
    if (c.status === "valid") {
      c.status = "invalidated";
      c.invalidatedAt = info.at;
      c.invalidatedByVersion = info.toNeedVersion;
      c.invalidatedReason = critical ? "关键需求发生变化" : "需求发生变化（偏好或顾虑）";
      invalidated.push(c.confirmationId);
    }
  }

  const stale: number[] = [];
  const review: number[] = [];
  const affected = new Set<string>();
  for (const plan of record.plans) {
    if (plan.status !== "current") continue;
    const planInstances = record.instances.filter((i) => i.planVersion === plan.version && i.mode === "personal");
    if (critical) {
      plan.status = "stale";
      plan.staleReason = `需求已变化（${info.changedKeys.join("、") || "硬条件"}），该方案不再对应当前需求`;
      stale.push(plan.version);
      for (const i of planInstances) {
        // 旧方案下的个人场景实例不能再被当作“当前组合已体验”，否则会把过期进度带进新需求。
        if (i.status === "active") {
          i.status = "superseded";
          i.invalidReason = "所属方案已不再对应当前需求，需重新确认后生成新方案";
        }
        affected.add(i.instanceId);
      }
    } else {
      plan.needsReview = true;
      plan.reviewNote = "偏好或顾虑有变化，方案尚未据此复核";
      review.push(plan.version);
      for (const s of plan.scenes) {
        if (s.relatedNeedEntryIds.some((id) => info.changedEntryIds.includes(id))) affected.add(s.instanceId);
      }
    }
  }

  const impact: ImpactRecord = {
    impactId: info.idFactory(),
    feedbackId: info.feedbackId,
    cause: info.cause,
    at: info.at,
    fromNeedVersion: info.fromNeedVersion,
    toNeedVersion: info.toNeedVersion,
    changedNeedKeys: info.changedKeys,
    critical,
    invalidatedConfirmationIds: invalidated,
    stalePlanVersions: stale,
    reviewPlanVersions: review,
    affectedInstanceIds: [...affected],
    requiresReconfirmation: true,
    requiresReassessment: true,
    newQuestionIds: info.newQuestionIds,
    summary: describeImpact(critical, stale, review, invalidated.length, info.newQuestionIds.length),
  };
  record.impacts.push(impact);
  return impact;
}

function describeImpact(critical: boolean, stale: number[], review: number[], invalidatedCount: number, newQ: number): string {
  const parts: string[] = [];
  parts.push(critical ? "这是关键需求变化" : "这是偏好或顾虑变化");
  if (invalidatedCount) parts.push("之前的确认已失效，需要重新确认");
  if (stale.length) parts.push(`方案 v${stale.join("、v")} 不再对应当前需求`);
  if (review.length) parts.push(`方案 v${review.join("、v")} 需要复核`);
  if (newQ) parts.push(`新增 ${newQ} 个待回答问题`);
  return `${parts.join("；")}。`;
}

/** 场景版本被标记失效后的影响：对应实例失效，方案待复核（不静默继续宣称有效）。 */
export function applySceneInvalidationImpact(
  record: SessionRecord,
  inv: { sceneId: string; version: number; reason: string; replacedByVersion?: number },
  at: string,
  idFactory: () => string,
): ImpactRecord | undefined {
  const hit: SceneInstance[] = record.instances.filter((i) => i.sceneId === inv.sceneId && i.sceneVersion === inv.version && i.status === "active");
  if (hit.length === 0) return undefined;
  const review: number[] = [];
  const affected: string[] = [];
  for (const i of hit) {
    i.status = "invalid";
    i.invalidReason = `场景 ${inv.sceneId}@${inv.version} 已失效：${inv.reason}`;
    affected.push(i.instanceId);
    const plan: PersonalPlan | undefined = record.plans.find((p) => p.version === i.planVersion);
    if (plan && plan.status === "current") {
      plan.needsReview = true;
      plan.reviewNote = `${plan.reviewNote ? `${plan.reviewNote}；` : ""}场景“${inv.sceneId}”v${inv.version} 已失效：${inv.reason}${inv.replacedByVersion ? `（建议迁移到 v${inv.replacedByVersion}，需你确认）` : ""}`;
      if (!review.includes(plan.version)) review.push(plan.version);
    }
  }
  const impact: ImpactRecord = {
    impactId: idFactory(),
    cause: "scene_invalidated",
    at,
    changedNeedKeys: [],
    critical: false,
    invalidatedConfirmationIds: [],
    stalePlanVersions: [],
    reviewPlanVersions: review,
    affectedInstanceIds: affected,
    requiresReconfirmation: false,
    requiresReassessment: false,
    newQuestionIds: [],
    summary: `场景“${inv.sceneId}”v${inv.version} 已失效（${inv.reason}），${affected.length} 个已保存实例标记为失效。`,
  };
  record.impacts.push(impact);
  return impact;
}
