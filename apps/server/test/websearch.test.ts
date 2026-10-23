import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSearch, searchEndpoint, webSearchProblem } from "../src/web/search.js";

const base = { timeoutMs: 5000 };
const original = globalThis.fetch;
afterEach(() => vi.stubGlobal("fetch", original));

describe("联网检索配置", () => {
  it("只填 Key 即按 Tavily 默认地址启用；可用 WEB_SEARCH_BASE_URL 改地址", async () => {
    expect(searchEndpoint()).toBe("https://api.tavily.com/search");
    expect(searchEndpoint("https://search.example.com/")).toBe("https://search.example.com/search");
    expect(searchEndpoint("https://search.example.com/v1/search")).toBe("https://search.example.com/v1/search");

    const fake = vi.fn(async () => new Response(JSON.stringify({ results: [{ title: "页", url: "https://consumer.huawei.com/a", content: "摘要" }], images: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fake);
    const web = createWebSearch({ ...base, apiKey: "k", baseUrl: "https://search.example.com" })!;
    expect(web).toBeDefined();
    const r = await web.search("MateBook");
    expect(r.hits[0]?.url).toBe("https://consumer.huawei.com/a");
    expect(String((fake.mock.calls[0] as unknown[])[0])).toBe("https://search.example.com/search");
  });

  it("配置不完整或不支持时不启用，并给出原因", () => {
    expect(createWebSearch({ ...base })).toBeUndefined();
    expect(webSearchProblem({ ...base, baseUrl: "https://x.example" })).toMatch(/缺少 WEB_SEARCH_API_KEY/);
    expect(webSearchProblem({ ...base, apiKey: "k", provider: "bing" })).toMatch(/不支持/);
    expect(webSearchProblem({ ...base, apiKey: "k", baseUrl: "search.example.com" })).toMatch(/不是 http/);
    expect(webSearchProblem({ ...base, apiKey: "k", provider: "tavily" })).toBeUndefined();
  });
});
