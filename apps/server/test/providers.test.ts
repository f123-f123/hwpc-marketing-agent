import { describe, expect, it } from "vitest";
import type { ImageRecord, KnowledgeLibrary, LibraryImageQuery } from "@hwpc/contracts";
import { libraryImageProvider } from "../src/page/providers.js";

const img = (imageId: string, productId: string, role: ImageRecord["role"], width: number, description: string): ImageRecord => ({
  imageId,
  productId,
  configurationIds: [],
  role,
  description,
  source: { origin: "local", title: "图片索引", locator: "P1/x/图片索引.csv" },
  access: { kind: "local_file", path: `/kb/${imageId}.png` },
  width,
  height: Math.round(width * 0.6),
});

function fakeLibrary(images: ImageRecord[], seen: LibraryImageQuery[] = []): KnowledgeLibrary {
  return {
    status: async () => ({ origin: "local", state: "connected", message: "", documents: 0, chunks: 0, images: images.length, prices: 0 }),
    search: async () => [],
    prices: async () => [],
    brief: async () => undefined,
    images: async (q) => {
      seen.push(q);
      return images.filter((i) => (q.scenesOnly ? i.productId === "kb-scene" : q.productId ? i.productId === q.productId : true));
    },
    readImage: async () => {
      throw new Error("not used");
    },
    documents: async () => [],
    document: async () => undefined,
  };
}

describe("体验页图片：本地知识库", () => {
  it("候选图优先挑够大的主视觉，不用商城缩略图", async () => {
    const lib = fakeLibrary([img("thumb", "p1", "hero", 428, "正面外观"), img("big", "p1", "color", 1220, "多彩配色外观"), img("other", "p2", "hero", 2000, "别的型号")]);
    const got = await libraryImageProvider(lib).fill({ slotId: "s", intent: "外观主视觉", product: { productId: "p1" }, roles: ["hero", "color"], status: "pending" }, { needs: [] });
    expect(got?.url).toBe("/api/library/images/big");
    expect(got?.origin).toBe("local");
    expect(got?.source?.locator).toMatch(/图片索引/);
  });

  it("开场图按用途找场景素材，并注明是示意图", async () => {
    const seen: LibraryImageQuery[] = [];
    const lib = fakeLibrary([img("scene", "kb-scene", "scene", 393, "长续航移动办公场景")], seen);
    const got = await libraryImageProvider(lib).fill(
      { slotId: "s", intent: "使用场景", roles: ["scene"], status: "pending" },
      { needs: [{ entryId: "e", key: "task", value: "出差、通勤时带着用", status: "known", hard: false, origin: { by: "user", turn: 1 }, setAtVersion: 1, history: [] }] },
    );
    expect(seen[0]).toMatchObject({ scenesOnly: true });
    expect(seen[0]!.query).toMatch(/移动办公/);
    expect(got?.caption).toMatch(/示意图/);
  });

  it("该型号没有图就返回空，不拿别的型号凑数", async () => {
    const lib = fakeLibrary([img("other", "p2", "hero", 2000, "别的型号")]);
    expect(await libraryImageProvider(lib).fill({ slotId: "s", intent: "外观", product: { productId: "p1" }, roles: [], status: "pending" }, { needs: [] })).toBeNull();
  });
});

describe("体验页开场图", () => {
  it("首选机型有宽幅大图就用它；只有方图缩略图时退回到场景图", async () => {
    const withWide = fakeLibrary([img("kv", "p1", "hero", 1920, "KV"), img("scene", "kb-scene", "scene", 984, "移动办公")]);
    const slot = { slotId: "h", intent: "与“出差”相符的使用场景", product: { productId: "p1" }, roles: ["scene", "hero"] as ImageRecord["role"][], status: "pending" as const };
    expect((await libraryImageProvider(withWide).fill(slot, { needs: [] }))?.url).toBe("/api/library/images/kv");
    const onlyThumbs = fakeLibrary([img("thumb", "p1", "hero", 428, "正面"), img("scene", "kb-scene", "scene", 984, "移动办公")]);
    expect((await libraryImageProvider(onlyThumbs).fill(slot, { needs: [] }))?.url).toBe("/api/library/images/scene");
  });
});
