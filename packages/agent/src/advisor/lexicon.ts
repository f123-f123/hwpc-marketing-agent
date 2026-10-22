/**
 * 选购需求的词表：用户原话 → 需求编辑（NeedEdit），需求条目 → 结构化意图（Wants）。
 *
 * 抽取只记录用户说过的话：每条 known 编辑都带用户原话片段（quote），服务端会再核一遍。
 * Wants 从“当前需求条目”推出，而不是从聊天记录推出，所以用户在摘要里直接改的内容同样生效。
 */
import type { NeedEdit, NeedEntry, NeedKey } from "@hwpc/contracts";

export type TaskTag = "travel" | "office" | "study" | "video" | "design" | "draw" | "code" | "game" | "media" | "family";

export const TASKS: { tag: TaskTag; re: RegExp; value: string }[] = [
  { tag: "travel", re: /出差|差旅|通勤|移动办公|外出办公|带着跑|经常带出门|带出门|高铁上|飞机上|跑客户/, value: "出差、通勤时带着用" },
  { tag: "office", re: /办公|写文档|做表格|做\s*PPT|PPT|Excel|Word|报表|开会|视频会议|邮件|文员|行政/i, value: "日常办公：文档、表格、会议" },
  { tag: "study", re: /上课|网课|学习|学生|大学|考研|论文|作业|宿舍|开学/, value: "学习：网课、作业、论文" },
  { tag: "video", re: /剪视频|剪辑|做视频|视频制作|vlog|Premiere|达芬奇|剪映|调色|拍视频/i, value: "剪辑视频" },
  { tag: "design", re: /修图|设计|Photoshop|Lightroom|插画|平面|UI\s*设计|C4D|建模|渲染|Blender|摄影后期/i, value: "设计、修图" },
  { tag: "draw", re: /手写|手绘|画画|记笔记|批注|手写笔|触控笔/, value: "手写笔记、绘画" },
  { tag: "code", re: /编程|写代码|敲代码|开发|程序员|Python|Java|IDE|代码/i, value: "写代码、开发" },
  { tag: "game", re: /游戏|打游戏|电竞|Steam|原神|黑神话|英雄联盟|LOL/i, value: "玩游戏" },
  { tag: "media", re: /追剧|看电影|看视频|影音|听歌|看剧/, value: "影音娱乐" },
  { tag: "family", re: /家用|家里人|孩子|老人|全家|家庭/, value: "家庭共用" },
];

/** 在鸿蒙电脑上需要先按厂商说明核对的软件（大多依赖 Windows 生态）。 */
export const SOFTWARE: { name: string; re: RegExp; heavy: boolean }[] = [
  { name: "Photoshop", re: /Photoshop|\bPS\b/i, heavy: true },
  { name: "Premiere", re: /Premiere|\bPR\b/i, heavy: true },
  { name: "After Effects", re: /After\s*Effects|\bAE\b/i, heavy: true },
  { name: "Illustrator", re: /Illustrator|\bAI\s*软件/i, heavy: true },
  { name: "Lightroom", re: /Lightroom|\bLR\b/i, heavy: true },
  { name: "达芬奇", re: /达芬奇|DaVinci/i, heavy: true },
  { name: "剪映", re: /剪映/, heavy: false },
  { name: "AutoCAD", re: /AutoCAD|\bCAD\b/i, heavy: true },
  { name: "SolidWorks", re: /SolidWorks/i, heavy: true },
  { name: "3ds Max", re: /3ds\s*Max|3DMax/i, heavy: true },
  { name: "Blender", re: /Blender/i, heavy: true },
  { name: "C4D", re: /C4D|Cinema\s*4D/i, heavy: true },
  { name: "MATLAB", re: /MATLAB/i, heavy: true },
  { name: "SPSS", re: /SPSS/i, heavy: false },
  { name: "Visual Studio", re: /Visual\s*Studio(?!\s*Code)/i, heavy: true },
  { name: "VS Code", re: /VS\s*Code|VSCode/i, heavy: false },
  { name: "Steam 游戏", re: /Steam/i, heavy: true },
  { name: "Office", re: /Office|Word|Excel|PowerPoint/i, heavy: false },
  { name: "WPS", re: /WPS/i, heavy: false },
  { name: "腾讯会议", re: /腾讯会议/, heavy: false },
  { name: "钉钉", re: /钉钉/, heavy: false },
  { name: "飞书", re: /飞书/, heavy: false },
  { name: "企业微信", re: /企业微信/, heavy: false },
];

