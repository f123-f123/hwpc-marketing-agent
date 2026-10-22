import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CandidateAssessmentSchema,
  buildNeedSummary,
  emptyNeedVersion,
  type AdvisorDeps,
  type AdvisorView,
  type FactRecord,
  type NeedEntry,
  type PriceRecord,
  type ProductIdentity,
} from "@hwpc/contracts";
import { assessAll, buildProfile, createKbAdvisorEngine, createKbQaEngine, extractEdits, nextQuestions, numbersGrounded, parseBudget, wantsOf } from "../src/index.js";
import { namedIn } from "../src/advisor/qa.js";
import { createDataService, createLocalLibrary } from "@hwpc/data";
import { defaultLocalRoot } from "../../data/src/local.js";

const src = { origin: "local" as const, title: "测试资料", locator: "P1/test.md" };
let n = 0;
const fact = (productId: string, field: string, value: string, reviewStatus: "verified" | "pending_review" = "verified"): FactRecord => ({
  factId: `f${n++}`,
  productId,
  configurationIds: [],
  category: "other",
  field,
  value,
  qualifiers: [],
  source: src,
  reviewStatus,
});
const price = (productId: string, amount: number, priceType = "官方商城页面价"): PriceRecord => ({
  recordId: `p-${productId}-${amount}`,
  productId,
  productName: productId,
  variant: "16GB/512GB",
  priceType,
  amount,
  conditions: "",
  stock: "",
  checkedAt: "2026-10-17T10:00:00-05:00",
  status: "已核验",
  source: { origin: "local", title: "官方价格快照", locator: "P1/08/官方价格快照.csv" },
});
const product = (productId: string, model: string): ProductIdentity => ({ productId, category: "pc", family: model, model, aliases: [], configurations: [], origin: "local" });
const entry = (key: NeedEntry["key"], value: string, extra: Partial<NeedEntry> = {}): NeedEntry => ({
  entryId: `${key}-${value}`,
  key,
  value,
  status: "known",
  hard: key === "hardConstraints",
  origin: { by: "user", turn: 1, quote: value },
  setAtVersion: 1,
  history: [],
  ...extra,
});

const harmony = buildProfile(
  product("h", "HUAWEI MateBook Air 鸿蒙"),
  [fact("h", "操作系统", "HarmonyOS 6"), fact("h", "尺寸与重量·重量", "约 1.12 kg"), fact("h", "屏幕·尺寸", "14.2 英寸"), fact("h", "电池·容量", "70 Wh（额定容量）"), fact("h", "接口", "USB-C × 2")],
  [price("h", 6999)],
);
const windows = buildProfile(
  product("w", "HUAWEI MateBook D 16"),
  [fact("w", "操作系统", "Windows 11 家庭版"), fact("w", "尺寸与重量·重量", "约 1.70 kg"), fact("w", "屏幕·尺寸", "16 英寸"), fact("w", "电池·容量", "56 Wh（额定容量）"), fact("w", "接口", "HDMI × 1；USB-A × 2"), fact("w", "显卡·集成显卡", "Intel UHD")],
  [price("w", 4999)],
);

describe("需求抽取", () => {
  it("识别各种预算说法", () => {
    expect(parseBudget("预算6000以内")?.max).toBe(6000);
    expect(parseBudget("五六千左右吧")?.max).toBe(6000);
    expect(parseBudget("1.2万左右")?.max).toBe(12000);
    expect(parseBudget("5000-7000 都行")).toMatchObject({ min: 5000, max: 7000 });
    expect(parseBudget("想要轻一点")).toBeUndefined();
  });

  it("一句话抽出多个维度，quote 都出自原话", () => {
    const text = "经常出差，预算7000，要用PS修图，重量不能超过1.3kg";
    const edits = extractEdits(text);
    const keys = edits.flatMap((e) => (e.op === "set" ? [e.key] : []));
    expect(keys).toEqual(expect.arrayContaining(["task", "budget", "requiredSoftware", "hardConstraints"]));
    for (const e of edits) if (e.op === "set") expect(text).toContain(e.quote);
    const hard = edits.find((e) => e.op === "set" && e.key === "hardConstraints");
    expect(hard).toMatchObject({ structured: { maxKg: 1.3 } });
  });

  it("“转接头也行”不会被当成要原生接口", () => {
    expect(extractEdits("带个转接头可以接受").some((e) => e.op === "set" && /接口/.test(e.value))).toBe(false);
  });
});

