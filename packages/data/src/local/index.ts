/**
 * local 模式：读取本地知识库（P1-产品参数库）。
 *
 * 目录结构（rootDir = 知识库根，含 P1-产品参数库）：
 *   <rootDir>/P1-产品参数库/01-鸿蒙电脑/<型号>/产品事实.md
 *   <rootDir>/P1-产品参数库/02-MateBook-Windows/<型号>/产品事实.md
 *   <rootDir>/P7-常见问题库/...
 *
 * 构造时不抛错：目录缺失或结构不符通过 getStatus 如实报告，服务端仍可启动并提示。
 */
import type { DataService, SourceStatus, ProductSearchResult, ProductIdentity, MaterialPack, ImageContent, ImageRecord, MaterialRequest } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";
import type { LocalKbConfig, LocalProductModel } from "../types.js";
import { scanLocalModels } from "./scanner.js";
import { buildLocalMaterialPack, toProductIdentity } from "./material.js";
import { readLocalImage } from "./image.js";
import { searchResult } from "../local.js";
import * as path from "node:path";

export interface LocalDataServiceOptions {
  /** 知识库根目录（包含 P1-产品参数库）。 */
  rootDir: string;
}

/** 创建 local 模式的 DataService。 */
export function createLocalDataService(opts: LocalDataServiceOptions): DataService {
  const rootDir = path.resolve(opts.rootDir);
  const cfg: LocalKbConfig = {
    rootDir,
    p1Dir: path.join(rootDir, "P1-产品参数库"),
    p7Dir: path.join(rootDir, "P7-常见问题库"),
  };

  let models: LocalProductModel[] | undefined;
  const load = (): LocalProductModel[] => {
    if (models) return models;
    try {
      models = scanLocalModels(cfg);
    } catch {
      models = [];
    }
    return models;
  };
  const products = (): ProductIdentity[] => load().map(toProductIdentity);

  return {
    async getStatus(): Promise<SourceStatus[]> {
      const list = load();
      return [
        {
          origin: "local",
          state: list.length > 0 ? "connected" : "error",
          enabled: true,
          message: list.length > 0 ? `本地知识库可读，共 ${list.length} 个产品型号` : `本地知识库目录不可读或结构不符：${rootDir}`,
          local: { rootConfigured: true, productCount: list.length },
          lastCheckedAt: new Date().toISOString(),
        },
      ];
    },

    async searchProducts(query: string): Promise<ProductSearchResult> {
      return searchResult(query, products());
    },

    async getMaterialPack(request: MaterialRequest): Promise<MaterialPack> {
      const model = load().find((m) => m.productId === request.product.productId);
      if (!model) {
        throw new DataServiceError("not_found", `本地知识库没有型号 ${request.product.productId}`, "local");
      }
      return buildLocalMaterialPack(model, cfg, request);
    },

    async readImage(image: ImageRecord): Promise<ImageContent> {
      return readLocalImage(image, cfg);
    },
  };
}
