import type { FactRecord, ImageRecord, ResultVersion } from "@hwpc/contracts";
import type { InteractivePlan } from "./types";

export const ORIGIN_LABEL = { local: "本地资料", ima: "ima 知识库", mock: "模拟数据（MOCK）" } as const;
export const PLATFORM_LABEL = { wechat_article: "公众号", xiaohongshu: "小红书", store_moments: "门店朋友圈", store_poster: "门店海报" } as const;
export const DELIVERY_LABEL = {
  deliverable: "可交付",
  deliverable_with_notes: "可交付（含备注）",
  needs_confirmation: "待确认，不应直接发布",
  blocked: "已阻止交付",
} as const;
export const RESOLUTION_LABEL = {
  passed: "已通过",
  removed: "已删除无依据内容",
  rewritten: "已改写修复",
  flagged: "已保留并标注限制",
  pending_user: "待你确认",
} as const;

export interface Lookup {
  fact(id: string): FactRecord | undefined;
  image(id: string): ImageRecord | undefined;
}

/** 只从当前版本自己的资料包取值，保证互动状态里的事实与图片属于该版本。 */
export function lookupFor(rv: ResultVersion): Lookup {
  const facts = new Map(rv.materialPack.facts.map((f) => [f.factId, f]));
  const images = new Map(rv.materialPack.images.map((i) => [i.imageId, i]));
  return { fact: (id) => facts.get(id), image: (id) => images.get(id) };
}

export interface PlanCheck {
  /** 可以安全渲染的状态。 */
  renderable: Set<string>;
  /** 不能渲染的状态及原因（未核验或引用缺失）。 */
  blocked: { stateId: string; reason: string }[];
}

/** 渲染前检查：状态必须在后端核验名单内，且引用的事实、图片存在于当前版本。 */
export function checkPlan(plan: InteractivePlan, rv: ResultVersion): PlanCheck {
  const lk = lookupFor(rv);
  const verified = new Set(plan.verifiedStateIds);
  const renderable = new Set<string>();
  const blocked: PlanCheck["blocked"] = [];
  const test = (stateId: string, factIds: string[], imageIds: string[]) => {
    if (!verified.has(stateId)) return blocked.push({ stateId, reason: "该互动状态未经后端核验" });
    const missF = factIds.find((id) => !lk.fact(id));
    if (missF) return blocked.push({ stateId, reason: `引用的事实 ${missF} 不在当前版本资料中` });
    const missI = imageIds.find((id) => !lk.image(id));
    if (missI) return blocked.push({ stateId, reason: `引用的图片 ${missI} 不在当前版本资料中` });
    const productIds = new Set(rv.materialPack.products.map((p) => p.productId));
    for (const id of factIds) if (!productIds.has(lk.fact(id)!.productId)) return blocked.push({ stateId, reason: "事实对应的型号不在当前版本范围内" });
    renderable.add(stateId);
  };
  for (const s of plan.scenes) test(s.stateId, s.items.flatMap((i) => i.factIds), s.items.flatMap((i) => (i.imageId ? [i.imageId] : [])));
  for (const c of plan.claims) test(c.stateId, c.factIds, c.imageIds);
  if (plan.compare) test(plan.compare.stateId, plan.compare.rows.flatMap((r) => r.cells.flatMap((c) => c.factIds)), []);
  return { renderable, blocked };
}

export function factLine(f: FactRecord): string {
  const q = f.qualifiers.length ? `（${f.qualifiers.join("；")}）` : "";
  return `${f.field}：${f.value}${q}`;
}

/** 配置范围说明：空数组表示该型号下所有配置通用。 */
export function scopeText(rv: ResultVersion, productId: string, configurationIds: string[]): string {
  const p = rv.materialPack.products.find((x) => x.productId === productId);
  if (!p) return "未知型号";
  if (configurationIds.length === 0) return `${p.model} · 全部配置`;
  const labels = configurationIds.map((id) => p.configurations.find((c) => c.configurationId === id)?.label ?? id);
  return `${p.model} · ${labels.join("、")}`;
}