describe("候选筛选", () => {
  it("每条满足 / 取舍都带知识库证据，并通过契约校验", () => {
    const ranked = assessAll([entry("task", "出差、通勤时带着用"), entry("budget", "预算 7000 元以内", { structured: { max: 7000 } })], [harmony, windows], { needVersion: 2, rejected: [], origin: "local" });
    for (const a of ranked) {
      expect(() => CandidateAssessmentSchema.parse(a.assessment)).not.toThrow();
      for (const c of [...a.assessment.satisfied, ...a.assessment.compromises]) expect(c.evidence.length).toBeGreaterThan(0);
    }
    // 出差：轻的排前面
    expect(ranked[0]!.profile.product.productId).toBe("h");
    expect(ranked[1]!.assessment.compromises.some((c) => c.criterionId === "weight")).toBe(true);
  });

  it("硬条件不满足 → 不合适；超预算 → 不合适", () => {
    const hard = assessAll([entry("hardConstraints", "重量不超过 1.3 kg", { structured: { maxKg: 1.3 } })], [windows], { needVersion: 1, rejected: [], origin: "local" })[0]!;
    expect(hard.assessment.overall).toBe("not_fit");
    expect(hard.assessment.unmet[0]).toMatchObject({ hard: true });
    const over = assessAll([entry("budget", "预算 5000 元以内", { structured: { max: 5000 } })], [harmony], { needVersion: 1, rejected: [], origin: "local" })[0]!;
    expect(over.assessment.overall).toBe("not_fit");
  });

  it("待核事实不能当作满足", () => {
    const p = buildProfile(product("x", "X"), [fact("x", "尺寸与重量·重量", "约 1.0 kg", "pending_review")], []);
    const a = assessAll([entry("task", "出差、通勤时带着用")], [p], { needVersion: 1, rejected: [], origin: "local" })[0]!;
    expect(a.assessment.satisfied.some((c) => c.criterionId === "weight")).toBe(false);
    expect(a.assessment.unknowns.some((c) => c.criterionId === "weight")).toBe(true);
  });

  it("鸿蒙机型遇到依赖 Windows 的软件：要求按厂商核对，而不是写成支持", () => {
    const ranked = assessAll([entry("requiredSoftware", "需要使用：Photoshop")], [harmony, windows], { needVersion: 1, rejected: [], origin: "local" });
    const h = ranked.find((a) => a.profile.product.productId === "h")!;
    expect(h.assessment.satisfied.some((c) => c.criterionId === "software")).toBe(false);
    expect(h.assessment.compromises.find((c) => c.criterionId === "software")?.text).toMatch(/核对/);
  });
});

