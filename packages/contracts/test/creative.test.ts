import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CREATIVE_CATALOG, PostStyleSchema, StyleChoiceSchema, pickStyles, platformStylePool, visualById, voiceById } from "../src/index.js";

const skillFile = fileURLToPath(new URL("../../../../skills/hwpc-creative-studio/references/presets.json", import.meta.url));
const appFile = fileURLToPath(new URL("../src/creative-presets.json", import.meta.url));

describe("创作规范库", () => {
  it("加载 12 种视觉、10 种语言、8 类内容规格、16 组预设，引用完整", () => {
    expect([CREATIVE_CATALOG.visuals.length, CREATIVE_CATALOG.voices.length, CREATIVE_CATALOG.formats.length, CREATIVE_CATALOG.presets.length]).toEqual([12, 10, 8, 16]);
    for (const p of ["wechat_article", "xiaohongshu", "store_moments", "store_poster"] as const) {
      const pool = platformStylePool(p);
      expect(pool.voices.length).toBeGreaterThanOrEqual(3);
      expect(pool.visuals.length).toBeGreaterThanOrEqual(2);
      expect(pool.voices.every((id) => voiceById(id))).toBe(true);
      expect(pool.visuals.every((id) => visualById(id))).toBe(true);
    }
  });

  it.skipIf(!existsSync(skillFile))("应用副本与 skills 目录中的规范库一致（不一致时运行 npm run sync:creative）", () => {
    expect(JSON.parse(readFileSync(appFile, "utf8"))).toEqual(JSON.parse(readFileSync(skillFile, "utf8")));
  });

  it("同一批版本的语言风格互不相同；不同门店拿到不同组合；重新生成换一批", () => {
    const a = pickStyles({ platform: "xiaohongshu", audience: "经常出差的职场人", seed: "store001:c1:xiaohongshu", round: 0, n: 3 });
    expect(new Set(a.map((s) => s.voice)).size).toBe(3);
    expect(a.every((s) => PostStyleSchema.safeParse(s).success)).toBe(true);
    const seeds = Array.from({ length: 8 }, (_, i) => JSON.stringify(pickStyles({ platform: "xiaohongshu", audience: "经常出差的职场人", seed: `store00${i}:c1:xiaohongshu`, round: 0, n: 3 })));
    expect(new Set(seeds).size).toBeGreaterThan(1);
    const next = pickStyles({ platform: "xiaohongshu", audience: "经常出差的职场人", seed: "store001:c1:xiaohongshu", round: 1, n: 3 });
    expect(next).not.toEqual(a);
  });

  it("贴合人群：开学季小红书优先校园视觉与亲切 / 轻快语气", () => {
    for (let i = 0; i < 6; i++) {
      const styles = pickStyles({ platform: "xiaohongshu", audience: "大一新生及家长", seed: `s${i}`, round: 0, n: 3 });
      expect(styles.some((s) => ["friendly-guide", "playful-light", "practical-checklist"].includes(s.voice))).toBe(true);
    }
  });

  it("指定的风格对全部版本生效；未知风格被拒绝", () => {
    const styles = pickStyles({ platform: "store_poster", audience: "x", seed: "s", round: 0, n: 3, choice: { visual: "gallery-dark" } });
    expect(styles.every((s) => s.visual === "gallery-dark")).toBe(true);
    expect(new Set(styles.map((s) => s.voice)).size).toBe(3);
    expect(StyleChoiceSchema.safeParse({ voice: "不存在" }).success).toBe(false);
  });
});
