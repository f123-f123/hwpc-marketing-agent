/**
 * 联网检索（可选）。用于体验页补图、答疑在知识库找不到依据时补充参考。
 *
 * 当前接入 Tavily 搜索 API（https://docs.tavily.com）：设置 WEB_SEARCH_API_KEY 后启用（WEB_SEARCH_PROVIDER 默认 tavily）。
 * WEB_SEARCH_BASE_URL 可改为代理或兼容 Tavily 请求格式的自建地址：填到 /search 为止，或只填根地址（自动补 /search）。
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

export const DEFAULT_TAVILY_URL = "https://api.tavily.com/search";

/** 检查联网检索配置；返回 undefined 表示可用，否则是不能启用的原因（用于启动日志）。 */
export function webSearchProblem(cfg: ServerConfig["webSearch"]): string | undefined {
  const provider = (cfg.provider ?? "tavily").toLowerCase();
  if (!cfg.apiKey) return cfg.baseUrl ? "已设置 WEB_SEARCH_BASE_URL，但缺少 WEB_SEARCH_API_KEY" : "未配置（WEB_SEARCH_API_KEY 为空）";
  if (provider !== "tavily") return `不支持的 WEB_SEARCH_PROVIDER=${cfg.provider}（目前只支持 tavily 及兼容其请求格式的地址）`;
  if (cfg.baseUrl && !/^https?:\/\/[^/]+/i.test(cfg.baseUrl)) return `WEB_SEARCH_BASE_URL 不是 http(s) 地址：${cfg.baseUrl}`;
  return undefined;
}

export function searchEndpoint(baseUrl?: string): string {
  if (!baseUrl) return DEFAULT_TAVILY_URL;
  const url = baseUrl.trim().replace(/\/+$/, "");
  return /\/search$/i.test(url) ? url : `${url}/search`;
}

export function createWebSearch(cfg: ServerConfig["webSearch"]): WebSearch | undefined {
  if (webSearchProblem(cfg)) return undefined;
  const key = cfg.apiKey!;
  const endpoint = searchEndpoint(cfg.baseUrl);
  return {
    provider: cfg.baseUrl ? `tavily @ ${new URL(endpoint).host}` : "tavily",
    async search(query, opts = {}) {
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      const res = await fetch(endpoint, {
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
