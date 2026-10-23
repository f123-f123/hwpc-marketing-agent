import { afterEach, describe, expect, it, vi } from "vitest";
import { MaterialPackSchema } from "@hwpc/contracts";
import { createImaDataService } from "../src/ima.js";
import { createLocalDataService, defaultLocalRoot } from "../src/local.js";

/**
 * 按 ima 官方接口文档（ima-skills 1.1.10 knowledge-base/references/api.md）与赛题手册实测结论模拟共享知识库：
 * - search_knowledge_base 实测返回 kb_id / kb_name（文档写 id / name）；
 * - get_knowledge_list 同时返回文件（media_id / title）与文件夹（folder_id / name）；
 * - 型号资料在 P1-产品参数库 下，事实原文文件名为 article.md；图片在型号目录的 images 子目录，文件名不含型号。
 */
type Node = { folder: string; name: string; children: Node[] } | { media: string; title: string; body: string | Uint8Array; type?: string };
const folder = (id: string, name: string, children: Node[]): Node => ({ folder: id, name, children });
const file = (id: string, title: string, body: string | Uint8Array, type?: string): Node => ({ media: id, title, body, type });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const tree: Node[] = [
  folder("f-rule", "00-建库规范", [file("m-rule", "README.md", "# 建库规范")]),
  folder("f-p1", "P1-产品参数库", [
    folder("f-index", "00-全库横向索引", [file("m-matrix", "尺寸重量矩阵.csv", "型号,厚度")]),
    folder("f-g1", "01-鸿蒙电脑", [
      folder("f-mb14", "HUAWEI MateBook 14", [
        file("m-mb14", "article.md", "# HUAWEI MateBook 14（鸿蒙版） - 产品事实\n## 操作系统\nHarmonyOS 6"),
        file("m-mb14-sell", "卖点与限制.md", "# HUAWEI MateBook 14（鸿蒙版） - 卖点与限制\n轻薄"),
        file("m-mb14-idx", "图片索引.csv", [
          "﻿文件名,产品型号,来源页面,原始图片URL,官网图片说明,宽度,高度,建议用途",
          "hwpc_matebook-14-harmonyos_原野绿多彩配色_04.png,HUAWEI MateBook 14（鸿蒙版）,https://consumer.huawei.com/cn/x/,https://consumer.huawei.com/img/green.png,原野绿多彩配色,817,892,按画面含义用于对应段落",
          "hwpc_matebook-14-harmonyos_未上传_09.png,HUAWEI MateBook 14（鸿蒙版）,https://consumer.huawei.com/cn/x/,,未上传的图,1,1,",
        ].join("\n"), "text/csv"),
        folder("f-mb14-img", "images", [
          file("m-img-green", "hwpc_matebook-14-harmonyos_原野绿多彩配色_04.png", PNG, "image/png"),
          file("m-img-extra", "没有登记在索引里的图.png", PNG, "image/png"),
        ]),
      ]),
    ]),
    folder("f-g2", "02-MateBook-Windows", [
      folder("f-ultra", "MateBook 14 酷睿 Ultra", [
        file("m-ultra", "article.md", "# HUAWEI MateBook 14 酷睿 Ultra - 产品事实\n## 操作系统\nWindows 11"),
      ]),
    ]),
  ]),
  folder("f-p6", "P6-营销素材库", [file("m-p6", "HUAWEI MateBook 14 推文案例.md", "# 案例")]),
];

function find(nodes: Node[], pred: (n: Node) => boolean): Node | undefined {
  for (const n of nodes) {
    if (pred(n)) return n;
    if ("folder" in n) { const hit = find(n.children, pred); if (hit) return hit; }
  }
  return undefined;
}

/** 官方文档中 get_knowledge_list 的 current_path：从根到当前目录的面包屑。 */
function trail(target: Node, nodes: Node[] = tree, path: { folder_id: string; name: string }[] = []): { folder_id: string; name: string }[] {
  for (const n of nodes) {
    if (!("folder" in n)) continue;
    const here = [...path, { folder_id: n.folder, name: n.name }];
    if (n === target) return here;
    const deeper = trail(target, n.children, here);
    if (deeper.length) return deeper;
  }
  return [];
}