interface Pref {
  re: RegExp;
  value: string;
}

const PREFERENCES: Pref[] = [
  { re: /轻薄|轻一点|轻便|便携|分量轻|不要太重|别太重|太重/, value: "希望轻便好带" },
  { re: /大屏|屏幕大|16\s*(?:寸|英寸)|大一点的屏/, value: "希望大屏（16 英寸左右）" },
  { re: /小巧|13\s*(?:寸|英寸)|14\s*(?:寸|英寸)|小一点/, value: "希望 14 英寸左右的小尺寸" },
  { re: /好屏|屏幕好|OLED|色彩|色准|护眼|高刷|屏幕素质/i, value: "看重屏幕显示效果" },
  { re: /续航|电池|不用带充电器|一天不插电/, value: "看重续航" },
  { re: /性能|流畅|不卡|速度快|多开/, value: "看重性能" },
  { re: /触屏|触控屏|触摸屏/, value: "希望支持触屏" },
  { re: /HDMI|USB-?A|接口多|接口齐|原生接口|投影/i, value: "希望接口齐全（HDMI、USB-A）" },
  { re: /颜值|好看|配色|外观/, value: "在意外观配色" },
  { re: /折叠/, value: "对折叠屏感兴趣" },
  { re: /防窥|隐私/, value: "需要防窥、隐私保护" },
  { re: /鸿蒙|HarmonyOS/i, value: "倾向鸿蒙系统" },
  { re: /Windows|win1[01]|微软系统/i, value: "需要 Windows 系统" },
];

/* ------------------------------ 预算 ------------------------------ */

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 预算原话 → 上限（元）。识别“6000”“6k”“六千”“五六千”“1.2万”“5000-7000”。 */
export function parseBudget(text: string): { max?: number; min?: number; quote: string } | undefined {
  const range = text.match(/(\d{4,5})\s*(?:-|~|～|到|至)\s*(\d{4,5})\s*(?:元|块)?/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b), quote: range[0] };
  }
  const cn = text.match(/([一二两三四五六七八九])([一二三四五六七八九])?\s*(千|万)\s*(?:块|元)?\s*(以内|以下|左右|上下|出头|多)?/);
  if (cn && /预算|以内|以下|左右|上下|块|元|价位|价格|出头|多/.test(text)) {
    const unit = cn[3] === "万" ? 10000 : 1000;
    const hi = CN_DIGIT[cn[2] ?? cn[1]!]! * unit;
    return { max: cn[4] === "出头" || cn[4] === "多" ? Math.round(hi * 1.15) : hi, quote: cn[0] };
  }
  const num =
    text.match(/(?:预算|价位|价格|控制在|不超过)[^\d]{0,4}(\d+(?:\.\d+)?)\s*(万|千|k|K|元|块)?/) ??
    text.match(/(\d+(?:\.\d+)?)\s*(万|千|k|K|元|块)\s*(?:以内|以下|左右|上下|出头)?/);
  if (num) {
    const unit = num[2];
    const n = Number(num[1]) * (unit === "万" ? 10000 : unit === "千" || unit === "k" || unit === "K" ? 1000 : 1);
    if (n >= 1000 && n <= 60000) return { max: Math.round(n), quote: num[0] };
  }
  if (/预算不限|不差钱|价格无所谓|钱不是问题/.test(text)) return { quote: text.match(/预算不限|不差钱|价格无所谓|钱不是问题/)![0] };
  return undefined;
}

/* ------------------------------ 抽取 ------------------------------ */

const set = (key: NeedKey, value: string, quote: string, structured?: Record<string, number | string>): NeedEdit => ({
  op: "set",
  key,
  value,
  status: "known",
  quote,
  ...(structured ? { structured } : {}),
});

const clause = /[^，。,.；;！!？?\n]/.source;

