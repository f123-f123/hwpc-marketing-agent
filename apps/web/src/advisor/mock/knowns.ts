/**
 * 界面模拟：需求要点的提取与展示。
 * 这里的关键词匹配只代表 B 的行为，用于前端联调，不是真实判断逻辑。
 */
import type {
  CandidateProduct,
  MaterialGap,
  Provenance,
  QuestionOption,
  RequirementItem,
  RequirementKey,
  RequirementSummary,
  SummaryField,
} from "../types";

export interface Knowns {
  audience?: string;
  channel?: string;
  deliverable?: "platform_only" | "platform_plus_interactive";
  problem?: string;
  constraints?: string;
  scope?: "air14" | "air16" | "compare";
  battery?: "omit" | "force";
  overrides: Partial<Record<RequirementKey, string>>;
}

export const AUDIENCE_OPTIONS: QuestionOption[] = [
  { value: "大学新生", label: "大学新生", hint: "开学购机" },
  { value: "职场/商务用户", label: "职场/商务用户", hint: "出差、会议" },
  { value: "内容创作者", label: "内容创作者", hint: "设计、剪辑" },
];
export const CHANNEL_OPTIONS: QuestionOption[] = [
  { value: "小红书", label: "小红书" },
  { value: "公众号", label: "公众号" },
  { value: "门店朋友圈", label: "门店朋友圈" },
];
export const DELIVERABLE_OPTIONS: QuestionOption[] = [
  { value: "platform_plus_interactive", label: "平台图文 + 互动网页", hint: "网页用于在线浏览与分享" },
  { value: "platform_only", label: "只要平台图文" },
];
export const SCOPE_OPTIONS: QuestionOption[] = [
  { value: "air14", label: "只写 示例本 Air 14" },
  { value: "air16", label: "只写 示例本 Air 16" },
  { value: "compare", label: "两款一起介绍，讲差异" },
];
export const BATTERY_OPTIONS: QuestionOption[] = [
  { value: "omit", label: "先不写续航数值", hint: "推荐：只写有明确依据的内容" },
  { value: "force", label: "仍然写续航数值", hint: "资料冲突未解决，将无法确认制作" },
];

export const DELIVERABLE_LABEL = { platform_only: "平台图文", platform_plus_interactive: "平台图文 + 互动网页" } as const;
export const SCOPE_LABEL = { air14: "示例本 Air 14", air16: "示例本 Air 16", compare: "示例本 Air 14 与 16（对比）" } as const;

const LABELS: Record<RequirementKey, string> = {
  audience: "面向人群",
  problem: "主要问题",
  goal: "营销目标",
  productScope: "产品范围",
  channel: "发布渠道",
  deliverable: "交付形式",
  direction: "核心方向",
  constraints: "限制",
};
export const KEYS = Object.keys(LABELS) as RequirementKey[];

/** 自由文本：一个回答可同时覆盖多个字段。 */
export function parseText(text: string, k: Knowns): void {
  if (/学生|新生|开学|宿舍|大学/.test(text)) k.audience = "大学新生";
  else if (/商务|出差|职场|办公|会议/.test(text)) k.audience = "职场/商务用户";
  else if (/设计|剪辑|摄影|创作/.test(text)) k.audience = "内容创作者";
  if (/小红书/.test(text)) k.channel = "小红书";
  else if (/公众号/.test(text)) k.channel = "公众号";
  else if (/朋友圈/.test(text)) k.channel = "门店朋友圈";
  if (/只要.{0,4}(图文|文案)|不要网页|不需要网页/.test(text)) k.deliverable = "platform_only";
  else if (/互动|网页|html/i.test(text)) k.deliverable = "platform_plus_interactive";
  if (/对比|两款|差异/.test(text)) k.scope = "compare";
  else if (/16/.test(text)) k.scope = "air16";
  else if (/14/.test(text)) k.scope = "air14";
  if (/续航|电池/.test(text)) {
    if (/(仍然|坚持|还是).{0,3}(写|要)/.test(text)) k.battery = "force";
    else if (/(不要|先不|不写|别写)/.test(text)) k.battery = "omit";
  }
  const problems: string[] = [];
  if (/便携|轻|重量|背/.test(text)) problems.push("携带轻便");
  if (/接口|扩展|投屏/.test(text)) problems.push("接口够用");
  if (/续航|电池/.test(text) && k.battery !== "omit") problems.push("一整天续航");
  if (problems.length) k.problem = problems.join("、");
  if (/(不要|别|不提).{0,4}(价格|优惠|补贴)/.test(text)) k.constraints = "不写价格与优惠";
}

function direction(k: Knowns): string {
  const base =
    k.audience === "职场/商务用户"
      ? "以一次出差为线索，讲携带与接口"
      : k.audience === "内容创作者"
        ? "以创作流程为线索，讲屏幕与扩展"
        : "以一天的课表为线索，讲携带与接口";
  return k.battery === "force" ? `${base}，并写入续航` : `${base}（续航数值暂不写）`;
}

interface FieldInfo {
  value: string | null;
  provenance: Provenance;
  basis?: string;
}

