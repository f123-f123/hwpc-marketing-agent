/**
 * 联网检索（可选）。用于体验页补图、答疑在知识库找不到依据时补充参考。
 *
 * 当前接入 Tavily 搜索 API（https://docs.tavily.com）：设置 WEB_SEARCH_PROVIDER=tavily 与 WEB_SEARCH_API_KEY 后启用。
 * 未配置时返回 undefined，调用方只用本地知识库，界面不会出现“联网”来源。
 * 联网结果不进入事实库：图片标注“官网”或“网页”，文字只作为“仅供参考”的引用。
 */
import type { ServerConfig } from "../config.js";

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebImage {
  url: string;
  description?: string;
}

export interface WebSearch {
  readonly provider: string;
  search(query: string, opts?: { limit?: number; domains?: string[]; images?: boolean; signal?: AbortSignal }): Promise<{ hits: WebHit[]; images: WebImage[] }>;
}

/** 华为官方域名：只有这些来源的图片标为“官网”。 */
export const OFFICIAL_DOMAINS = ["consumer.huawei.com", "www.vmall.com", "vmall.com", "huawei.com"];
const OFFICIAL_IMAGE_HOST = /(^|\.)(huawei\.com|vmall\.com|vmallres\.com|hicloud\.com)$/i;

export const isOfficialUrl = (url: string): boolean => {
  try {
    return OFFICIAL_IMAGE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

export function createWebSearch(cfg: ServerConfig["webSearch"]): WebSearch | undefined {
  if (cfg.provider !== "tavily" || !cfg.apiKey) return undefined;
  const key = cfg.apiKey;
  return {
    provider: "tavily",
    async search(query, opts = {}) {
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: opts.limit ?? 5,
          include_images: Boolean(opts.images),
          include_image_descriptions: Boolean(opts.images),
          ...(opts.domains?.length ? { include_domains: opts.domains } : {}),
        }),
      });
      if (!res.ok) throw new Error(`联网检索返回 HTTP ${res.status}`);
      const body = (await res.json()) as {
        results?: { title?: string; url?: string; content?: string }[];
        images?: (string | { url?: string; description?: string })[];
      };
      const hits = (body.results ?? []).flatMap((r) => (r.url ? [{ title: r.title ?? r.url, url: r.url, snippet: (r.content ?? "").slice(0, 400) }] : []));
      const images = (body.images ?? []).flatMap((im) => {
        const url = typeof im === "string" ? im : im.url;
        if (!url?.startsWith("https://")) return [];
        const description = typeof im === "string" ? undefined : im.description;
        return [{ url, ...(description ? { description } : {}) }];
      });
      return { hits, images };
    },
  };
}