function fakeIma(opts: { searchHits?: (query: string) => object[]; currentPath?: boolean; wrapped?: boolean } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://files.test/")) {
      const n = find(tree, x => "media" in x && x.media === u.slice("https://files.test/".length));
      if (!n || !("media" in n)) return new Response("not found", { status: 404 });
      return new Response(n.body, { status: 200, headers: { "content-type": n.type ?? "text/markdown" } });
    }
    const method = u.split("/").at(-1);
    const body = JSON.parse(String(init?.body ?? "{}"));
    let data: object;
    if (method === "search_knowledge_base") data = { info_list: [{ kb_id: "kb1", kb_name: "测试库" }], is_end: true };
    else if (method === "search_knowledge") data = { info_list: opts.searchHits?.(body.query) ?? [], is_end: true };
    else if (method === "get_knowledge_list") {
      const parent = body.folder_id && body.folder_id !== "kb1" ? find(tree, x => "folder" in x && x.folder === body.folder_id) : undefined;
      const atRoot = !parent && !(opts.wrapped && body.folder_id === "f-wrap");
      // 实测：根目录只有一个与知识库同名的文件夹，以 media_id + title + media_type 99 返回
      const children = parent && "folder" in parent ? parent.children : tree;
      data = {
        knowledge_list: opts.wrapped && atRoot
          ? [{ media_id: "f-wrap", title: "测试库", parent_folder_id: "kb1", media_type: 99 }]
          : children.map(c => ("folder" in c ? (opts.wrapped ? { media_id: c.folder, title: c.name, media_type: 99 } : { folder_id: c.folder, name: c.name }) : { media_id: c.media, title: c.title, media_type: 7 })),
        is_end: true, next_cursor: "",
        ...(opts.currentPath && parent ? { current_path: [{ folder_id: "kb1", name: "测试库" }, ...trail(parent)] } : {}),
      };
    } else if (method === "get_media_info") data = { media_type: 7, url_info: { url: `https://files.test/${body.media_id}`, headers: {} } };
    else return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ code: 0, msg: "success", data }), { status: 200 });
  });
}

const original = globalThis.fetch;
afterEach(() => vi.stubGlobal("fetch", original));
const make = () => createImaDataService({ clientId: "test-client-id", apiKey: "test", kbName: "测试库" }, createLocalDataService(defaultLocalRoot()));

describe("ima 共享知识库（按官方字段与手册实测结构）", () => {
  it("search_knowledge_base 返回 kb_id / kb_name 时能识别指定知识库", async () => {
    vi.stubGlobal("fetch", fakeIma());
    const status = (await make().getStatus())[0]!;
    expect(status.state).toBe("connected");
    expect(status.knowledgeBase?.found).toBe(true);
    expect(JSON.stringify(status)).not.toContain("test-client-id");
  });

  it("搜索为空时按目录进入 P1，读取 article.md，并取到同型号目录下登记过的图片", async () => {
    const fake = fakeIma();
    vi.stubGlobal("fetch", fake);
    const ima = make();
    const found = await ima.searchProducts("HUAWEI MateBook 14（鸿蒙版）");
    expect(found.candidates.map(c => c.model)).toEqual(["HUAWEI MateBook 14（鸿蒙版）"]);
    expect(found.candidates[0]!.origin).toBe("ima");

    const pack = MaterialPackSchema.parse(await ima.getMaterialPack({ taskId: "t", product: { productId: found.candidates[0]!.productId } }));
    expect(pack.origins).toEqual(["ima"]);
    const os = pack.facts.find(f => f.value === "HarmonyOS 6");
    expect(os?.source.origin).toBe("ima");
    expect(os?.source.locator).toBe("P1-产品参数库/01-鸿蒙电脑/HUAWEI MateBook 14/article.md");

    expect(pack.images).toHaveLength(1);
    const img = pack.images[0]!;
    expect(img.description).toBe("原野绿多彩配色");
    expect(img.source.origin).toBe("ima");
    expect(img.source.officialUrl).toBe("https://consumer.huawei.com/img/green.png");
    expect(img.source.locator).toBe("P1-产品参数库/01-鸿蒙电脑/HUAWEI MateBook 14/图片索引.csv");
    expect(img.access).toMatchObject({ kind: "ima_media", mediaId: "m-img-green" });
    expect(pack.gaps.some(g => /图片/.test(g))).toBe(false);

    const bytes = await ima.readImage(img);
    expect(bytes.mimeType).toBe("image/png");
    expect(bytes.bytes.length).toBe(PNG.length);

    // P6 等其他板块不参与型号事实检索
    const browsed = fake.mock.calls.filter(c => String(c[0]).endsWith("get_knowledge_list")).map(c => JSON.parse(String(c[1]?.body)).folder_id);
    expect(browsed).not.toContain("f-p6");
  });

  it("搜索命中 article.md 时直接定位型号目录，并按标题核对型号，不混用相近型号", async () => {
    vi.stubGlobal("fetch", fakeIma({
      currentPath: true,
      searchHits: q => (/酷睿/.test(q)
        ? [{ media_id: "m-mb14", title: "article.md", parent_folder_id: "f-mb14" }, { media_id: "m-ultra", title: "article.md", parent_folder_id: "f-ultra" }]
        : []),
    }));
    const ima = make();
    const found = await ima.searchProducts("HUAWEI MateBook 14 酷睿 Ultra");
    expect(found.candidates.map(c => c.model)).toEqual(["HUAWEI MateBook 14 酷睿 Ultra"]);
    const pack = await ima.getMaterialPack({ taskId: "t", product: { productId: found.candidates[0]!.productId } });
    expect(pack.facts.find(f => f.value === "Windows 11")?.source.locator).toBe("P1-产品参数库/02-MateBook-Windows/MateBook 14 酷睿 Ultra/article.md");
    expect(pack.facts.some(f => f.value === "HarmonyOS 6")).toBe(false);
    expect(pack.gaps.some(g => /图片/.test(g))).toBe(true);
  });
});