export function fieldInfo(key: RequirementKey, k: Knowns): FieldInfo {
  const ov = k.overrides[key];
  if (ov) return { value: ov, provenance: "user_said", basis: "你在摘要中修改" };
  switch (key) {
    case "audience":
      return k.audience ? { value: k.audience, provenance: "user_said", basis: "来自你的描述" } : { value: null, provenance: "pending" };
    case "channel":
      return k.channel ? { value: k.channel, provenance: "user_said", basis: "来自你的描述" } : { value: null, provenance: "pending" };
    case "problem":
      return k.problem
        ? { value: k.problem, provenance: "user_said", basis: "来自你的描述" }
        : { value: "关心携带与日常使用是否顺手", provenance: "system_suggested", basis: "按该人群常见关注点建议，可修改" };
    case "goal":
      return k.audience
        ? { value: `帮${k.audience}判断是否适合作为日常设备`, provenance: "system_suggested", basis: "系统按人群建议" }
        : { value: null, provenance: "pending" };
    case "productScope":
      return k.scope ? { value: SCOPE_LABEL[k.scope], provenance: "user_said", basis: "来自你的选择" } : { value: null, provenance: "pending" };
    case "deliverable":
      return k.deliverable
        ? { value: DELIVERABLE_LABEL[k.deliverable], provenance: "user_said", basis: "来自你的选择" }
        : { value: "平台图文", provenance: "assumed_default", basis: "你没有提到网页，先按平台图文处理" };
    case "direction":
      return k.audience ? { value: direction(k), provenance: "system_suggested", basis: "系统建议，可在摘要里改" } : { value: null, provenance: "pending" };
    case "constraints":
      return k.constraints
        ? { value: k.constraints, provenance: "user_said" }
        : { value: "不写价格与优惠", provenance: "assumed_default", basis: "资料中没有价格依据，默认不写" };
  }
}

export function buildRequirements(k: Knowns): RequirementItem[] {
  return KEYS.map((key) => ({ key, label: LABELS[key], ...fieldInfo(key, k) }));
}

export function buildSummary(sessionId: string, version: number, k: Knowns, prev: RequirementSummary | undefined, at: string): RequirementSummary {
  const fields: SummaryField[] = KEYS.map((key) => {
    const f = fieldInfo(key, k);
    const value = f.value ?? "（未确定）";
    return { key, label: LABELS[key], value, provenance: f.provenance, changed: prev ? prev.fields.find((x) => x.key === key)?.value !== value : false };
  });
  return {
    summaryId: `sum-${sessionId}-${version}`,
    requirementVersion: version,
    status: "pending_confirmation",
    fields,
    defaults: fields.filter((f) => f.provenance === "assumed_default").map((f) => `${f.label}：${f.value}`),
    limitations: [
      "只使用资料库中有依据的产品事实，并带上限制条件",
      k.battery === "force" ? "续航数值存在冲突，写入前需先核实" : "续航数值先不写入",
    ],
    blockers: k.battery === "force" ? ["续航资料有两个来源且数值冲突，未核实前不能开始制作"] : [],
    affected: prev ? fields.filter((f) => f.changed).map((f) => f.label) : undefined,
    createdAt: at,
  };
}

export function candidatesFor(k: Knowns): CandidateProduct[] {
  const c14: CandidateProduct = {
    candidateId: "mock-air-14",
    model: "【MOCK】示例本 Air 14",
    origin: "mock",
    fit: "更轻，适合每天背着走",
    evidence: [
      { claim: "重量约 1.2 kg", status: "supported", qualifiers: ["实际重量因配置而异"], sourceTitle: "【MOCK】mock-air-14 规格", origin: "mock" },
      { claim: "2 个 Type-C、1 个 HDMI", status: "supported", qualifiers: [], sourceTitle: "【MOCK】mock-air-14 规格", origin: "mock" },
      { claim: "续航", status: "conflict", qualifiers: ["两个来源数值不同（10 / 14 小时）"], sourceTitle: "【MOCK】mock-air-14 规格 / 另一来源", origin: "mock" },
    ],
    unknowns: ["价格（资料未提供）"],
    differences: ["比 16 寸版更轻"],
  };
  const c16: CandidateProduct = {
    candidateId: "mock-air-16",
    model: "【MOCK】示例本 Air 16",
    origin: "mock",
    fit: "屏幕更大，携带负担更高",
    evidence: [
      { claim: "重量约 1.7 kg", status: "supported", qualifiers: [], sourceTitle: "【MOCK】mock-air-16 规格", origin: "mock" },
      { claim: "接口", status: "unknown", qualifiers: ["资料未提供，不能视为与 14 寸相同"], origin: "mock" },
      { claim: "续航", status: "unknown", qualifiers: ["资料未提供"], origin: "mock" },
    ],
    unknowns: ["接口", "续航", "价格"],
    differences: ["屏幕更大", "更重"],
  };
  if (k.scope === "air14") return [c14];
  if (k.scope === "air16") return [c16];
  return [c14, c16];
}

export function gapsFor(k: Knowns): MaterialGap[] {
  const gaps: MaterialGap[] = [
    {
      gapId: "gap-battery",
      text: "示例本 Air 14 的续航有两个来源，数值不一致",
      impact: "无法确定应写 10 还是 14 小时",
      handling: k.battery === "force" ? "blocking" : k.battery === "omit" ? "default_applied" : "needs_decision",
      note: k.battery === "omit" ? "已按你的选择不写续航数值" : undefined,
    },
    { gapId: "gap-price", text: "没有价格资料", impact: "不会写入任何价格或优惠", handling: "default_applied" },
  ];
  if (k.scope === "air16" || k.scope === "compare") {
    gaps.push({
      gapId: "gap-air16",
      text: "示例本 Air 16 缺少接口与续航资料，且只有 1 张图片",
      impact: "Air 16 的这部分只能标为未知，配图少于平台建议数量",
      handling: "default_applied",
    });
  }
  return gaps;
}
