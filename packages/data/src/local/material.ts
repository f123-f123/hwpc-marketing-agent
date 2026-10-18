/**
 * 构建本地知识库的 MaterialPack（映射到公共契约字段）。
 *
 * 事实与图片的解析复用 ../local.ts 中已经验证过的解析器，避免出现第二套口径：
 * - parseFacts：把产品事实.md 的段落拆成 FactRecord（含 source / qualifiers / reviewStatus）。
 * - parseImages：把图片索引.csv 映射成 ImageRecord（含 access=local_file、role、来源）。
 * 本文件只负责“取哪个型号、哪些配置、哪些图片”，不做事实改写。
 */
import type { MaterialPack, MaterialRequest, ProductIdentity, ImageRecord, SourceRef } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";
import type { LocalProductModel, LocalKbConfig } from "../types.js";
import { extractConfigurations } from "./parser.js";
import { parseFacts, parseImages, stableId } from "../local.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** 把扫描结果映射为公共契约的产品身份。 */
export function toProductIdentity(model: LocalProductModel): ProductIdentity {
  const configurations = extractConfigurations(model.factPath, model.productId).map((c) => ({
    configurationId: c.configurationId,
    label: c.label,
    attributes: c.attributes,
  }));
  return {
    productId: model.productId,
    category: "pc",
    family: model.dirName,
    model: model.displayName,
    aliases: [...new Set([model.dirName, model.displayName])],
    configurations,
    origin: "local",
  };
}

/**
 * 从本地产品模型构建 MaterialPack。
 * request.product 必须明确到型号；配置不合法时直接报错，不静默降级为“全配置”。
 */
export function buildLocalMaterialPack(model: LocalProductModel, cfg: LocalKbConfig, request: MaterialRequest): MaterialPack {
  const product = toProductIdentity(model);

  const wanted = request.product.configurationId;
  if (wanted && !product.configurations.some((c) => c.configurationId === wanted)) {
    throw new DataServiceError("not_found", `产品 ${product.model} 没有配置 ${wanted}`, "local");
  }

  const locator = path.relative(cfg.rootDir, model.factPath).replaceAll("\\", "/");
  const source: SourceRef = { origin: "local", title: `${product.model} 产品事实`, locator };
  const markdown = fs.readFileSync(model.factPath, "utf8");
  const facts = parseFacts(markdown, product, source);

  // 配置限定：没有指定配置时保留全部事实（事实自带 configurationIds / qualifiers），
  // 指定配置时只保留通用事实与该配置的事实。
  const scoped = wanted ? facts.filter((f) => f.configurationIds.length === 0 || f.configurationIds.includes(wanted)) : facts;

  const images = readImages(model, product, cfg);
  const gaps: string[] = [];
  if (scoped.length === 0) gaps.push("产品事实为空");
  if (images.length === 0) gaps.push("未找到可用的型号图片");
  gaps.push("具体销售配置、当前价格及软件兼容性需另行核验");

  return {
    packId: stableId("pack", `${request.taskId}:${product.productId}`),
    taskId: request.taskId,
    products: [product],
    facts: scoped,
    images: images.slice(0, request.maxImages ?? 12),
    conflicts: [],
    gaps,
    origins: ["local"],
    isMock: false,
    createdAt: new Date().toISOString(),
  };
}

function readImages(model: LocalProductModel, product: ProductIdentity, cfg: LocalKbConfig): ImageRecord[] {
  if (!model.imageIndexPath) return [];
  let csv: string;
  try {
    csv = fs.readFileSync(model.imageIndexPath, "utf8");
  } catch {
    return [];
  }
  let parsed: ImageRecord[];
  try {
    parsed = parseImages(csv, product, model.imageIndexPath, cfg.rootDir);
  } catch {
    return [];
  }
  // 只保留磁盘上真实存在、且仍在本知识库目录内的图片，避免导出后出现死链。
  return parsed.filter((image) => {
    if (image.access.kind !== "local_file") return false;
    const target = path.resolve(cfg.rootDir, image.access.path);
    if (!target.startsWith(path.resolve(cfg.rootDir) + path.sep)) return false;
    try {
      return fs.statSync(target).isFile();
    } catch {
      return false;
    }
  });
}
