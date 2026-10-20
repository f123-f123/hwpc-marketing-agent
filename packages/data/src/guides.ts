/**
 * 平台写作指南：读取知识库 P6-营销素材库/02-平台模板 下的各平台模板。
 * 只作为“怎么写”的方法参考喂给写作模型，不作为产品事实来源。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Platform } from "@hwpc/contracts";
import { defaultLocalRoot } from "./local.js";

const GUIDE_FILE: Record<Platform, string> = {
  wechat_article: "微信公众号图文模板.md",
  xiaohongshu: "小红书图文模板.md",
  store_moments: "销售朋友圈模板.md",
  store_poster: "门店海报图文模板.md",
};

/** 找不到知识库或模板时返回 undefined（写作照常进行，只是少了参考）。 */
export async function readPlatformGuide(platform: Platform, rootDir?: string): Promise<string | undefined> {
  const file = path.join(rootDir ?? defaultLocalRoot(), "P6-营销素材库", "02-平台模板", GUIDE_FILE[platform]);
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
