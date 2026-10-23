import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// 从仓库根目录读取 .env（workspace 运行时 cwd 可能是 apps/server）。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env") });

/**
 * 出站代理：Node 只在启动时读取 NODE_USE_ENV_PROXY，写在 .env 里不会自动生效，这里在加载 .env 后补一次。
 * 用于本机代理只接管部分程序、Node 直连模型服务超时的情况。需要 Node 支持 http.setGlobalProxyFromEnv。
 */
function applyProxy(): string {
  if (process.env.NODE_USE_ENV_PROXY?.trim() !== "1") return "未启用";
  const proxy = process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
  if (!proxy) return "NODE_USE_ENV_PROXY=1 但未设置 HTTPS_PROXY";
  const setGlobal = (http as unknown as { setGlobalProxyFromEnv?: (env?: NodeJS.ProcessEnv) => unknown }).setGlobalProxyFromEnv;
  if (typeof setGlobal !== "function") return `当前 Node ${process.version} 不支持运行时设置代理，请在启动前设置环境变量`;
  setGlobal(process.env);
  return `已启用（${proxy}；不走代理：${process.env.NO_PROXY?.trim() || "无"}）`;
}
export const proxyStatus = applyProxy();

const opt = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export interface ServerConfig {
  port: number;
  corsOrigin: string;
  dataMode: "auto" | "mock" | "local" | "ima";
  localKbDir?: string;
  ima: { clientId?: string; apiKey?: string; kbName: string; callBudget?: number };
  model: { baseUrl?: string; apiKey?: string; name?: string; timeoutMs: number };
  /** 联网检索（可选），目前支持 tavily。 */
  webSearch: { provider?: string; baseUrl?: string; apiKey?: string; timeoutMs: number };
  auth: { secret?: string; hqInitialPassword: string; storeInitialPassword: string; secureCookie: boolean };
}

export function loadConfig(): ServerConfig {
  const mode = opt("DATA_SOURCE_MODE") ?? "auto";
  if (!["auto", "mock", "local", "ima"].includes(mode)) throw new Error(`DATA_SOURCE_MODE 不合法: ${mode}`);
  return {
    port: Number(opt("PORT") ?? 8787),
    corsOrigin: opt("CORS_ORIGIN") ?? "http://localhost:5173",
    dataMode: mode as ServerConfig["dataMode"],
    localKbDir: opt("LOCAL_KB_DIR"),
    ima: {
      clientId: opt("IMA_OPENAPI_CLIENTID"),
      apiKey: opt("IMA_OPENAPI_APIKEY"),
      kbName: opt("IMA_KB_NAME") ?? "任德耀新建华为PC知识库",
      callBudget: opt("IMA_CALL_BUDGET") ? Number(opt("IMA_CALL_BUDGET")) : undefined,
    },
    model: {
      baseUrl: opt("MODEL_BASE_URL"),
      apiKey: opt("MODEL_API_KEY"),
      name: opt("MODEL_NAME"),
      timeoutMs: Number(opt("MODEL_TIMEOUT_MS") ?? 60000),
    },
    webSearch: {
      provider: opt("WEB_SEARCH_PROVIDER"),
      baseUrl: opt("WEB_SEARCH_BASE_URL"),
      apiKey: opt("WEB_SEARCH_API_KEY"),
      timeoutMs: Number(opt("WEB_SEARCH_TIMEOUT_MS") ?? 15000),
    },
    auth: {
      secret: opt("AUTH_SECRET"),
      hqInitialPassword: opt("HQ_INITIAL_PASSWORD") ?? "hq123456",
      storeInitialPassword: opt("STORE_INITIAL_PASSWORD") ?? "store123456",
      secureCookie: opt("COOKIE_SECURE") === "true",
    },
  };
}

/** 脱敏：只显示前 4 位与长度。 */
export function maskSecret(v: string | undefined): string {
  if (!v) return "";
  return `${v.slice(0, 4)}***(${v.length})`;
}