/** 从一句话里抽出需求编辑。同一句可以命中多个维度。 */
export function extractEdits(text: string): NeedEdit[] {
  const out: NeedEdit[] = [];
  const t = text.trim();
  if (!t) return out;

  for (const task of TASKS) {
    const m = t.match(task.re);
    if (m) out.push(set("task", task.value, m[0]));
  }

  const budget = parseBudget(t);
  if (budget) {
    const value = budget.max ? (budget.min ? `预算 ${budget.min}–${budget.max} 元` : `预算 ${budget.max} 元以内`) : "预算不限";
    out.push(set("budget", value, budget.quote, budget.max ? { max: budget.max, ...(budget.min ? { min: budget.min } : {}), currency: "CNY" } : { open: "true" }));
  }

  // 重量上限：“不超过 1.3kg”“别超过三斤”
  const w = t.match(/(?:不能|不要|别|不)?(?:超过|高于|重于)\s*(\d+(?:\.\d+)?)\s*(kg|KG|公斤|千克|斤)/);
  if (w) {
    const kg = Number(w[1]) / (w[2] === "斤" ? 2 : 1);
    out.push(set("hardConstraints", `重量不超过 ${kg} kg`, w[0], { maxKg: kg }));
  }

  // 其他硬条件：“必须……”“一定要……”“不接受……”
  for (const m of t.matchAll(new RegExp(`(?:必须|一定要|只考虑|只要)(${clause}{1,16})`, "g"))) {
    const v = m[1]!.replace(/^(是|有|用|支持)/, (x) => x).trim();
    if (v && !(w && m[0].includes(w[0]))) out.push(set("hardConstraints", `必须${v}`, m[0]));
  }
  for (const m of t.matchAll(new RegExp(`(?:不接受|不考虑|不能要)(${clause}{1,16})`, "g"))) {
    out.push(set("hardConstraints", `不接受${m[1]!.trim()}`, m[0]));
  }

  const soft = SOFTWARE.filter((s) => s.re.test(t));
  if (soft.length) {
    const first = t.match(soft[0]!.re)![0];
    out.push(set("requiredSoftware", `需要使用：${soft.map((s) => s.name).join("、")}`, first));
  }

  const dev = t.match(/(?:我有|我用|在用|手上有|手里有|手头有|已经有|现在用|家里有)([^，。,.；;！!？?]{0,10}?)(华为|荣耀|苹果|iPhone|iPad|小米|OPPO|vivo|Mate\s?\d*|Pura\s?\d*|nova|MatePad|显示器|平板|手机)([^，。,.；;！!？?]{0,6})/i);
  if (dev) out.push(set("existingDevices", `已有${`${dev[1] ?? ""}${dev[2] ?? ""}${dev[3] ?? ""}`.trim()}`, dev[0]));

  const env = t.match(/(每天|每周|经常|偶尔|一个月|一周)([^，。,.；;]{0,6}?)(出差|通勤|带出门|外出|飞)/) ?? t.match(/(?:在|常在)(宿舍|图书馆|咖啡馆|办公室|家里|会议室|户外|教室)/);
  if (env) out.push(set("environment", env[0].startsWith("在") || env[0].startsWith("常") ? `常${env[0].replace(/^常/, "")}使用` : env[0], env[0]));

  for (const p of PREFERENCES) {
    const m = t.match(p.re);
    if (m && !out.some((e) => e.op === "set" && e.key === "hardConstraints" && e.quote?.includes(m[0]))) out.push(set("preferences", p.value, m[0]));
  }

  for (const m of t.matchAll(new RegExp(`(?:担心|怕|顾虑|不放心|就怕)(${clause}{1,20})`, "g"))) {
    out.push(set("concerns", `担心${m[1]!.trim()}`, m[0]));
  }
  return dedupe(out);
}

