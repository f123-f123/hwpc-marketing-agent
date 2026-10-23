import { describe, expect, it, vi } from "vitest";
import { MaterialPackSchema, DeviceKnowledgeSnapshotSchema } from "@hwpc/contracts";
import { createDataService, createDeviceKnowledgeService } from "../src/index.js";
import { createImaDataService } from "../src/ima.js";
import { createLocalDataService, defaultLocalRoot } from "../src/local.js";
import { createLocalDataService as createLocalCatalog } from "../src/local/index.js";

const service = createDataService({ mode: "auto", ima: { kbName: "指定知识库" } });

describe("本地真实资料", () => {
  it("在未配置 ima 时选择本地并保留精确来源", async () => {
    const status = await service.getStatus();
    expect(status.find(s => s.origin === "ima")?.state).toBe("not_configured");
    expect(status.find(s => s.origin === "local")?.state).toBe("connected");
    const result = await service.searchProducts("MateBook Pro");
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.ambiguous).toBe(true);
    const product = result.candidates.find(p => p.model === "HUAWEI MateBook Pro")!;
    const pack = MaterialPackSchema.parse(await service.getMaterialPack({ taskId: "local-check", product: { productId: product.productId }, maxImages: 2 }));
    expect(pack.isMock).toBe(false);
    expect(pack.origins).toEqual(["local"]);
    expect(pack.facts.some(f => f.value.includes("HarmonyOS 6.1") && f.source.officialUrl?.includes("huawei.com"))).toBe(true);
    expect(pack.images.length).toBeGreaterThan(0);
    const image = await service.readImage(pack.images[0]!);
    expect(image.mimeType).toMatch(/^image\//);
    expect(image.bytes.length).toBeGreaterThan(100);
  });

  it("缺乏成对设备证据时不声称组合可用", async () => {
    const product = (await service.searchProducts("HUAWEI MateBook Pro S")).candidates[0]!;
    const knowledge = DeviceKnowledgeSnapshotSchema.parse(await createDeviceKnowledgeService(service).getKnowledge([{ productId: product.productId }]));
    expect(knowledge.products[0]?.origin).toBe("local");
    expect(knowledge.relations).toEqual([]);
    expect(knowledge.capabilities.filter(c => c.support === "supported").every(c => c.evidence.length > 0)).toBe(true);
  });
});

describe("ima 协议模拟", () => {
  it("搜索索引为空时分页浏览目录并读取原文", async () => {
    const original = globalThis.fetch;
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://example.test/facts.md") return new Response("# HUAWEI MateBook Pro - 产品事实\n## 操作系统\nHarmonyOS 6.1", { status: 200 });
      const method = String(url).split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      const data = method === "search_knowledge_base" ? { info_list: [{ id: "kb", name: "测试库" }], is_end: true }
        : method === "search_knowledge" ? { info_list: [], is_end: true }
        : method === "get_knowledge_list" ? body.folder_id
          ? { knowledge_list: [{ media_id: "facts", title: "产品事实.md" }], is_end: true }
          : { knowledge_list: [{ media_id: "folder", title: "HUAWEI MateBook Pro" }], is_end: true }
        : { url_info: { url: "https://example.test/facts.md" }, media_type: 1 };
      return new Response(JSON.stringify({ code: 0, msg: "success", data }), { status: 200 });
    });
    vi.stubGlobal("fetch", fake);
    try {
      const ima = createImaDataService({ clientId: "test", apiKey: "test", kbName: "测试库" }, createLocalDataService(defaultLocalRoot()));
      expect((await ima.getStatus())[0]?.state).toBe("connected");
      const product = (await ima.searchProducts("HUAWEI MateBook Pro")).candidates[0]!;
      expect(product.origin).toBe("ima");
      const pack = await ima.getMaterialPack({ taskId: "test-task", product: { productId: product.productId } });
      expect(pack.origins).toEqual(["ima"]);
      expect(pack.facts.some(f => f.value === "HarmonyOS 6.1" && f.source.locator === "HUAWEI MateBook Pro/产品事实.md")).toBe(true);
      expect(fake.mock.calls.some(call => String(call[0]).endsWith("get_knowledge_list"))).toBe(true);
    } finally { vi.stubGlobal("fetch", original); }
  });
});

describe("auto 模式按来源分发", () => {
  it("ima 已连接时，本地型号的任务与本地图片仍走本地，不送去 ima", async () => {
    const original = globalThis.fetch;
    const fake = vi.fn(async (url: string | URL | Request) => {
      const method = String(url).split("/").at(-1);
      const data = method === "search_knowledge_base" ? { info_list: [{ kb_id: "kb", kb_name: "指定知识库" }], is_end: true } : { knowledge_list: [], info_list: [], is_end: true };
      return new Response(JSON.stringify({ code: 0, msg: "success", data }), { status: 200 });
    });
    vi.stubGlobal("fetch", fake);
    try {
      const auto = createDataService({ mode: "auto", ima: { clientId: "c", apiKey: "k", kbName: "指定知识库" } });
      const localProduct = (await createLocalCatalog({ rootDir: defaultLocalRoot() }).searchProducts("HUAWEI MateBook 14（鸿蒙版）")).candidates[0]!;
      const pack = await auto.getMaterialPack({ taskId: "t", product: { productId: localProduct.productId } });
      expect(pack.origins).toEqual(["local"]);
      const image = await auto.readImage(pack.images[0]!);
      expect(image.mimeType).toMatch(/^image\//);
      expect(fake.mock.calls.some(c => /get_media_info|search_knowledge$/.test(String(c[0])))).toBe(false);
    } finally { vi.stubGlobal("fetch", original); }
  });
});

describe("local 模式不消耗 ima 调用", () => {
  it("即使配置了 ima 凭证，local 模式的状态检查也不请求 ima", async () => {
    const original = globalThis.fetch;
    const fake = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fake);
    try {
      const svc = createDataService({ mode: "local", ima: { clientId: "c", apiKey: "k", kbName: "指定知识库" } });
      const status = await svc.getStatus();
      expect(status.find((s) => s.origin === "ima")?.message).toMatch(/未启用/);
      expect(fake).not.toHaveBeenCalled();
    } finally { vi.stubGlobal("fetch", original); }
  });
});
