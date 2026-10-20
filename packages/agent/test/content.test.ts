import { describe, expect, it } from "vitest";
import type { MaterialPack, ModelService, StoreProfile } from "@hwpc/contracts";
import { createMockDataService } from "@hwpc/fixtures";
import { generatePostVariants, parseModelJson, pickAngles, similarity, verifyAndRepair, type PostEngineInput } from "../src/index.js";
import { selectFacts, shortModel } from "../src/content/facts.js";

const store: StoreProfile = {
  storeId: "s1",
  name: "示例门店",
  city: "杭州",
  area: "湖滨",
  audience: "周边写字楼白领",
  staffName: "小林",
  contactLine: "地址：湖滨路 18 号，营业 10:00–22:00",
  activity: "",
  updatedAt: new Date(0).toISOString(),
};

async function pack(): Promise<MaterialPack> {
  return createMockDataService().getMaterialPack({ taskId: "t", product: { productId: "mock-air-14" } });
}

/** 假模型：从用户提示里找到“续航”的编号，写一段用占位符的正文，再故意编一个参数。 */
function fakeModel(extra = "它的重量只有 0.9 kg，非常轻。"): ModelService {
  return {
    getStatus: async () => ({ state: "connected", provider: "openai_compatible", message: "test" }),
    complete: async (req) => {
      const user = JSON.parse(req.messages.find((m) => m.role === "user")!.content) as { 可用事实: { 编号: string; 字段: string }[]; 可用图片: { 编号: string }[] };
      const battery = user.可用事实.find((f) => f.字段 === "续航")!.编号;
      return {
        text: "```json\n" + JSON.stringify({
          title: "下班路上的一台电脑",
          blocks: [
            { type: "image", image: user.可用图片[0]?.编号 ?? "I1", caption: "示例图" },
            { type: "paragraph", text: `晚上回家前还想改两页方案，续航写的是{{${battery}}}。${extra}` },
            { type: "paragraph", text: "这一句引用了不存在的编号 {{F99}}。" },
          ],
          callToAction: "来店里试试",
          tags: ["#通勤", "白领"],
        }) + "\n```",
        simulated: false,
      };
    },
  };
}

function input(over: Partial<PostEngineInput> & { pack: MaterialPack }): PostEngineInput {
  return {
    platform: "xiaohongshu",
    campaign: { title: "通勤季", theme: "通勤路上轻一点", audience: "上班族", mustAvoid: "", productIds: ["mock-air-14"] },
    store,
    peerTexts: [],
    count: 3,
    round: 0,
    seed: "s1:c1:xiaohongshu",
    temperature: 0.8,
    now: () => new Date("2026-10-19T00:00:00Z"),
    ...over,
  };
}

