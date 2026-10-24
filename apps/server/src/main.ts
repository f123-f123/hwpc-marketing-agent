import { serve } from "@hono/node-server";
import { createKbAdvisorEngine, createKbQaEngine, createWorkflow } from "@hwpc/agent";
import { createDataService, createDeviceKnowledgeService, createLocalLibrary } from "@hwpc/data";
import { createMockAdvisorEngine, createMockKnowledgeService, createMockQaEngine, mockSceneDefinitions } from "@hwpc/fixtures";
import { registeredSceneDefinitions } from "@hwpc/scenes";
import { createApp } from "./app.js";
import { loadConfig, maskSecret, proxyStatus } from "./config.js";
import { createModelService } from "./model.js";
import { TaskManager } from "./tasks.js";
import { SessionManager } from "./sessions.js";
import { FileSessionStore } from "./store.js";
import { libraryImageProvider, webImageProvider } from "./page/providers.js";
import { createWebSearch, OFFICIAL_DOMAINS, webSearchProblem } from "./web/search.js";
import { SceneRegistry } from "./registry.js";
import { AuthService } from "./marketing/auth.js";
import { MarketingRepo } from "./marketing/repo.js";
import { loadMasterSecret, SecretBox, TokenSigner } from "./marketing/security.js";
import { CatalogService } from "./marketing/catalog.js";
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

// 门店推文模块：数据放在 .runtime/marketing（已 gitignore），平台密钥用主密钥加密保存。
const marketingDir = path.resolve(process.cwd(), ".runtime", "marketing");
const marketingRepo = new MarketingRepo(marketingDir);
const master = loadMasterSecret(marketingDir, cfg.auth.secret);
const box = new SecretBox(master.secret);
const auth = new AuthService(marketingRepo, new TokenSigner(master.secret));
const seeded = auth.seed({ hqPassword: cfg.auth.hqInitialPassword, storePassword: cfg.auth.storeInitialPassword });
const settings = new SettingsService(marketingRepo, box, cfg.model);

// 知识库整库检索：型号检索卡、卖点与限制、官方公开价格、常见问题、客户场景、图片索引。
const library = createLocalLibrary(cfg.localKbDir);
const libraryStatus = await library.status();
const web = createWebSearch(cfg.webSearch);
// 大模型随“系统设置”或 .env 生效，改了设置不用重启；没有配置时顾问只用知识库规则。
const currentModel = () => settings.model().service;
const realEngines = cfg.dataMode !== "mock" && libraryStatus.state === "connected";
const productNames = new Map<string, string>();
if (realEngines) for (const p of (await data.searchProducts("").catch(() => ({ candidates: [] }))).candidates) productNames.set(p.productId, p.model);

const sessions = new SessionManager({
  store,
  // 两个智能体相互独立：顾问引擎负责需求沟通与生成方案/体验页，答疑引擎只回答体验页里的提问。
  // 两者都基于本地知识库；显式 mock 模式（或知识库不可读）才使用模拟引擎，界面会标注模拟。
  advisor: realEngines ? createKbAdvisorEngine({ library, model: currentModel }) : createMockAdvisorEngine(),
  qa: realEngines
    ? createKbQaEngine({ library, model: currentModel, ...(web ? { web: async (q, signal) => (await web.search(q, { domains: OFFICIAL_DOMAINS, limit: 3, ...(signal ? { signal } : {}) })).hits } : {}) })
    : createMockQaEngine(),
  fillers: realEngines
    ? { images: [libraryImageProvider(library), ...(web ? [webImageProvider(web, (id) => productNames.get(id))] : [])], copies: [] }
    : undefined,
  data,
  model,
  knowledge,
  registry,
  profile: "server_local",
  facts: { modelConfigured, imaConnected: activeOrigin === "ima", persistent: store.persistent },
  dataOrigin,
});
const marketing = {
  auth,
  settings,
  service: new MarketingService({ repo: marketingRepo, data, settings, box, ...(cfg.localKbDir ? { localKbDir: cfg.localKbDir } : {}) }),
  // 资料库给导购浏览整库：有本地知识库副本时固定读本地——型号编号与价格、检索卡、图片、文档的登记一致，
  // 也不消耗 ima 调用次数（ima 的型号编号与本地不同，对不上本地索引）。没有本地副本时只用当前资料服务。
  catalog: realEngines
    ? new CatalogService({ data: createDataService({ mode: "local", ...(cfg.localKbDir ? { localKbDir: cfg.localKbDir } : {}), ima: cfg.ima }), library })
    : new CatalogService({ data }),
  secureCookie: cfg.auth.secureCookie,
};

const app = createApp({ data, model, tasks: new TaskManager(workflow), sessions, marketing, library, dataMode: cfg.dataMode, corsOrigin: cfg.corsOrigin });

// 推文模块已有登录鉴权；选购顾问（/api/sessions）仍无鉴权，因此只绑定本机回环地址。公网部署前需补齐访问控制、限流与 HTTPS。
serve({ fetch: app.fetch, port: cfg.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[server] http://127.0.0.1:${info.port}  dataMode=${cfg.dataMode}  activeDataOrigin=${dataOrigin}`);
  console.log(`[server] 出站代理: ${proxyStatus}`);
  console.log(`[server] ima 凭证: ${cfg.ima.clientId ? `ClientID ${maskSecret(cfg.ima.clientId)}` : "未设置"}；模型: ${cfg.model.name ?? "未配置"}`);
  console.log(`[server] 知识库检索: ${libraryStatus.message}`);
  console.log(
    realEngines
      ? `[server] 顾问 / 答疑引擎: 知识库引擎（${settings.view().model.source === "none" ? "规则模式；在总部「系统设置」配置大模型后自动启用改写" : "已配置大模型，回复由模型改写并经数字核验"}）`
      : "[server] 顾问 / 答疑引擎: 模拟引擎（mock 模式或知识库不可读，isMock=true），界面会标注模拟。",
  );
  console.log(`[server] 联网检索: ${web ? `已启用（${web.provider}），用于体验页补图与答疑参考` : `${webSearchProblem(cfg.webSearch)}，只用本地知识库`}`);
  for (const s of statuses) console.log(`[server] 资料源 ${s.origin}: ${s.state} — ${s.message}`);
  if (master.generated) console.warn(`[server] 未设置 AUTH_SECRET，已生成主密钥 ${path.join(marketingDir, "master.key")}；公网部署请显式设置 AUTH_SECRET`);
  if (seeded.length) console.warn(`[server] 已创建初始账号：${seeded.join("、")}，口令见 .env 的 HQ_INITIAL_PASSWORD / STORE_INITIAL_PASSWORD（默认 hq123456 / store123456），登录后请立即修改`);
  console.log(`[server] 推文写作模型：${settings.view().model.source === "none" ? "未配置（使用模板稿），可在总部「系统设置」中填写" : `已配置（来源：${settings.view().model.source}）`}`);
  if (!activeOrigin) console.warn(`[server] 警告：dataMode=${cfg.dataMode} 下没有已连接的资料源，检索会失败；请检查 LOCAL_KB_DIR 或 ima 凭证，或改用 DATA_SOURCE_MODE=mock 演示。`);
  if (registry.loadErrors.length) console.log(`[server] 场景注册告警 ${registry.loadErrors.length} 条：${registry.loadErrors.slice(0, 3).join("；")}`);
});
