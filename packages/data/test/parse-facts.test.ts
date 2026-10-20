import { describe, expect, it } from "vitest";
import type { FactRecord, ProductIdentity, SourceRef } from "@hwpc/contracts";
import { parseFacts } from "../src/local.js";

// 结构照搬本地知识库 产品事实.md：官网规格表被抓成“字段名一行、值一行”，页尾带外链弹窗文字。
const MD = `# HUAWEI MateBook D 14 2024 - 产品事实

> 来源：华为官网公开产品页与规格页。抓取日期：2026-10-17。配置可能因销售版本而异。

## 操作系统

Windows 11 家庭版

Linux V20 版

## 尺寸与重量

长度

15.9 mm

宽度

314.5 mm

厚度

227.79 mm

重量

约 1.39 kg

## 屏幕

HUAWEI MateBook D 14 2024 13 代酷睿版

分辨率

1920 × 1200，161 ppi

刷新率

120 Hz

亮度

标准版：

典型亮度：450 nits

柔光版：

典型亮度：500 nits

色域

100% sRGB

色深

10.7 亿色

HUAWEI MateBook D 14 2024 SE 版 13 代酷睿版

色域

45% NTSC

## 处理器

CPU

第 13 代智能英特尔®酷睿™ i5-13420H 处理器

第 13 代智能英特尔® 酷睿™ i7-1360P 处理器

*仅限 Windows 版本产品搭载。

## 无线连接

蓝牙

蓝牙 5.1

NFC

支持

## 电池

材料

锂聚合物

容量

56 Wh（额定容量）

## 接口

Windows 版：

Thunderbolt™ 4 × 1（左侧）

Linux V20 版：

USB-C × 2（左侧）

## 包装清单

快速入门

保修卡

即将离开consumer.huawei.com

您即将跳转至第三方页面，华为无法控制，也无法对该页面内容负责。

继续访问

取消
`;

const product = { productId: "p", category: "pc", family: "d14", model: "MateBook D 14", aliases: [], configurations: [], origin: "local" } as ProductIdentity;
const source: SourceRef = { origin: "local", title: "t", locator: "l" };
const facts = parseFacts(MD, product, source);
const byField = (field: string) => facts.filter(f => f.field === field);
const one = (field: string): FactRecord => {
  const list = byField(field);
  expect(list, field).toHaveLength(1);
  return list[0]!;
};

describe("产品事实解析", () => {
  it("页尾外链弹窗文字不进入事实", () => {
    expect(facts.map(f => f.value)).not.toEqual(expect.arrayContaining(["继续访问"]));
    expect(facts.some(f => /即将离开|跳转至第三方|^取消$/.test(f.value))).toBe(false);
    expect(byField("包装清单").map(f => f.value)).toEqual(["快速入门", "保修卡"]);
  });

  it("规格表字段名不被当成参数值，值也不串到上一个字段", () => {
    expect(facts.some(f => /^(CPU|材料|刷新率|色深|NFC|标准版：|柔光版：)$/.test(f.value))).toBe(false);
    expect(byField("处理器·CPU").map(f => f.value)).toHaveLength(2);
    expect(one("电池·材料").value).toBe("锂聚合物");
    expect(one("屏幕·刷新率").value).toBe("120 Hz");
    expect(one("屏幕·分辨率").value).toBe("1920 × 1200，161 ppi");
    expect(one("屏幕·色深").value).toBe("10.7 亿色");
    expect(one("无线连接·NFC").value).toBe("支持");
    expect(one("无线连接·蓝牙").value).toBe("蓝牙 5.1");
  });

  it("版本小标题作为限定条件带到其下的事实，不与相近版本混用", () => {
    const gamut = byField("屏幕·色域");
    expect(gamut.find(f => f.value === "100% sRGB")!.qualifiers).toContain("仅 HUAWEI MateBook D 14 2024 13 代酷睿版");
    expect(gamut.find(f => f.value === "45% NTSC")!.qualifiers).toContain("仅 HUAWEI MateBook D 14 2024 SE 版 13 代酷睿版");
    expect(gamut.find(f => f.value === "45% NTSC")!.qualifiers).not.toContain("仅 HUAWEI MateBook D 14 2024 13 代酷睿版");
    const brightness = byField("屏幕·亮度");
    expect(brightness.find(f => f.value.includes("450"))!.qualifiers).toContain("仅 标准版");
    expect(brightness.find(f => f.value.includes("500"))!.qualifiers).toContain("仅 柔光版");
    // “标准版：/柔光版：”只管到本字段结束
    expect(gamut.flatMap(f => f.qualifiers).some(q => /标准版|柔光版/.test(q))).toBe(false);
    const ports = byField("接口");
    expect(ports.find(f => f.value.startsWith("Thunderbolt"))!.qualifiers).toContain("仅 Windows 版");
    expect(ports.find(f => f.value.startsWith("USB-C"))!.qualifiers).toContain("仅 Linux V20 版");
    // 操作系统段里的“Linux V20 版”是取值，不是版本小标题
    expect(byField("操作系统").map(f => f.value)).toEqual(["Windows 11 家庭版", "Linux V20 版"]);
  });

  it("脚注作用于整组取值", () => {
    const cpu = byField("处理器·CPU");
    expect(cpu).toHaveLength(2);
    for (const f of cpu) {
      expect(f.qualifiers).toContain("仅限 Windows 版本产品搭载。");
      expect(f.reviewStatus).toBe("pending_review");
    }
  });

  it("尺寸标签与数值错位时整组标为待审核，不标 verified", () => {
    for (const field of ["尺寸与重量·长度", "尺寸与重量·宽度", "尺寸与重量·厚度"]) {
      const f = one(field);
      expect(f.reviewStatus, field).toBe("pending_review");
      expect(f.qualifiers.some(q => /错位/.test(q)), field).toBe(true);
    }
    expect(one("尺寸与重量·重量").reviewStatus).toBe("verified");
  });

  it("尺寸合理时保持 verified", () => {
    const ok = parseFacts("# X - 产品事实\n\n## 尺寸与重量\n\n长度\n\n312.6 mm\n\n宽度\n\n226.8 mm\n\n厚度\n\n14.5 mm\n\n## 尺寸与重量2\n\n宽度\n\n展开态：382.5 mm\n\n高度\n\n展开态：7.6 mm（左）/ 7.3 mm（右）\n", product, source);
    expect(ok.every(f => f.reviewStatus === "verified")).toBe(true);
  });
});

describe("版本小标题的作用范围", () => {
  it("小标题下直接是取值时，遇到下一个字段名即结束", () => {
    const md = "# X - 产品事实\n\n## 键盘和触控板\n\nHUAWEI MateBook D 14 2024 13 代酷睿版\n\n全尺寸背光键盘\n\nHUAWEI MateBook D 14 2024 SE 版 13 代酷睿版\n\n全尺寸键盘\n\n电源键\n\n指纹电源键\n";
    const facts = parseFacts(md, product, source);
    expect(facts.find(f => f.value === "全尺寸键盘")!.qualifiers).toContain("仅 HUAWEI MateBook D 14 2024 SE 版 13 代酷睿版");
    const power = facts.find(f => f.field === "键盘和触控板·电源键")!;
    expect(power.value).toBe("指纹电源键");
    expect(power.qualifiers.some(q => q.startsWith("仅 "))).toBe(false);
  });
});
