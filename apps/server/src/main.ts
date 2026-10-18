import { serve } from "@hono/node-server";
import { createWorkflow } from "@hwpc/agent";
import { createDataService, createDeviceKnowledgeService } from "@hwpc/data";
import { createMockAdvisorEngine, createMockKnowledgeService, mockSceneDefinitions } from "@hwpc/fixtures";
import { registeredSceneDefinitions } from "@hwpc/scenes";
import { createApp } from "./app.js";
import { loadConfig, maskSecret } from "./config.js";
import { createModelService } from "./model.js";
import { TaskManager } from "./tasks.js";
import { SessionManager } from "./sessions.js";
import { FileSessionStore } from "./store.js";
import { SceneRegistry } from "./registry.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const cfg = loadConfig();
const data = createDataService({ mode: cfg.dataMode, localKbDir: cfg.localKbDir, ima: cfg.ima });
const model = createModelService(cfg.model);
const workflow = createWorkflow({ data, model });
const lock = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../scene-lock.json", import.meta.url)), "utf8")) as Record<string, string>;
const registry = new SceneRegistry({ definitions: [...registeredSceneDefinitions, ...mockSceneDefinitions], lock });
const store = new FileSessionStore(path.resolve(process.cwd(), ".local-sessions"));

// 运行时事实：按当前真实可用的来源生成能力声明，不写死。
const statuses = await data.getStatus();
const order: string[] = cfg.dataMode === "mock" ? ["mock"] : cfg.dataMode === "auto" ? ["ima", "local"] : [cfg.dataMode];
const activeOrigin = order.find((origin) => statuses.some((s) => s.origin === origin && s.state === "connected"));
const dataOrigin = (activeOrigin ?? (cfg.dataMode === "mock" ? "mock" : "local")) as "local" | "ima" | "mock";
const modelConfigured = Boolean(cfg.model.baseUrl && cfg.model.name);

// 显式 mock 演示模式必须使用配套的 mock 知识服务，否则“模拟产品 + 真实资料规则”会得出 unknown，
// 演示链路会停在“没有可用场景”。两种模式都在快照里标注 isMock。
const knowledge = cfg.dataMode === "mock" ? createMockKnowledgeService() : createDeviceKnowledgeService(data);

const sessions = new SessionManager({
  store,
  advisor: createMockAdvisorEngine(),
  data,
  model,
  knowledge,
  registry,
  profile: "server_local",
  facts: { modelConfigured, imaConnected: activeOrigin === "ima", persistent: store.persistent },
  dataOrigin,
});
const app = createApp({ data, model, tasks: new TaskManager(workflow), sessions, dataMode: cfg.dataMode, corsOrigin: cfg.corsOrigin });

// 本服务目前没有身份认证，仅绑定本机回环地址，仅用于本地演示。部署到公网前必须增加访问控制。
serve({ fetch: app.fetch, port: cfg.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[server] http://127.0.0.1:${info.port}  dataMode=${cfg.dataMode}  activeDataOrigin=${dataOrigin}`);
  console.log(`[server] ima 凭证: ${cfg.ima.clientId ? `ClientID ${maskSecret(cfg.ima.clientId)}` : "未设置"}；模型: ${cfg.model.name ?? "未配置"}`);
  console.log("[server] 顾问引擎: 模拟引擎（fixtures，isMock=true）。真实模型引擎尚未接入，界面会标注模拟。");
  for (const s of statuses) console.log(`[server] 资料源 ${s.origin}: ${s.state} — ${s.message}`);
  if (!activeOrigin) console.warn(`[server] 警告：dataMode=${cfg.dataMode} 下没有已连接的资料源，检索会失败；请检查 LOCAL_KB_DIR 或 ima 凭证，或改用 DATA_SOURCE_MODE=mock 演示。`);
  if (registry.loadErrors.length) console.log(`[server] 场景注册告警 ${registry.loadErrors.length} 条：${registry.loadErrors.slice(0, 3).join("；")}`);
});
