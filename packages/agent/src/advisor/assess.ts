/**
 * 候选筛选：拿当前需求逐条对照每个型号的知识库画像。
 *
 * 规则（与契约 CandidateAssessmentSchema 一致）：
 * - “满足 / 取舍”必须挂着知识库证据（事实原文、官方价格记录、型号检索卡原句）；
 * - 资料里没有、或只有待核事实的，一律放进“待核实”，不当作满足；
 * - 硬条件不满足 → 不合适；预算明显超出 → 不合适。
 * 排序只看规则分数，模型不参与，保证同样的需求得到同样的候选。
 */
import type { CandidateAssessment, Criterion, EvidenceRef, LibraryHit, NeedEntry } from "@hwpc/contracts";
import { TASK_LABEL, wantsOf, type TaskTag, type Wants } from "./lexicon.js";
import { briefEvidence, factEvidence, fmtKg, priceEvidence, type ProductProfile } from "./profile.js";

export interface Assessed {
  assessment: CandidateAssessment;
  profile: ProductProfile;
  score: number;
}

export interface AssessContext {
  needVersion: number;
  rejected: string[];
  /** 软件兼容等通用提醒的知识库出处（P7 常见问题），作为“待核实”的依据展示。 */
  softwareFaq?: LibraryHit;
  origin: "local" | "ima" | "mock";
}

const hitEvidence = (h: LibraryHit): EvidenceRef => ({ source: h.source, excerpt: h.excerpt.slice(0, 500) });

/** 型号检索卡里与任务相关的句子。 */
const TASK_WORDS: Record<TaskTag, RegExp> = {
  travel: /差旅|出差|移动|便携|通勤|携带/,
  office: /办公|文档|会议|行政|商务/,
  study: /学生|学习|课程|网课/,
  video: /视频|剪辑|创作|色彩|影像/,
  design: /设计|色彩|创作|修图|图形/,
  draw: /手写|手绘|笔|绘/,
  code: /开发|编程|代码|工程/,
  game: /游戏|图形性能|独显/,
  media: /影音|娱乐|观影|音频/,
  family: /家庭|家用|共用/,
};

export function assessAll(entries: NeedEntry[], profiles: ProductProfile[], ctx: AssessContext): Assessed[] {
  const w = wantsOf(entries);
  return profiles
    .map((p) => assessOne(w, p, ctx))
    .sort((a, b) => b.score - a.score)
    .map((a, _i, all) => {
      const others = all.filter((o) => o !== a).slice(0, 2);
      a.assessment.comparedWith = others.map((o) => o.assessment.candidateId);
      return a;
    });
}