const imaCalls = (fake: ReturnType<typeof fakeIma>, method?: string) =>
  fake.mock.calls.filter(c => String(c[0]).startsWith("https://ima.qq.com/") && (!method || String(c[0]).endsWith(`/${method}`))).length;

describe("ima 调用次数控制（共享知识库每个账号调用次数有限）", () => {
  it("空查询按目录列出型号目录，供总部选品；名称取本地同名目录的正式型号", async () => {
    const fake = fakeIma();
    vi.stubGlobal("fetch", fake);
    const list = await make().searchProducts("");
    expect(list.candidates.map(c => c.model).sort()).toEqual(["HUAWEI MateBook 14 酷睿 Ultra", "HUAWEI MateBook 14（鸿蒙版）"]);
    expect(list.candidates.every(c => c.origin === "ima")).toBe(true);
    // 列目录不逐个下载原文
    expect(imaCalls(fake, "get_media_info")).toBe(0);
  });

  it("原文与图片读取后缓存，重复生成、重复预览不再消耗调用", async () => {
    const fake = fakeIma();
    vi.stubGlobal("fetch", fake);
    const ima = make();
    const product = (await ima.searchProducts("HUAWEI MateBook 14（鸿蒙版）")).candidates[0]!;
    const pack = await ima.getMaterialPack({ taskId: "t1", product: { productId: product.productId } });
    await ima.readImage(pack.images[0]!);
    const before = imaCalls(fake);
    const again = await ima.getMaterialPack({ taskId: "t2", product: { productId: product.productId } });
    await ima.readImage(again.images[0]!);
    await ima.readImage(again.images[0]!);
    await ima.getStatus();
    expect(imaCalls(fake)).toBe(before);
  });

  it("达到本进程调用上限后停止请求 ima，并在状态中说明", async () => {
    const fake = fakeIma();
    vi.stubGlobal("fetch", fake);
    const ima = createImaDataService({ clientId: "test-client-id", apiKey: "test", kbName: "测试库", callBudget: 2 }, createLocalDataService(defaultLocalRoot()));
    await expect(ima.searchProducts("HUAWEI MateBook 14（鸿蒙版）")).rejects.toThrow(/上限/);
    expect(imaCalls(fake)).toBe(2);
    const status = (await ima.getStatus())[0]!;
    expect(status.message).toMatch(/2/);
  });
});

describe("ima 实测目录结构", () => {
  it("根目录只有一个同名包装文件夹（media_type 99）时，向下找到 P1 并取到资料与图片", async () => {
    const fake = fakeIma({ wrapped: true });
    vi.stubGlobal("fetch", fake);
    const ima = make();
    const list = await ima.searchProducts("");
    expect(list.candidates.map(c => c.model).sort()).toEqual(["HUAWEI MateBook 14 酷睿 Ultra", "HUAWEI MateBook 14（鸿蒙版）"]);
    const product = list.candidates.find(c => /鸿蒙/.test(c.model))!;
    const pack = await ima.getMaterialPack({ taskId: "t", product: { productId: product.productId } });
    expect(pack.facts.find(f => f.value === "HarmonyOS 6")?.source.locator).toBe("测试库/P1-产品参数库/01-鸿蒙电脑/HUAWEI MateBook 14/article.md");
    expect(pack.images).toHaveLength(1);
    const found = await ima.searchProducts("HUAWEI MateBook 14 酷睿 Ultra");
    expect(found.candidates.map(c => c.model)).toEqual(["HUAWEI MateBook 14 酷睿 Ultra"]);
  });
});
