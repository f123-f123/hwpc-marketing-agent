/**
 * 扫描本地知识库的产品模型目录。
 */
import type { LocalKbConfig, LocalProductModel } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 扫描 P1-产品参数库/01-鸿蒙电脑 和 02-MateBook-Windows 下的产品目录。
 */
export function scanLocalModels(cfg: LocalKbConfig): LocalProductModel[] {
  const models: LocalProductModel[] = [];
  const p1 = cfg.p1Dir;
  if (!fs.existsSync(p1)) return models;

  for (const subDir of ["01-鸿蒙电脑", "02-MateBook-Windows"]) {
    const categoryDir = path.join(p1, subDir);
    if (!fs.existsSync(categoryDir)) continue;

    for (const modelDir of fs.readdirSync(categoryDir)) {
      const modelPath = path.join(categoryDir, modelDir);
      const stat = fs.statSync(modelPath);
      if (!stat.isDirectory()) continue;

      const factPath = path.join(modelPath, "产品事实.md");
      if (!fs.existsSync(factPath)) continue;

      // 从产品事实.md 标题提取产品名称和操作系统
      const factContent = fs.readFileSync(factPath, "utf-8");
      const titleMatch = factContent.match(/^#\s+(.+?)\s+-\s+产品事实/m);
      const displayName = titleMatch?.[1]?.trim() || modelDir;

      // 提取操作系统（简单规则）
      const os: string[] = [];
      if (factContent.includes("HarmonyOS")) os.push("HarmonyOS");
      if (factContent.includes("Windows")) os.push("Windows");
      if (factContent.includes("Linux")) os.push("Linux");
      if (os.length === 0) os.push("未知");

      // 生成规范化的 productId：目录名 + 分组序号，避免同名型号（鸿蒙版 / Windows 版）撞号。
      const groupTag = subDir.slice(0, 2);
      const productId = `${modelDir.toLowerCase().replace(/\s+/g, "-")}-${groupTag}`;

      models.push({
        dirName: modelDir,
        productId,
        displayName,
        os,
        factPath,
        sellPointPath: path.join(modelPath, "卖点与限制.md"),
        imageIndexPath: fs.existsSync(path.join(modelPath, "图片索引.csv"))
          ? path.join(modelPath, "图片索引.csv")
          : null,
        sourceListPath: fs.existsSync(path.join(modelPath, "来源清单.csv"))
          ? path.join(modelPath, "来源清单.csv")
          : null,
        imagesDir: fs.existsSync(path.join(modelPath, "images")) ? path.join(modelPath, "images") : null,
      });
    }
  }

  return models;
}