function dedupe(edits: NeedEdit[]): NeedEdit[] {
  const seen = new Set<string>();
  return edits.filter((e) => {
    if (e.op !== "set") return true;
    const k = `${e.key}|${e.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 回答“没想好 / 都行”。 */
export const NO_PREFERENCE = /^(不确定|没想好|都行|都可以|无所谓|随便|不知道|看情况|没有|没|无)[。.!！]?$/;

/* ------------------------------ 需求条目 → 意图 ------------------------------ */

export interface Wants {
  tasks: Map<TaskTag, string>;
  budget?: { max?: number; min?: number; entryId: string };
  weight?: { maxKg?: number; hard: boolean; entryId: string };
  screen?: { size: "compact" | "large"; hard: boolean; entryId: string };
  os?: { want: "harmony" | "windows"; hard: boolean; entryId: string };
  software?: { names: string[]; heavy: boolean; entryId: string };
  ports?: { entryId: string; hard: boolean };
  display?: string;
  battery?: string;
  performance?: string;
  touch?: string;
  pen?: string;
  privacy?: string;
  fold?: string;
  looks?: string;
  huaweiPhone?: string;
  otherPhone?: string;
  monitor?: string;
  concerns: NeedEntry[];
  /** 读不懂的硬条件：只能列为“待核实”，不能当作已满足。 */
  hardOther: NeedEntry[];
}

export function wantsOf(entries: NeedEntry[]): Wants {
  const w: Wants = { tasks: new Map(), concerns: [], hardOther: [] };
  for (const e of entries) {
    const v = e.value;
    const hard = e.key === "hardConstraints" || e.hard;
    switch (e.key) {
      case "task":
        for (const t of TASKS) if (t.re.test(v) || t.value === v) w.tasks.set(t.tag, e.entryId);
        break;
      case "environment":
        if (/出差|通勤|带出门|外出|飞/.test(v)) w.tasks.set("travel", w.tasks.get("travel") ?? e.entryId);
        break;
      case "budget": {
        const max = typeof e.structured?.max === "number" ? e.structured.max : parseBudget(v)?.max;
        const min = typeof e.structured?.min === "number" ? e.structured.min : parseBudget(v)?.min;
        if (max) w.budget = { max, ...(min ? { min } : {}), entryId: e.entryId };
        break;
      }
      case "requiredSoftware": {
        const names = SOFTWARE.filter((s) => s.re.test(v)).map((s) => s.name);
        const list = names.length ? names : [v.replace(/^需要使用[:：]?/, "").trim()].filter(Boolean);
        if (list.length) w.software = { names: list, heavy: SOFTWARE.some((s) => s.heavy && s.re.test(v)) || !names.length, entryId: e.entryId };
        break;
      }
      case "existingDevices":
        if (/华为|Mate|Pura|nova|MatePad|鸿蒙/i.test(v)) w.huaweiPhone = e.entryId;
        else if (/苹果|iPhone|iPad|小米|OPPO|vivo|荣耀/i.test(v)) w.otherPhone = e.entryId;
        if (/显示器/.test(v)) w.monitor = e.entryId;
        break;
      case "concerns":
        w.concerns.push(e);
        break;
      default:
        break;
    }
    // 偏好与硬条件共享一套识别；硬条件优先。
    if (e.key === "preferences" || e.key === "hardConstraints") {
      let understood = false;
      const kg = typeof e.structured?.maxKg === "number" ? e.structured.maxKg : Number(v.match(/(\d+(?:\.\d+)?)\s*kg/i)?.[1]) || undefined;
      if (kg || /轻|便携|好带|重/.test(v)) {
        if (!w.weight || hard) w.weight = { ...(kg ? { maxKg: kg } : {}), hard, entryId: e.entryId };
        understood = true;
      }
      if (/大屏|16\s*英寸|16\s*寸/.test(v)) (w.screen = { size: "large", hard, entryId: e.entryId }), (understood = true);
      else if (/小尺寸|14\s*英寸|14\s*寸|13\s*寸|小巧/.test(v)) (w.screen = { size: "compact", hard, entryId: e.entryId }), (understood = true);
      if (/鸿蒙|HarmonyOS/i.test(v)) (w.os = { want: "harmony", hard, entryId: e.entryId }), (understood = true);
      else if (/Windows|win/i.test(v)) (w.os = { want: "windows", hard, entryId: e.entryId }), (understood = true);
      if (/接口|HDMI|USB-?A/i.test(v)) (w.ports = { entryId: e.entryId, hard }), (understood = true);
      if (/屏幕显示|OLED|色彩|护眼|高刷/i.test(v)) (w.display = e.entryId), (understood = true);
      if (/续航|电池/.test(v)) (w.battery = e.entryId), (understood = true);
      if (/性能/.test(v)) (w.performance = e.entryId), (understood = true);
      if (/触屏|触控|触摸/.test(v)) (w.touch = e.entryId), (understood = true);
      if (/手写笔|触控笔|M-?Pen/i.test(v)) (w.pen = e.entryId), (understood = true);
      if (/防窥|隐私/.test(v)) (w.privacy = e.entryId), (understood = true);
      if (/折叠/.test(v)) (w.fold = e.entryId), (understood = true);
      if (/外观|配色|颜值/.test(v)) (w.looks = e.entryId), (understood = true);
      if (hard && !understood) w.hardOther.push(e);
    }
  }
  if (w.tasks.has("draw") && !w.pen) w.pen = w.tasks.get("draw");
  return w;
}

export const TASK_LABEL: Record<TaskTag, string> = Object.fromEntries(TASKS.map((t) => [t.tag, t.value])) as Record<TaskTag, string>;
