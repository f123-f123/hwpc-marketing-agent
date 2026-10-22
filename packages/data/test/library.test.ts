import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkMarkdown, createLocalLibrary, parseBrief, tokenize } from "../src/library.js";
import { defaultLocalRoot } from "../src/local.js";

describe("切词与切块", () => {
  it("中文按二元组切，英文数字按词", () => {
    expect(tokenize("出差续航 70 Wh")).toEqual(["出差", "差续", "续航", "70", "wh"]);
  });

  it("按二、三级标题切块，去掉注释，标题挂在块上", () => {
    const md = "# 标题\n\n## 适用任务\n\n- 学生、行政和基础商务文档任务。\n- 已有HDMI设备的用户。\n\n<!-- v6 -->\n\n## 空\n\n短\n";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ title: "标题", heading: "适用任务" });
    expect(chunks[0]!.text).not.toContain("v6");
  });
});

describe("型号检索卡：适用人群与限制", () => {
  it("取出定位、适用、不适用、待核验，忽略“字段解读”之后的扩写", () => {
    const md = [
      "# D 14｜06-适用人群与限制卡",
      "## 检索结论",
      "适合预算和接口实用性优先的14英寸办公用户。",
      "## 适用任务",
      "- 学生、行政和基础商务文档任务。",
      "## 不适用或需先验证的任务",
      "- SE版承担专业色彩工作。",
      "## 待核验项",
      "- 软件兼容。",
      "## 字段解读",
      "## 适用任务",
      "- 不应被读到",
    ].join("\n");
    const b = parseBrief(md, "p", { origin: "local", title: "t", locator: "l" });
    expect(b.positioning).toMatch(/接口实用性/);
    expect(b.fits).toEqual(["学生、行政和基础商务文档任务。"]);
    expect(b.notFits).toEqual(["SE版承担专业色彩工作。"]);
    expect(b.toVerify).toEqual(["软件兼容。"]);
  });
});

describe.skipIf(!existsSync(defaultLocalRoot()))("本地知识库检索（真实资料）", () => {
  const lib = createLocalLibrary();

  it("建立索引并检索到带出处的原文", async () => {
    const st = await lib.status();
    expect(st.state).toBe("connected");
    expect(st.documents).toBeGreaterThan(100);
    const hits = await lib.search("专业软件能否安装", { sections: ["faq"], limit: 2 });
    expect(hits[0]?.title).toMatch(/专业软件/);
    expect(hits[0]?.source.locator).toMatch(/^P7-常见问题库\//);
  });

  it("指定型号时不返回其他型号的资料", async () => {
    const all = await lib.search("出差 重量", { sections: ["role_script"], limit: 10 });
    const one = all[0]!.productIds[0]!;
    const scoped = await lib.search("出差 重量", { productIds: [one], sections: ["role_script"], limit: 10 });
    for (const h of scoped) expect(h.productIds.every((p) => p === one)).toBe(true);
  });

  it("官方价格按型号归属，图片只读索引里登记过的文件", async () => {
    const imgs = await lib.images({ scenesOnly: true, query: "移动办公", limit: 2 });
    expect(imgs.length).toBeGreaterThan(0);
    const content = await lib.readImage(imgs[0]!.imageId);
    expect(content.bytes.length).toBeGreaterThan(1000);
    await expect(lib.readImage("kbimg-not-exist")).rejects.toThrow();
    const anyProduct = (await lib.images({ limit: 200 })).find((i) => i.productId !== "kb-scene")!;
    const prices = await lib.prices(anyProduct.productId);
    for (const p of prices) expect(p.productId).toBe(anyProduct.productId);
  });
});
