/**
 * 界面模拟服务用的作品构造。全部来自 @hwpc/fixtures 的虚构数据（MOCK）。
 * 真实后端接入后此文件不再被使用。
 */
import { buildMockConflictPack, buildMockMaterialPack, buildMockResultVersion, mockFacts, mockImages, mockProducts } from "@hwpc/fixtures";
import type { MaterialPack, ResultVersion } from "@hwpc/contracts";
import type { InteractivePlan } from "../types";

export type Scope = "air14" | "compare";

export function buildPack(taskId: string, scope: Scope, blocked: boolean): MaterialPack {
  const base = buildMockMaterialPack(taskId, "mock-air-14");
  if (scope === "air14" && !blocked) return base;
  const gaps = [...base.gaps];
  let facts = scope === "compare" ? mockFacts : base.facts;
  let conflicts = base.conflicts;
  if (blocked) {
    const c = buildMockConflictPack(taskId);
    facts = [...facts, ...c.facts.filter((f) => !facts.some((x) => x.factId === f.factId))];
    conflicts = c.conflicts;
  }
  if (scope === "compare") gaps.push("【MOCK】示例本 Air 16 的续航与接口资料未提供：不得写成与 Air 14 相同");
  return {
    ...base,
    products: scope === "compare" ? mockProducts : base.products,
    facts,
    images: scope === "compare" ? mockImages : base.images,
    conflicts,
    gaps,
  };
}

export interface BuildOptions {
  sessionId: string;
  version: number;
  audience: string;
  reason: ResultVersion["reason"];
  instruction?: string;
  requirementVersion: number;
  scope: Scope;
  /** force：用户坚持写入存在冲突的续航数值，作品被阻止交付。 */
  battery: "omit" | "force";
}

export function buildMockWork(o: BuildOptions): ResultVersion {
  const base = buildMockResultVersion(o.sessionId);
  const blocked = o.battery === "force";
  const suffix = o.version > 1 ? `（v${o.version}）` : "";
  const blocks = blocked ? base.article.blocks : base.article.blocks.filter((b) => !(b.type === "paragraph" && b.heading === "撑一天"));
  const findings = base.verification.findings.map((f) => ({ ...f })).filter((f) => blocked || f.findingId !== "mock-v-003");
  if (blocked) {
    findings.push({
      findingId: "mock-v-009", kind: "conflict", severity: "blocker", blockIndex: 3,
      message: "续航存在两个来源且数值冲突（10 / 14 小时），未经人工确认不得交付",
      factIds: ["mock-f-003", "mock-f-008"], imageIds: [], resolution: "pending_user",
    });
  } else {
    findings.push({
      findingId: "mock-v-010", kind: "fact", severity: "major",
      message: "续航资料存在冲突，按用户选择不写入续航数值",
      factIds: ["mock-f-003"], imageIds: [], resolution: "removed", resolutionNote: "已删除续航段落",
    });
  }
  if (o.instruction) {
    findings.push({
      findingId: "mock-v-011", kind: "compliance", severity: "minor",
      message: `已按修改要求处理：${o.instruction.slice(0, 40)}`, factIds: [], imageIds: [], resolution: "passed",
    });
  }
  const at = new Date().toISOString();
  return {
    ...base,
    version: o.version,
    reason: o.reason,
    instruction: o.instruction,
    createdAt: at,
    strategy: { ...base.strategy, audience: o.audience },
    article: { ...base.article, title: `${base.article.title}${suffix}`, blocks },
    verification: {
      findings,
      pendingConfirmations: blocked ? ["续航数值：两个来源冲突，需人工核实后再发布"] : [],
      deliveryStatus: blocked ? "blocked" : "deliverable_with_notes",
      checkedAt: at,
    },
    materialPack: buildPack(o.sessionId, o.scope, blocked),
    isMock: true,
  };
}

export function buildMockInteractive(scope: Scope): InteractivePlan {
  const scenes = [
    {
      stateId: "scene-class", label: "课堂与图书馆",
      why: "按已确认的“开学上课”场景，先看携带与接口",
      items: [{ factIds: ["mock-f-002"], imageId: "mock-i-002" }, { factIds: ["mock-f-006"], imageId: "mock-i-003" }],
    },
    { stateId: "scene-dorm", label: "宿舍与自习室", why: "宿舍使用更关心连接外设与买前确认", items: [{ factIds: ["mock-f-006", "mock-f-007"] }] },
  ];
  const claims = [
    { stateId: "claim-weight", headline: "背着走的重量", factIds: ["mock-f-002"], imageIds: ["mock-i-002"] },
    { stateId: "claim-ports", headline: "接口够不够用", factIds: ["mock-f-006"], imageIds: ["mock-i-003"] },
    { stateId: "claim-limit", headline: "买前需要确认的事", factIds: ["mock-f-007"], imageIds: [] },
  ];
  const compare =
    scope === "compare"
      ? {
          stateId: "compare-14-16",
          productIds: ["mock-air-14", "mock-air-16"],
          rows: [
            { rowId: "r-size", label: "屏幕尺寸", cells: [{ productId: "mock-air-14", factIds: ["mock-f-001"] }, { productId: "mock-air-16", factIds: ["mock-f-101"] }] },
            { rowId: "r-weight", label: "重量", cells: [{ productId: "mock-air-14", factIds: ["mock-f-002"] }, { productId: "mock-air-16", factIds: ["mock-f-102"] }] },
            { rowId: "r-ports", label: "接口", cells: [{ productId: "mock-air-14", factIds: ["mock-f-006"] }, { productId: "mock-air-16", factIds: [] }] },
          ],
        }
      : undefined;
  return {
    planId: "plan-mock",
    title: "开学选购小帮手（模拟）",
    intro: "按你确认的使用场景查看对应资料；每条事实都可展开依据与限制。",
    deliverableBasis: "已确认交付形式：平台图文 + 互动网页",
    scenes, claims, compare,
    verifiedStateIds: [...scenes.map((s) => s.stateId), ...claims.map((c) => c.stateId), ...(compare ? [compare.stateId] : [])],
  };
}
