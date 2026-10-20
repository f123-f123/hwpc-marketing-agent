import { serve } from "@hono/node-server";
import { createWorkflow } from "@hwpc/agent";
import { createDataService, createDeviceKnowledgeService } from "@hwpc/data";
import { createMockAdvisorEngine, createMockKnowledgeService, createMockQaEngine, mockSceneDefinitions } from "@hwpc/fixtures";
import { registeredSceneDefinitions } from "@hwpc/scenes";
import { createApp } from "./app.js";
import { loadConfig, maskSecret } from "./config.js";
import { createModelService } from "./model.js";
import { TaskManager } from "./tasks.js";
import { SessionManager } from "./sessions.js";
import { FileSessionStore } from "./store.js";
import { SceneRegistry } from "./registry.js";
import { AuthService } from "./marketing/auth.js";
import { MarketingRepo } from "./marketing/repo.js";
import { loadMasterSecret, SecretBox, TokenSigner } from "./marketing/security.js";
import { MarketingService } from "./marketing/service.js";
import { SettingsService } from "./marketing/settings.js";
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
  // 两个智能体相互独立：顾问引擎负责需求沟通与生成方案/体验页，答疑引擎只回答体验页里的提问。
  // 接入真实模型时分别替换（见 apps/server/README.md）。
  advisor: createMockAdvisorEngine(),
  qa: createMockQaEngine(),
  data,
  model,
  knowledge,
  registry,
  profile: "server_local",
  facts: { modelConfigured, imaConnected: activeOrigin === "ima", persistent: store.persistent },
  dataOrigin,
});
// 门店推文模块：数据放在 .runtime/marketing（已 gitignore），平台密钥用主密钥加密保存。
const marketingDir = path.resolve(process.cwd(), ".runtime", "marketing");
const marketingRepo = new MarketingRepo(marketingDir);
const master = loadMasterSecret(marketingDir, cfg.auth.secret);
const box = new SecretBox(master.secret);
const auth = new AuthService(marketingRepo, new TokenSigner(master.secret));
const seeded = auth.seed({ hqPassword: cfg.auth.hqInitialPassword, storePassword: cfg.auth.storeInitialPassword });
const settings = new SettingsService(marketingRepo, box, cfg.model);
const marketing = {
  auth,
  settings,
  service: new MarketingService({ repo: marketingRepo, data, settings, box, ...(cfg.localKbDir ? { localKbDir: cfg.localKbDir } : {}) }),
  secureCookie: cfg.auth.secureCookie,
};

const app = createApp({ data, model, tasks: new TaskManager(workflow), sessions, marketing, dataMode: cfg.dataMode, corsOrigin: cfg.corsOrigin });

// 推文模块已有登录鉴权；选购顾问（/api/sessions）仍无鉴权，因此只绑定本机回环地址。公网部署前需补齐访问控制、限流与 HTTPS。
serve({ fetch: app.fetch, port: cfg.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[server] http://127.0.0.1:${info.port}  dataMode=${cfg.dataMode}  activeDataOrigin=${dataOrigin}`);
  console.log(`[server] ima 凭证: ${cfg.ima.clientId ? `ClientID ${maskSecret(cfg.ima.clientId)}` : "未设置"}；模型: ${cfg.model.name ?? "未配置"}`);
  console.log("[server] 顾问引擎: 模拟引擎（fixtures，isMock=true）。真实模型引擎尚未接入，界面会标注模拟。");
  for (const s of statuses) console.log(`[server] 资料源 ${s.origin}: ${s.state} — ${s.message}`);
  if (master.generated) console.warn(`[server] 未设置 AUTH_SECRET，已生成主密钥 ${path.join(marketingDir, "master.key")}；公网部署请显式设置 AUTH_SECRET`);
  if (seeded.length) console.warn(`[server] 已创建初始账号：${seeded.join("、")}，口令见 .env 的 HQ_INITIAL_PASSWORD / STORE_INITIAL_PASSWORD（默认 hq123456 / store123456），登录后请立即修改`);
  console.log(`[server] 推文写作模型：${settings.view().model.source === "none" ? "未配置（使用模板稿），可在总部「系统设置」中填写" : `已配置（来源：${settings.view().model.source}）`}`);
  if (!activeOrigin) console.warn(`[server] 警告：dataMode=${cfg.dataMode} 下没有已连接的资料源，检索会失败；请检查 LOCAL_KB_DIR 或 ima 凭证，或改用 DATA_SOURCE_MODE=mock 演示。`);
  if (registry.loadErrors.length) console.log(`[server] 场景注册告警 ${registry.loadErrors.length} 条：${registry.loadErrors.slice(0, 3).join("；")}`);
});
