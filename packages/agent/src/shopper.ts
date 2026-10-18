/**
 * 选购需求抽取：任务、环境、频率、预算、已有设备、必要软件、硬条件、不可接受项、技术疑问、顾虑。
 * 按相关性从自由表达里取，不是问卷。规则型，可测试；模型只做补充（见 understand.ts）。
 */
import {
  CONCERN_CUE,
  DEVICE_WORDS,
  ENV_PATTERNS,
  EXISTING_CUE,
  FREQUENCY_RE,
  HARD_CUE,
  METRIC_DEFS,
  MARKETING_OUTPUT_RE,
  PREFERENCE_CUE,
  REPORT_OUTPUT_RE,
  SOFTWARE_NAMES,
  TASK_PATTERNS,
  TECH_QUESTION_CUE,
  TECH_TERMS,
  UNACCEPTABLE_CUE,
} from "./lexicon.js";
import type { ReqKey } from "./keys.js";

export interface ShopperSet {
  key: ReqKey;
  value: string;
  explicit: boolean;
}

export const NONE_RE = /^[\s，。]*(没有|没|无|不用|不需要|没什么|没特别|暂时没有|暂无|不限|都可以|无所谓)/;
export const isNoneValue = (v: string | undefined) => !v || v.trim() === "无";

const CLAUSE_SPLIT = /[，,。；;！!？?\n、]/;
const clauses = (t: string) => t.split(CLAUSE_SPLIT).map((x) => x.trim()).filter(Boolean);

const BRAND = "(?:华为|荣耀|小米|苹果|OPPO|vivo|三星)?";
const DEVICE_CAPTURE = new RegExp(`(${BRAND}\\s*(?:手机|平板|显示器|打印机|耳机|手表|iPhone\\s*\\d*|MatePad\\s*\\w*|鼠标|键盘|台式机|旧电脑|旧笔记本))`, "gi");

/** 一条子句里是否含可核对的数值条件。 */
export const hasMetric = (c: string) => METRIC_DEFS.some((d) => d.unit.test(c));

export function extractShopper(text: string, opts: { targetKeys?: ReqKey[] } = {}): { sets: ShopperSet[]; removeDevices: string[]; outputKind?: "marketing_article" | "report" } {
  const sets: ShopperSet[] = [];
  const t = text.trim();
  const push = (key: ReqKey, value: string, explicit = false) => {
    if (value.trim()) sets.push({ key, value: value.trim(), explicit });
  };
  const cs = clauses(t);

  // 任务
  for (const p of TASK_PATTERNS) if (p.re.test(t)) push("tasks", p.label);

  // 环境 / 频率
  for (const e of ENV_PATTERNS) if (e.re.test(t)) push("environment", e.label);
  const fm = t.match(FREQUENCY_RE);
  if (fm && /用|办公|上课|写|剪|开会|出差|带/.test(t)) push("frequency", fm[0].trim());

  // 预算
  const bm = t.match(/预算[^，。；\d]{0,6}(\d+(?:\.\d+)?)\s*(万|k|K|千|元|块)?([^，。；]{0,4})/) ?? t.match(/(\d+(?:\.\d+)?)\s*(万|k|K|千|元|块)\s*(?:以内|以下|左右|上下|封顶)/);
  if (bm) {
    const unit = bm[2] ?? "元";
    const n = Number(bm[1]);
    const yuan = unit === "万" ? n * 10000 : unit === "千" || /k/i.test(unit) ? n * 1000 : n;
    const tail = /以内|以下|封顶|不超过/.test(t) ? "以内" : /左右|上下/.test(t) ? "左右" : "";
    if (yuan >= 500) push("budget", `${yuan}元${tail}`, true);
  }

  // 已有设备
  for (const c of cs) {
    if (EXISTING_CUE.test(c) || /已有|手上/.test(c)) {
      for (const m of c.matchAll(DEVICE_CAPTURE)) push("existingDevices", m[1]!.replace(/\s+/g, ""));
    }
  }
  if (!sets.some((x) => x.key === "existingDevices") && opts.targetKeys?.includes("existingDevices") && DEVICE_WORDS.test(t)) {
    for (const m of t.matchAll(DEVICE_CAPTURE)) push("existingDevices", m[1]!.replace(/\s+/g, ""), true);
  }
  const removeDevices: string[] = [];
  for (const m of t.matchAll(/没有(?:华为|荣耀|小米|苹果)?(手机|平板|显示器|打印机|耳机|手表)/g)) removeDevices.push(m[1]!);

  // 必要软件
  for (const name of SOFTWARE_NAMES) {
    const re = new RegExp(`(?:必须|一定|得|需要|离不开|常用|会用|用到|要跑|要装|要用)[^，。；]{0,8}${name}`, "i");
    if (re.test(t) || (opts.targetKeys?.includes("requiredSoftware") && new RegExp(name, "i").test(t))) push("requiredSoftware", name, true);
  }

  // 硬条件 / 不可接受 / 偏好 / 顾虑
  for (const c of cs) {
    const isSoftwareOnly = SOFTWARE_NAMES.some((n) => new RegExp(n, "i").test(c)) && !hasMetric(c);
    if (UNACCEPTABLE_CUE.test(c) && c.length <= 30) {
      push("unacceptable", c, true);
      continue;
    }
    if ((HARD_CUE.test(c) || /以内|不超过|不低于/.test(c)) && hasMetric(c) && !/预算/.test(c)) {
      push("hardConstraints", c, true);
      continue;
    }
    if (HARD_CUE.test(c) && !isSoftwareOnly && c.length <= 26 && !/预算|写|生成|海报|文案/.test(c)) {
      // 有“必须”但没有数值：保留原话，评估时会提示需要一个具体标准
      push("hardConstraints", c, true);
      continue;
    }
    if (CONCERN_CUE.test(c) && c.length <= 40) {
      push("concerns", c);
      continue;
    }
    if (PREFERENCE_CUE.test(c) && c.length <= 30 && !/软文|文案|写|图文|公众号|小红书|朋友圈|海报/.test(c)) push("preferences", c);
  }

  // 技术疑问
  for (const tech of TECH_TERMS) {
    if (tech.re.test(t) && (TECH_QUESTION_CUE.test(t) || /了解|看看|演示|体验/.test(t))) push("techQuestions", tech.label);
  }

  let outputKind: "marketing_article" | "report" | undefined;
  if (MARKETING_OUTPUT_RE.test(t)) outputKind = "marketing_article";
  else if (REPORT_OUTPUT_RE.test(t)) outputKind = "report";
  return { sets, removeDevices, outputKind };
}
