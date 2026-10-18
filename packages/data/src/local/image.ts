/**
 * 读取本地图片文件。
 */
import type { ImageRecord, ImageContent } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";
import type { LocalKbConfig } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * 读取本地图片文件，返回字节和 MIME 类型。
 * 只接受 access.kind="local_file"，并限制在知识库根目录内，防止路径穿越。
 */
export function readLocalImage(image: ImageRecord, cfg: LocalKbConfig): ImageContent {
  if (image.access.kind !== "local_file") {
    throw new DataServiceError("invalid_data", `图片 ${image.imageId} 的来源与访问方式不匹配`, "local");
  }
  const root = path.resolve(cfg.rootDir);
  const fullPath = path.resolve(root, image.access.path);
  if (!fullPath.startsWith(root + path.sep)) {
    throw new DataServiceError("invalid_data", `图片 ${image.imageId} 的路径不在知识库目录内`, "local");
  }
  if (!fs.existsSync(fullPath)) {
    throw new DataServiceError("not_found", `图片文件不存在: ${path.basename(fullPath)}`, "local");
  }
  try {
    const bytes = fs.readFileSync(fullPath);
    return { bytes, mimeType: image.mimeType ?? getMimeType(path.extname(fullPath)) };
  } catch (e) {
    throw new DataServiceError("invalid_data", `读取图片失败: ${e instanceof Error ? e.message : String(e)}`, "local");
  }
}

/** 根据文件扩展名返回 MIME 类型。 */
function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}