export function assessOne(w: Wants, p: ProductProfile, ctx: AssessContext): Assessed {
  const satisfied: Criterion[] = [];
  const unmet: (Criterion & { hard: boolean })[] = [];
  const compromises: Criterion[] = [];
  const unknowns: Criterion[] = [];
  let score = 0;
  let overBudget = false;
  const id = p.product.productId;
  const name = p.product.model;

  const sat = (criterionId: string, text: string, evidence: EvidenceRef[], needEntryId?: string, weight = 2) => {
    satisfied.push({ criterionId, text, evidence, ...(needEntryId ? { needEntryId } : {}) });
    score += weight;
  };
  const comp = (criterionId: string, text: string, evidence: EvidenceRef[], needEntryId?: string, weight = 1.5) => {
    compromises.push({ criterionId, text, evidence, ...(needEntryId ? { needEntryId } : {}) });
    score -= weight;
  };
  const miss = (criterionId: string, text: string, evidence: EvidenceRef[], hard: boolean, needEntryId?: string) => {
    unmet.push({ criterionId, text, evidence, hard, ...(needEntryId ? { needEntryId } : {}) });
    score -= hard ? 8 : 4;
  };
  const unk = (criterionId: string, text: string, evidence: EvidenceRef[] = [], needEntryId?: string, weight = 0.6) => {
    unknowns.push({ criterionId, text, evidence, ...(needEntryId ? { needEntryId } : {}) });
    score -= weight;
  };

  if (ctx.rejected.includes(id)) {
    miss("rejected", "你已明确表示不考虑这一款", [], true);
  }

  /* ---- 预算：官方公开价格 ---- */
  if (w.budget?.max) {
    const max = w.budget.max;
    if (!p.price) {
      unk("budget", p.prices.length ? "官方价格快照里没有可比较的公开金额（可能已下架或需询价），到店核对" : "知识库里没有这款的官方公开价格", p.prices.slice(0, 1).map((r) => priceEvidence({ record: r })), w.budget.entryId, 1.2);
    } else {
      const from = p.price.from;
      const tag = p.price.note ? `（${p.price.note}）` : "";
      if (from <= max) {
        sat("budget", `${p.price.record.priceType} ${from} 元起，在预算 ${max} 元以内${tag}`, [priceEvidence(p.price)], w.budget.entryId, 3);
        score += Math.min(1.5, (from / max) * 1.5); // 预算内越接近上限，配置往往越充分
      } else if (from <= max * 1.12) {
        comp("budget", `${p.price.record.priceType} ${from} 元起，略超预算 ${max} 元${tag}`, [priceEvidence(p.price)], w.budget.entryId, 2.5);
      } else {
        overBudget = true;
        miss("budget", `${p.price.record.priceType} ${from} 元起，超出预算 ${max} 元${tag}`, [priceEvidence(p.price)], false, w.budget.entryId);
      }
      if (p.price.offShelf) unk("stock", "官方商城当前显示已下架或没有公开商城价，库存与价格以门店为准", [priceEvidence(p.price)], undefined, 0.4);
    }
  }

  /* ---- 便携：重量 ---- */
  const travel = w.tasks.has("travel");
  if (w.weight || travel) {
    const entry = w.weight?.entryId ?? w.tasks.get("travel");
    if (!p.weightKg) {
      unk("weight", "资料里没有已核实的重量数据", [], entry, w.weight?.hard ? 2 : 0.8);
    } else {
      const kg = p.weightKg.max;
      const ev = p.weightKg.facts.slice(0, 2).map(factEvidence);
      const shown = p.weightKg.min === p.weightKg.max ? fmtKg(kg) : `${fmtKg(p.weightKg.min)}–${fmtKg(kg)}`;
      const limit = w.weight?.maxKg;
      const foldNote = p.foldable ? "（含电池，不含键盘）" : "";
      if (limit) {
        if (p.weightKg.min <= limit && kg <= limit) sat("weight", `重量 ${shown}${foldNote}，不超过你说的 ${limit} kg`, ev, entry, 3);
        else if (p.weightKg.min <= limit) comp("weight", `部分版本 ${shown}，只有较轻的版本在 ${limit} kg 以内`, ev, entry);
        else miss("weight", `重量 ${shown}，超过你说的 ${limit} kg`, ev, w.weight?.hard ?? false, entry);
      } else if (kg <= 1.2) sat("weight", `重量 ${shown}${foldNote}，适合天天带着走`, ev, entry, 3.2);
      else if (kg <= 1.45) sat("weight", `重量 ${shown}，属于能常带的 14 英寸机身`, ev, entry, 1.6);
      else comp("weight", `重量 ${shown}，经常带出门会有负担`, ev, entry, w.weight?.hard ? 4 : 2.2);
    }
  }

  /* ---- 续航：电池容量 ---- */
  if (w.battery || travel) {
    const entry = w.battery ?? w.tasks.get("travel");
    if (!p.batteryWh) unk("battery", "资料里没有电池容量数据", [], entry);
    else if (p.batteryWh.value >= 65) sat("battery", `电池 ${p.batteryWh.value} Wh（额定容量），实际续航随使用方式变化`, p.batteryWh.facts.slice(0, 1).map(factEvidence), entry, 1.6);
    else comp("battery", `电池 ${p.batteryWh.value} Wh，比 70 Wh 级的型号小`, p.batteryWh.facts.slice(0, 1).map(factEvidence), entry, 1);
  }

  /* ---- 屏幕尺寸 ---- */
  if (w.screen && p.screenIn) {
    const ev = p.screenIn.facts.slice(0, 2).map(factEvidence);
    const size = p.screenIn.value;
    const large = size >= 15.5;
    if (w.screen.size === "large") {
      if (large) sat("screen_size", `${size} 英寸${p.foldable ? "（展开态）" : ""}大屏`, ev, w.screen.entryId, 2.4);
      else if (w.screen.hard) miss("screen_size", `${size} 英寸，不是 16 英寸大屏`, ev, true, w.screen.entryId);
      else comp("screen_size", `${size} 英寸，不是 16 英寸大屏`, ev, w.screen.entryId);
    } else if (large && !p.foldable) comp("screen_size", `${size} 英寸，比 14 英寸机身大一圈`, ev, w.screen.entryId);
    else sat("screen_size", `${p.foldable ? "折叠态 13 英寸，展开 18 英寸" : `${size} 英寸`}，尺寸紧凑`, ev, w.screen.entryId, 1.6);
  }

  /* ---- 系统与软件 ---- */
  const harmonyOnly = p.os.has("harmony") && !p.os.has("windows");
  const osEv = p.osFacts.slice(0, 2).map(factEvidence);
  if (w.os) {
    const match = w.os.want === "harmony" ? p.os.has("harmony") : p.os.has("windows");
    const label = w.os.want === "harmony" ? "鸿蒙" : "Windows";
    if (match) sat("os", `系统：${p.osFacts.map((f) => f.value).join(" / ")}，符合你要的${label}`, osEv, w.os.entryId, 2.5);
    else if (w.os.hard) miss("os", `系统是${p.osFacts.map((f) => f.value).join(" / ")}，不是${label}`, osEv, true, w.os.entryId);
    else comp("os", `系统是${p.osFacts.map((f) => f.value).join(" / ")}，不是你倾向的${label}`, osEv, w.os.entryId, 2.5);
  }
  const wantsWinApps = Boolean(w.software?.heavy) || w.tasks.has("game");
  if (w.software || w.tasks.has("game")) {
    const names = w.software?.names.join("、") || "游戏";
    const entry = w.software?.entryId ?? w.tasks.get("game");
    const faq = ctx.softwareFaq ? [hitEvidence(ctx.softwareFaq)] : [];
    if (harmonyOnly) {
      if (wantsWinApps) comp("software", `鸿蒙系统：${names} 能否安装、功能是否完整要按软件厂商说明逐项核对`, [...osEv, ...faq], entry, 3);
      else unk("software", `鸿蒙系统：${names} 需在华为应用市场或厂商官网确认有无鸿蒙版本`, faq, entry, 0.8);
    } else if (p.os.has("windows")) {
      sat("software", `预装 ${p.osFacts.find((f) => /Windows/i.test(f.value))?.value ?? "Windows"}；${names} 的版本与授权仍按厂商系统要求核对`, osEv, entry, wantsWinApps ? 2.6 : 1);
    }
  }

  /* ---- 创作与性能 ---- */
  const creative = w.tasks.has("video") || w.tasks.has("design");
  if (creative || w.display) {
    const entry = w.display ?? w.tasks.get("video") ?? w.tasks.get("design");
    const disp = [p.oled, p.wideGamut, p.highRefresh].filter((f): f is NonNullable<typeof f> => Boolean(f));
    if (disp.length) sat("display", `屏幕：${disp.map((f) => f.value).join("；")}`, disp.slice(0, 3).map(factEvidence), entry, creative ? 1 + disp.length * 0.7 : 1 + disp.length * 0.4);
    else unk("display", "资料里没有色域或 OLED 一类的屏幕依据", [], entry);
  }
  if (creative || w.tasks.has("game") || w.performance) {
    const entry = w.performance ?? w.tasks.get("video") ?? w.tasks.get("design") ?? w.tasks.get("game");
    if (p.gpu) {
      if (creative || w.tasks.has("game")) comp("gpu", `显卡为${p.gpu.value}，资料里没有独立显卡；重度剪辑、渲染或大型游戏要实机试`, [factEvidence(p.gpu)], entry, 1.2);
      else sat("performance", `处理器：${p.cpu.map((f) => f.value).slice(0, 2).join(" / ")}`, p.cpu.slice(0, 2).map(factEvidence), entry, 1);
    } else if (p.cpu.length) {
      if (creative || w.tasks.has("game")) unk("gpu", `资料只列出处理器 ${p.cpu[0]!.value}，没有显卡型号，图形负载需要实机测试`, p.cpu.slice(0, 1).map(factEvidence), entry, 0.8);
      else sat("performance", `处理器：${p.cpu.map((f) => f.value).slice(0, 2).join(" / ")}`, p.cpu.slice(0, 2).map(factEvidence), entry, 1);
    }
    if (p.ramMaxGb && (creative || w.tasks.has("code"))) {
      if (p.ramMaxGb.value >= 24) sat("memory", `内存最高 ${p.ramMaxGb.value} GB（按配置）`, p.ramMaxGb.facts.slice(0, 1).map(factEvidence), entry, 1.2);
    }
  }

  /* ---- 手写与触屏 ---- */
  if (w.pen) {
    if (p.pen) sat("pen", `资料列出手写笔：${p.pen.value}`, [factEvidence(p.pen)], w.pen, 2.5);
    else if (p.touch) comp("pen", `支持触屏（${p.touch.value}），但资料没有列出手写笔支持`, [factEvidence(p.touch)], w.pen);
    else unk("pen", "资料里没有手写笔或触屏支持的依据", [], w.pen, 1.2);
  } else if (w.touch) {
    if (p.touch) sat("touch", `触屏：${p.touch.value}`, [factEvidence(p.touch)], w.touch, 2);
    else unk("touch", "资料没有列出触屏", [], w.touch, 1);
  }

  /* ---- 接口 ---- */
  if (w.ports || w.monitor) {
    const entry = w.ports?.entryId ?? w.monitor;
    const have = [p.hdmi, p.usbA].filter((f): f is NonNullable<typeof f> => Boolean(f));
    if (have.length === 2) sat("ports", `原生 HDMI 和 USB-A：${p.portsText.slice(0, 80)}`, have.map(factEvidence), entry, 2.2);
    else if (have.length === 1) sat("ports", `接口：${have[0]!.value}`, [factEvidence(have[0]!)], entry, 1.2);
    else if (p.portFacts.length) {
      const text = `接口只有 USB-C（${p.portsText.slice(0, 60)}），接 HDMI / USB-A 设备要转接`;
      if (w.ports?.hard) miss("ports", text, p.portFacts.slice(0, 2).map(factEvidence), true, entry);
      else comp("ports", text, p.portFacts.slice(0, 2).map(factEvidence), entry);
    }
    else unk("ports", "资料里没有接口数据", [], entry);
  }

  /* ---- 已有设备与协同 ---- */
  if (w.huaweiPhone) {
    if (p.collab) sat("collab", `特色应用里列有跨设备协同：${p.collab.value.slice(0, 60)}`, [factEvidence(p.collab)], w.huaweiPhone, 1.8);
    else unk("collab", "资料没有列出与华为手机协同的功能，需按机型与系统版本核对", [], w.huaweiPhone);
  }
  if (w.privacy) {
    if (p.privacy) sat("privacy", `隐私：${p.privacy.value}`, [factEvidence(p.privacy)], w.privacy, 2);
    else unk("privacy", "资料没有列出防窥屏或隐私开关", [], w.privacy);
  }
  if (w.fold) {
    if (p.foldable) sat("fold", `折叠屏：${p.foldable.value}`, [factEvidence(p.foldable)], w.fold, 3);
    else comp("fold", "不是折叠屏", p.screenIn ? p.screenIn.facts.slice(0, 1).map(factEvidence) : [], w.fold, 0.5);
  }

  /* ---- 型号检索卡：适用 / 不适用 ---- */
  if (p.brief) {
    const quoted = new Set<string>(); // 一句检索卡原文只引用一次（出差、办公可能命中同一句）
    for (const [tag, entryId] of w.tasks) {
      const re = TASK_WORDS[tag];
      const fit = p.brief.fits.find((l) => re.test(l) && !quoted.has(l));
      const notFit = p.brief.notFits.find((l) => re.test(l) && !quoted.has(l));
      for (const l of [fit, notFit]) if (l) quoted.add(l);
      if (notFit) comp(`brief-${tag}`, `型号检索卡提醒：${notFit}`, [briefEvidence(p.brief, notFit)], entryId, 1.4);
      else if (fit) sat(`brief-${tag}`, `型号检索卡：${fit}`, [briefEvidence(p.brief, fit)], entryId, 1.4);
    }
  }

  /* ---- 读不懂的硬条件、顾虑 ---- */
  for (const e of w.hardOther) unk(`hard-${e.entryId}`, `“${e.value}”需要到店确认，资料里找不到直接对应的参数`, [], e.entryId, 1);

  // 资料越完整越可信：同分时偏向事实更全的型号。
  score += Math.min(1, p.verifiedCount / 60);

  const hardFail = unmet.some((u) => u.hard);
  // 只有“专业软件 / 读不懂的硬条件 / 硬性重量”拿不准时才算证据不足；办公软件待核实只是提醒。
  const coreUnknown = unknowns.some((u) => (u.criterionId === "software" && w.software?.heavy) || u.criterionId.startsWith("hard-") || (u.criterionId === "weight" && w.weight?.hard));
  const overall: CandidateAssessment["overall"] =
    hardFail || overBudget ? "not_fit" : coreUnknown ? "insufficient_evidence" : compromises.length || unknowns.length || unmet.length ? "fits_with_compromise" : "fits";

  const assessment: CandidateAssessment = {
    candidateId: `cand-${id}`,
    product: { productId: id },
    modelName: name,
    assessedNeedVersion: ctx.needVersion,
    overall,
    satisfied,
    unmet,
    compromises,
    unknowns,
    comparisonReason: reasonOf(overall, satisfied, compromises, unmet, unknowns),
    comparedWith: [],
    origin: ctx.origin,
    isMock: ctx.origin === "mock",
  };
  return { assessment, profile: p, score: Math.round(score * 100) / 100 };
}

const short = (t: string) => t.split(/[，；（(]/)[0]!.slice(0, 30);

function reasonOf(overall: CandidateAssessment["overall"], sat: Criterion[], comp: Criterion[], unmet: Criterion[], unk: Criterion[]): string {
  if (overall === "not_fit") return `不合适：${unmet.map((u) => short(u.text)).slice(0, 2).join("；") || "有条件不满足"}`;
  const good = sat.filter((c) => !c.criterionId.startsWith("brief-")).map((c) => short(c.text)).slice(0, 3);
  const bad = [...comp, ...unk].map((c) => short(c.text)).slice(0, 2);
  const lead = overall === "insufficient_evidence" ? "关键一项还要核实" : overall === "fits" ? "满足你目前说的全部条件" : "大体符合";
  return `${lead}${good.length ? `：${good.join("；")}` : ""}${bad.length ? `。要留意：${bad.join("；")}` : ""}`;
}

export const tasksText = (w: Wants) => [...w.tasks.keys()].map((t) => TASK_LABEL[t]).join("、");