describe("动态追问", () => {
  const view = (entries: NeedEntry[]) => ({ entries, openQuestions: [], recentMessages: [] });
  it("还不知道用途时先问用途", () => {
    const ranked = assessAll([], [harmony, windows], { needVersion: 1, rejected: [], origin: "local" });
    expect(nextQuestions(wantsOf([]), ranked, view([]))[0]?.targetKeys).toEqual(["task"]);
  });
  it("候选同时有鸿蒙和 Windows 时问软件，理由里点出真实型号", () => {
    const entries = [entry("task", "日常办公：文档、表格、会议"), entry("budget", "预算 8000 元以内", { structured: { max: 8000 } })];
    const ranked = assessAll(entries, [harmony, windows], { needVersion: 1, rejected: [], origin: "local" });
    const qs = nextQuestions(wantsOf(entries), ranked, view(entries));
    const sw = qs.find((q) => q.targetKeys.includes("requiredSoftware"));
    expect(sw?.reason).toMatch(/MateBook Air 鸿蒙/);
    expect(sw?.reason).toMatch(/MateBook D 16/);
  });
  it("已经在问的维度不再重复问", () => {
    const ranked = assessAll([], [harmony, windows], { needVersion: 1, rejected: [], origin: "local" });
    const qs = nextQuestions(wantsOf([]), ranked, { entries: [], recentMessages: [], openQuestions: [{ questionId: "q", prompt: "你主要会用它做什么？", targetKeys: ["task"] }] });
    expect(qs.some((q) => q.targetKeys.includes("task"))).toBe(false);
  });
});

describe("模型输出门槛", () => {
  it("改写里出现资料外的数字就不采用", () => {
    expect(numbersGrounded("官方商城页面价 5899 元起", '{"price":"5899"}')).toBe(true);
    expect(numbersGrounded("续航可达 18 小时", '{"battery":"70 Wh"}')).toBe(false);
  });
});

describe("答疑：点名型号", () => {
  const cand = (name: string) => ({ kind: "candidate", name }) as never;
  it("“Pro S”只命中 Pro S，不连带 Pro", () => {
    const list = [cand("HUAWEI MateBook Pro"), cand("HUAWEI MateBook Pro S")];
    expect(namedIn("Pro S 有多重", list).map((c: { name: string }) => c.name)).toEqual(["HUAWEI MateBook Pro S"]);
  });
});

/* ------------------------------ 真实知识库（本地有资料时才跑） ------------------------------ */

const KB = existsSync(defaultLocalRoot());
describe.skipIf(!KB)("知识库顾问（真实资料）", () => {
  const library = createLocalLibrary();
  const data = createDataService({ mode: "local", ima: { kbName: "" } });
  const engine = createKbAdvisorEngine({ library });
  const deps = { data, emit: () => undefined } as unknown as AdvisorDeps;
  const t = new Date().toISOString();
  const empty = emptyNeedVersion(t);
  const view: AdvisorView = { sessionId: "s", needVersion: 1, entries: [], summary: buildNeedSummary(empty, []), recentMessages: [], openQuestions: [], candidates: [], rejectedProductIds: [], excludedSceneIds: [], confirmed: false };

  it("从知识库型号里筛候选，引用知识库原文，不是模拟数据", async () => {
    const p = await engine.respond(view, "经常出差，预算 7000 以内", deps);
    expect(engine.isMock).toBe(false);
    expect(p.candidates?.length).toBeGreaterThan(0);
    for (const c of p.candidates!) {
      expect(c.isMock).toBe(false);
      expect(c.modelName).toMatch(/MateBook/);
      expect(() => CandidateAssessmentSchema.parse(c)).not.toThrow();
    }
    expect(p.references.length).toBeGreaterThan(0);
    expect(p.reply).toMatch(/官方商城页面价|官网参考起价/);
  }, 30_000);

  it("答疑：价格问题报官方价格类型和核验时间", async () => {
    const qa = createKbQaEngine({ library });
    const products = (await data.searchProducts("")).candidates;
    const mb14 = products.find((p) => /MateBook 14（鸿蒙版）/.test(p.model))!;
    const page = { sections: [{ kind: "candidate", candidateId: "c1", product: { productId: mb14.productId }, name: mb14.model, role: "recommended", compromises: [], unmet: [], unknowns: [] }] } as never;
    const a = await qa.answer({ page, plan: { version: 1 } as never, needs: [], history: [] }, "这台多少钱", { data });
    expect(a.reply).toMatch(/官方商城页面价 \d+ 元起/);
    expect(a.reply).toMatch(/核验时间 2026-/);
  }, 30_000);
});
