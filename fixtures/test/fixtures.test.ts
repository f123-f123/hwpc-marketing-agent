import { describe, expect, it } from "vitest";
import {
  ArticleSchema,
  MarketingTaskInputSchema,
  checkMaterialPack,
  checkResultVersion,
  parseMaterialPack,
  parseResultVersion,
} from "@hwpc/contracts";
import {
  buildMockConflictPack,
  buildMockMaterialPack,
  buildMockResultVersion,
  mockAmbiguousTaskInput,
  mockIncompleteTaskInput,
  mockTaskInput,
} from "../src/index.js";

describe("mock fixtures 符合公共校验", () => {
  it("资料包与结果版本通过 schema 与一致性检查", () => {
    expect(() => parseMaterialPack(buildMockMaterialPack("t1"))).not.toThrow();
    expect(() => parseMaterialPack(buildMockConflictPack("t1"))).not.toThrow();
    expect(() => parseResultVersion(buildMockResultVersion())).not.toThrow();
  });

  it("任务输入样例合法", () => {
    for (const i of [mockTaskInput, mockIncompleteTaskInput, mockAmbiguousTaskInput]) {
      expect(MarketingTaskInputSchema.safeParse(i).success).toBe(true);
    }
    expect(MarketingTaskInputSchema.safeParse({}).success).toBe(false);
  });

  it("所有 mock 数据都带 mock 标记", () => {
    const pack = buildMockMaterialPack("t1");
    expect(pack.isMock).toBe(true);
    expect(pack.facts.every((f) => f.source.origin === "mock")).toBe(true);
    expect(pack.images.every((i) => i.access.kind === "mock_placeholder")).toBe(true);
  });
});

describe("一致性检查能发现错误", () => {
  it("引用不存在的事实/图片", () => {
    const rv = buildMockResultVersion();
    rv.article = ArticleSchema.parse({
      ...rv.article,
      blocks: [{ type: "paragraph", text: "x", factIds: ["nope"] }, { type: "image", imageId: "nope", caption: "c", placementReason: "r" }],
    });
    const issues = checkResultVersion(rv);
    expect(issues.some((s) => s.includes("不存在的事实"))).toBe(true);
    expect(issues.some((s) => s.includes("不存在的图片"))).toBe(true);
  });

  it("未解决冲突必须 blocked", () => {
    const rv = buildMockResultVersion();
    rv.materialPack = buildMockConflictPack("t1");
    expect(checkResultVersion(rv).some((s) => s.includes("blocked"))).toBe(true);
  });

  it("mock 来源却声明非 mock", () => {
    const pack = buildMockMaterialPack("t1");
    pack.isMock = false;
    expect(checkMaterialPack(pack).length).toBeGreaterThan(0);
  });

  it("配置引用必须属于该型号", () => {
    const pack = buildMockMaterialPack("t1");
    pack.facts[0]!.configurationIds = ["other-config"];
    expect(checkMaterialPack(pack).some((s) => s.includes("不存在的配置"))).toBe(true);
  });
});
