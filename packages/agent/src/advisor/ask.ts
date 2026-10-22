/**
 * 动态追问：问哪一项，取决于“当前候选在哪个维度上分歧最大”。
 *
 * 例如候选里鸿蒙版和 Windows 版都有，就先问必须用的软件；价格从 4000 多到 1 万多，就问预算；
 * 重量差得多，就问多久带出门。选项也按真实候选的价格、重量、尺寸生成，理由里写明依据。
 * 已经知道的不问，已经在问的不重复问，一轮最多两个问题。
 */
import type { AdvisorView, NeedKey, QuestionProposal } from "@hwpc/contracts";
import type { Assessed } from "./assess.js";
import type { Wants } from "./lexicon.js";
import { fmtKg } from "./profile.js";

const shortName = (m: string) => m.replace(/^HUAWEI\s+/i, "").replace(/（.*?）/g, "").trim();

interface Ask {
  q: QuestionProposal;
  /** 越大越先问。 */
  gain: number;
}

export function nextQuestions(w: Wants, ranked: Assessed[], view: Pick<AdvisorView, "openQuestions" | "recentMessages" | "entries">, max = 2): QuestionProposal[] {
  const pool = ranked.filter((a) => a.assessment.overall !== "not_fit").slice(0, 6);
  const live = pool.length ? pool : ranked.slice(0, 6);
  const asks: Ask[] = [];
  const has = (k: NeedKey) => view.entries.some((e) => e.key === k);

  if (w.tasks.size === 0) {
    asks.push({
      gain: 100,
      q: {
        kind: "clarify",
        prompt: "你主要会用它做什么？",
        reason: `知识库里有 ${ranked.length} 款华为笔记本，用途决定先看重量、屏幕还是软件。`,
        targetKeys: ["task"],
        options: [
          { value: "经常出差，带着办公", label: "出差办公" },
          { value: "上网课、写作业和论文", label: "学习" },
          { value: "剪视频、修图", label: "剪视频修图" },
          { value: "写代码", label: "写代码" },
          { value: "手写笔记、画画", label: "手写绘画" },
          { value: "家用，追剧上网", label: "家用影音" },
        ],
        allowFreeText: true,
      },
    });
  }

  // 预算：候选价差大才问，选项按真实价格分段
  const priced = (w.tasks.size ? live : ranked).filter((a) => a.profile.price).map((a) => ({ name: shortName(a.profile.product.model), from: a.profile.price!.from }));
  if (!w.budget && !has("budget") && priced.length >= 2) {
    const sorted = [...priced].sort((a, b) => a.from - b.from);
    const lo = sorted[0]!.from;
    const hi = sorted.at(-1)!.from;
    if (hi - lo >= 1500) {
      // 按候选价格的三分位取整到千元，每一档都对应真实存在的型号
      const at = (r: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * r))]!.from;
      const cut1 = Math.ceil(at(1 / 3) / 1000) * 1000;
      const cut2 = Math.max(cut1 + 1000, Math.ceil(at(2 / 3) / 1000) * 1000);
      const within = (n: number) => sorted.filter((s) => s.from <= n).map((s) => s.name);
      const opt = (n: number) => ({ value: `预算 ${n} 元以内`, label: `${n} 元以内${within(n).length ? `（${within(n).slice(0, 2).join("、")}${within(n).length > 2 ? " 等" : ""}）` : ""}` });
      asks.push({
        gain: 8 + (hi - lo) / 2000,
        q: {
          kind: "preference",
          prompt: "预算大概多少？",
          reason: `现在的候选在官方价格快照里从 ${lo} 元到 ${hi} 元不等，预算会直接改变候选。`,
          targetKeys: ["budget"],
          options: [opt(cut1), opt(cut2), { value: "预算不限", label: "看合适的，预算不限" }],
          allowFreeText: true,
        },
      });
    }
  }

  // 系统路线：候选里既有鸿蒙也有 Windows，且还没说过软件或系统
  const harmony = live.filter((a) => a.profile.os.has("harmony") && !a.profile.os.has("windows"));
  const windows = live.filter((a) => a.profile.os.has("windows"));
  if (!w.software && !w.os && !has("requiredSoftware") && harmony.length && windows.length) {
    asks.push({
      gain: 7 + Math.min(harmony.length, windows.length),
      q: {
        kind: "preference",
        prompt: "有没有离不开的软件？",
        reason: `候选里有鸿蒙版（${harmony.slice(0, 2).map((a) => shortName(a.profile.product.model)).join("、")}）也有 Windows 版（${windows.slice(0, 2).map((a) => shortName(a.profile.product.model)).join("、")}），必须用的软件决定走哪条系统路线。`,
        targetKeys: ["requiredSoftware"],
        options: [
          { value: "只用 Office、WPS 和浏览器", label: "办公软件和浏览器就够" },
          { value: "需要使用 Photoshop、Premiere", label: "Adobe 等创作软件" },
          { value: "要用 AutoCAD、MATLAB 这类专业软件", label: "CAD / 专业软件" },
          { value: "要玩 Steam 游戏", label: "玩游戏" },
          { value: "倾向鸿蒙系统", label: "想用鸿蒙" },
        ],
        allowFreeText: true,
      },
    });
  }

  // 便携：候选重量差距大，且没说过带不带出门
  const weighed = live.filter((a) => a.profile.weightKg);
  if (!w.weight && !w.tasks.has("travel") && !has("environment") && weighed.length >= 2) {
    const kgs = weighed.map((a) => a.profile.weightKg!.max);
    const light = weighed.reduce((a, b) => (b.profile.weightKg!.min < a.profile.weightKg!.min ? b : a));
    const heavy = weighed.reduce((a, b) => (b.profile.weightKg!.max > a.profile.weightKg!.max ? b : a));
    if (Math.max(...kgs) - Math.min(...kgs) >= 0.3) {
      asks.push({
        gain: 6 + (Math.max(...kgs) - Math.min(...kgs)) * 4,
        q: {
          kind: "preference",
          prompt: "平时多久带它出门一次？",
          reason: `候选从 ${fmtKg(light.profile.weightKg!.min)}（${shortName(light.profile.product.model)}）到 ${fmtKg(heavy.profile.weightKg!.max)}（${shortName(heavy.profile.product.model)}），常带出门的话重量差别很明显。`,
          targetKeys: ["environment"],
          options: [
            { value: "每天通勤带着", label: "每天带" },
            { value: "每周出差带出门", label: "每周出差" },
            { value: "偶尔带出门", label: "偶尔带" },
            { value: "基本放在家里或办公室", label: "基本不带" },
          ],
          allowFreeText: true,
        },
      });
    }
  }

  // 屏幕尺寸：14 与 16 英寸都有
  const sized = live.filter((a) => a.profile.screenIn && !a.profile.foldable);
  const big = sized.filter((a) => a.profile.screenIn!.value >= 15.5);
  if (!w.screen && big.length && big.length < sized.length) {
    asks.push({
      gain: 4,
      q: {
        kind: "preference",
        prompt: "屏幕想要多大？",
        reason: `候选里 ${big.map((a) => shortName(a.profile.product.model)).slice(0, 2).join("、")} 是 16 英寸，其余在 14 英寸左右，尺寸也决定了重量。`,
        targetKeys: ["preferences"],
        options: [
          { value: "希望 14 英寸左右的小尺寸", label: "14 英寸，方便带" },
          { value: "希望大屏（16 英寸左右）", label: "16 英寸大屏" },
        ],
        allowFreeText: true,
      },
    });
  }

  // 已有设备：候选里有支持跨设备协同的鸿蒙机
  if (!w.huaweiPhone && !w.otherPhone && !has("existingDevices") && live.some((a) => a.profile.collab)) {
    asks.push({
      gain: 3,
      q: {
        kind: "preference",
        prompt: "手上有华为手机或平板吗？",
        reason: `${live.filter((a) => a.profile.collab).slice(0, 2).map((a) => shortName(a.profile.product.model)).join("、")} 的特色应用里列有跨设备协同，已有设备会影响能不能用上。`,
        targetKeys: ["existingDevices"],
        options: [
          { value: "我有华为手机", label: "有华为手机" },
          { value: "我用苹果手机", label: "用苹果" },
          { value: "我用其他品牌手机", label: "其他品牌" },
        ],
        allowFreeText: true,
      },
    });
  }

  // 接口：办公、上课常接投影或 U 盘，候选接口差异大
  const withPorts = live.filter((a) => a.profile.portFacts.length);
  if (!w.ports && (w.tasks.has("office") || w.tasks.has("study")) && withPorts.some((a) => a.profile.hdmi) && withPorts.some((a) => !a.profile.hdmi)) {
    asks.push({
      gain: 2.5,
      q: {
        kind: "preference",
        prompt: "会经常接投影、显示器或 U 盘吗？",
        reason: `${withPorts.filter((a) => !a.profile.hdmi).slice(0, 2).map((a) => shortName(a.profile.product.model)).join("、")} 只有 USB-C，接 HDMI / USB-A 设备要带转接头。`,
        targetKeys: ["preferences"],
        options: [
          { value: "希望接口齐全（HDMI、USB-A）", label: "经常接，要原生接口" },
          { value: "带个转接头可以接受", label: "转接头也行" },
        ],
        allowFreeText: true,
      },
    });
  }

  const asking = new Set(view.openQuestions.flatMap((q) => q.targetKeys));
  const askedTwice = (prompt: string) => view.recentMessages.filter((m) => m.role === "advisor" && m.text.includes(prompt)).length >= 2;
  return asks
    .filter((a) => !a.q.targetKeys.some((k) => asking.has(k)) && !askedTwice(a.q.prompt))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, max)
    .map((a) => a.q);
}