describe("门店推文引擎", () => {
  it("事实按原文逐字填入并带上限制条件；模型自编的参数被删除；未知编号整句删除", async () => {
    const [v] = await generatePostVariants(input({ pack: await pack(), model: fakeModel(), count: 1 }));
    expect(v!.mode).toBe("model");
    const body = v!.article.blocks.filter((b) => b.type === "paragraph").map((b) => (b.type === "paragraph" ? b.text : "")).join("\n");
    expect(body).toContain("视频播放最长 10 小时（虚构）");
    expect(body).toContain("实验室数据，实际使用因场景而异");
    expect(body).not.toContain("0.9");
    expect(body).not.toContain("F99");
    expect(v!.report.findings.some((f) => f.excerpt?.includes("0.9"))).toBe(true);
    expect(v!.article.tags).toEqual(["通勤", "白领"]);
  });

  it("门店地址在核验之后追加，不会被当成无依据的数字删掉；价格一律不写", async () => {
    const [v] = await generatePostVariants(input({ pack: await pack(), model: fakeModel("现在下单立减 200 元。"), count: 1, store: { ...store, activity: "到店可预约样机体验" } }));
    expect(v!.article.callToAction).toContain("湖滨路 18 号");
    expect(v!.article.callToAction).toContain("本店活动：到店可预约样机体验");
    expect(JSON.stringify(v!.article)).not.toContain("立减");
  });

  it("没有模型时生成模板稿，三个版本角度各不相同且没有阻断问题", async () => {
    const vs = await generatePostVariants(input({ pack: await pack() }));
    expect(vs).toHaveLength(3);
    expect(new Set(vs.map((v) => v.angle)).size).toBe(3);
    expect(vs.every((v) => v.mode === "template")).toBe(true);
    expect(vs.every((v) => v.report.deliveryStatus !== "blocked")).toBe(true);
  });

  it("四个平台的结构确实不同", async () => {
    const p = await pack();
    const [wx, xhs, moments, poster] = await Promise.all(
      (["wechat_article", "xiaohongshu", "store_moments", "store_poster"] as const).map(async (platform) => (await generatePostVariants(input({ pack: p, platform, count: 1 })))[0]!.article),
    );
    expect(wx!.lead).toBeTruthy();
    expect(xhs!.blocks[0]!.type).toBe("image");
    expect(xhs!.tags.length).toBeGreaterThan(0);
    expect(moments!.tags).toHaveLength(0);
    expect(poster!.title.length).toBeLessThanOrEqual(12);
  });

  it("与其他门店已选稿件过于相似时在报告中提示", async () => {
    const p = await pack();
    const [first] = await generatePostVariants(input({ pack: p, count: 1 }));
    const text = JSON.stringify(first!.article);
    const [again] = await generatePostVariants(input({ pack: p, count: 1, peerTexts: [text] }));
    expect(again!.similarity).toBeGreaterThan(0.5);
    expect(again!.report.findings.some((f) => f.kind === "style" && f.message.includes("相似度"))).toBe(true);
  });

  it("不同门店拿到不同的角度组合；重新生成换一批", () => {
    const a = pickAngles({ seed: "store-a", audience: "上班族", theme: "通勤", n: 3 }).map((x) => x.id);
    const others = ["store-b", "store-c", "store-d", "store-e"].map((s) => pickAngles({ seed: s, audience: "上班族", theme: "通勤", n: 3 }).map((x) => x.id).join());
    expect(others.some((o) => o !== a.join())).toBe(true);
    const next = pickAngles({ seed: "store-a", audience: "上班族", theme: "通勤", n: 3, round: 1 }).map((x) => x.id);
    expect(next.join()).not.toBe(a.join());
  });

  it("解析残留与列错位的尺寸不会进入推文；有吸引力的字段排在前面", () => {
    const base = { productId: "p", configurationIds: [], qualifiers: [], reviewStatus: "verified" as const, source: { origin: "local" as const, title: "t", locator: "l" } };
    const facts = [
      { ...base, factId: "a", category: "processor" as const, field: "处理器", value: "CPU" },
      { ...base, factId: "b", category: "display" as const, field: "屏幕·亮度", value: "标准版：" },
      { ...base, factId: "c", category: "other" as const, field: "包装清单", value: "即将离开consumer.huawei.com" },
      { ...base, factId: "d", category: "portability" as const, field: "尺寸与重量·厚度", value: "227.79 mm" },
      { ...base, factId: "e", category: "portability" as const, field: "尺寸与重量·长度", value: "312.6 mm" },
      { ...base, factId: "f", category: "portability" as const, field: "尺寸与重量·重量", value: "约 1.33 kg" },
    ];
    const picked = selectFacts(facts, ["portability"]).map((x) => x.fact.factId);
    expect(picked).toEqual(["f", "e"]);
  });

  it("标题里的型号名带数字时不会被当成无依据参数替换掉", async () => {
    const p = await pack();
    const title = `${p.products[0]!.model} 开学季`;
    const out = verifyAndRepair(
      {
        scope: { productIds: ["mock-air-14"], configurationIds: [], avoidTopics: [], noPrice: true, otherModels: [] },
        pack: p,
        article: { platform: "store_poster", title, blocks: [{ type: "paragraph", text: "到店看看。", factIds: [] }], callToAction: "到店体验", tags: [] },
        allowedFactIds: [],
      },
      new Date().toISOString(),
    );
    expect(out.article.title).toBe(title);
  });

  it("模型配置错误或调用失败时回退模板稿，并在核验报告里说明原因", async () => {
    const broken: ModelService = {
      getStatus: async () => ({ state: "error", provider: "openai_compatible", message: "x" }),
      complete: async () => {
        throw new Error("HTTP 401 unauthorized");
      },
    };
    const [v] = await generatePostVariants(input({ pack: await pack(), model: broken, count: 1 }));
    expect(v!.mode).toBe("template");
    expect(v!.report.findings.some((f) => f.message.includes("模型调用失败") && f.message.includes("401"))).toBe(true);
  });

  it("型号简称不截在单词中间", () => {
    expect(shortModel("HUAWEI MateBook 14（鸿蒙版）", 16)).toBe("MateBook 14（鸿蒙版）");
    expect(shortModel("HUAWEI MateBook 14（鸿蒙版）", 12)).toBe("MateBook 14");
    expect(shortModel("HUAWEI MateBook X Pro 酷睿 Ultra 微绒典藏版", 12)).toBe("MateBook X");
  });

  it("工具函数：JSON 解析容忍围栏，相似度区分相同与不同", () => {
    expect(parseModelJson('说明\n```json\n{"title":"t","blocks":[{"type":"paragraph","text":"x"}]}\n```').title).toBe("t");
    expect(similarity("今天带电脑去图书馆写论文", "今天带电脑去图书馆写论文")).toBe(1);
    expect(similarity("今天带电脑去图书馆写论文", "周末在家修照片剪视频")).toBeLessThan(0.2);
  });
});
