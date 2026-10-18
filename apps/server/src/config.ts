import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// 从仓库根目录读取 .env（workspace 运行时 cwd 可能是 apps/server）。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env") });

const opt = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};

export interface ServerConfig {
  port: number;
  corsOrigin: string;
  dataMode: "auto" | "mock" | "local" | "ima";
  localKbDir?: string;
  ima: { clientId?: string; apiKey?: string; kbName: string };
  model: { baseUrl?: string; apiKey?: string; name?: string; timeoutMs: number };
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
    },
    model: {
      baseUrl: opt("MODEL_BASE_URL"),
      apiKey: opt("MODEL_API_KEY"),
      name: opt("MODEL_NAME"),
      timeoutMs: Number(opt("MODEL_TIMEOUT_MS") ?? 60000),
    },
  };
}

/** 脱敏：只显示前 4 位与长度。 */
export function maskSecret(v: string | undefined): string {
  if (!v) return "";
  return `${v.slice(0, 4)}***(${v.length})`;
}
