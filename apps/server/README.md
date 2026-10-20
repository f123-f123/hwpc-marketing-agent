# @hwpc/server

本地 Hono 服务（默认 127.0.0.1:8787）。负责：门店选购会话、场景注册表、只读恢复包导出，以及旧的营销任务接口。

## 运行

```powershell
npm run dev:server                  # 读取根目录 .env（默认 DATA_SOURCE_MODE=auto）
$env:DATA_SOURCE_MODE='mock'; npm run dev:server   # 显式 MOCK 演示（引擎/资料/知识全部为模拟）
```

`auto` 顺序：ima（已连接）→ 本地知识库 → 报 not_configured。不会静默退回 mock。

## 会话接口（当前主链路）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/capabilities` | 能力声明（离线/本地恢复/在线 AI/实时更新/跨设备/分享） |
| GET | `/api/scenes` | 已注册场景目录（只返回可用版本） |
| GET | `/api/scenes/:id/:version` | 单个场景元数据 |
| POST | `/api/sessions` | 建会话（`{text}`），首轮即处理 |
| GET | `/api/sessions` | 会话列表（含不可读文件报告） |
| GET | `/api/sessions/:id` | 完整快照（需求/对话/候选/方案/场景/反馈/能力） |
| POST | `/api/sessions/:id/messages` | `{text, baseRevision}` |
| POST | `/api/sessions/:id/answers` | 回答已提出的问题 |
| POST | `/api/sessions/:id/needs` | 用户直接编辑需求（`user_direct`） |
| POST | `/api/sessions/:id/confirm` | 确认需求版本（`needVersion + fingerprint`） |
| POST | `/api/sessions/:id/plan` | 组装个人方案（必须有有效确认），同时生成体验页（快照里的 `page`） |
| POST | `/api/sessions/:id/explore` | 说明性浏览已注册场景 |
| POST | `/api/sessions/:id/instances/:instanceId/actions` | 场景动作 |
| POST | `/api/sessions/:id/feedback` | 明确反馈 → 影响分析 |
| POST | `/api/sessions/:id/resume` | 清除失败状态 |
| POST | `/api/sessions/:id/qa` | 体验页侧边提问 `{question, baseRevision}`：答疑智能体回答，只记录，不改需求/方案/页面 |
| GET | `/api/sessions/:id/export?format=recovery_json\|recovery_html` | 只读恢复包 |
| POST | `/api/recovery/verify` | 校验恢复包完整性 |

写操作都带 `baseRevision`；过期返回 `409 stale_revision` 并附最新快照。同一会话的异步写操作在 `SessionManager` 内串行执行。

旧营销接口 `/api/tasks/*` 仍在，但面试/演示的主链路是上表。

## 体验页（`src/page/`）

需求确认、组装方案时，`page/build.ts` 按方案生成体验页结构：开场 → 你的日常 → 每个候选一屏 → 动手体验 → 方案。
它是纯函数、当场完成，不等模型；页面绑定方案版本，之后的提问不会修改它，需求变化要重新确认、重新生成。

文案只有两种来源：方案与需求里已有的文字，以及知识库事实原值（`selectFacts` 过滤后取前几条，带限制条件，`origin: "template"`）。
图片位一律先留空（`pending`），界面显示占位并写明这里应该放什么。

### 体验页内容填充

`page/fill.ts` 定义两类填充器，在 `main.ts` 里通过 `SessionManager({ fillers })` 注册，默认一个都没有：

```ts
const fillers: PageFillers = {
  images: [myImageProvider],   // ImageProvider：按 slot.intent / slot.product / slot.roles 找图
  copies: [myCopyProvider],    // CopyProvider：改写介绍文案；事实仍只能来自知识库原文
};
```

- 每个结果必须带 `origin`（`local` / `ima` / `official_web` / `web` / `illustration` / `template` / `model`），界面据此标注来源；`web` 显示为“网络图片 · 仅供参考”。
- 找不到就返回 `null`，不要编造；所有填充器都落空的位置记为 `failed`，界面仍显示占位。
- 填充在会话写队列之外进行（可以调用外部接口），结果再进队列写回，只更新仍是 `pending` 的位置；期间页面被新方案取代，结果直接丢弃。
- 有可填的空位时快照里 `page.filling = true`，前端每 1.5 秒轮询一次，填完停止。

建议的接入顺序：本地知识库 `图片索引.csv`（官网产品图，带来源与说明）→ 官网页面 → 检索 API。

### 答疑智能体

体验页里的侧边提问由 `QaEngine`（`packages/contracts/src/qa.ts`）回答，和负责需求沟通、生成方案的 `AdvisorEngine` 是两个独立的智能体，可以接不同的模型。

- 它只看到只读视图（页面、方案、已确认的需求、最近几轮问答），接口里没有任何写入口；服务端只把问答追加到会话记录。
- 问题实际上是在改需求时，返回 `suggestNeedChange: true`，界面显示“回到需求沟通”，页面本身不变。
- 当前接的是 `fixtures` 的模拟答疑（关键词规则，回复带“模拟答疑”前缀）；没有配置时提问会得到“答疑智能体尚未配置”的失败回复，而不是假装回答。
- 接入真实模型：实现 `QaEngine.answer(view, question, deps)`，在 `main.ts` 里替换 `createMockQaEngine()`。

## 门店推文模块（`src/marketing/`）

总部下发推广任务 → 门店导购按平台生成 3 个版本 → 核验 → 选定 → 发布 / 辅助发布 → 总部看进度。

| 文件 | 职责 |
| --- | --- |
| `security.ts` | 口令散列（scrypt）、登录令牌（HMAC 签名）、平台密钥加密（AES-256-GCM） |
| `repo.ts` | 文件存储（`.runtime/marketing/`，一条记录一个 JSON，原子改名） |
| `auth.ts` | 登录、改口令、总部创建门店账号；首次启动创建初始账号 |
| `settings.ts` | 系统设置：写作模型、公众号接口地址、小红书发布接口（界面设置优先于环境变量） |
| `service.ts` | 用例与门控：生成前检查任务与门店资料，发布前检查选稿与核验状态 |
| `publishers.ts` | 公众号接口、小红书接口 / 辅助发布、朋友圈辅助发布 |
| `routes.ts` | HTTP 路由（`/api/auth/*`、`/api/marketing/*`），每个路由声明所需角色 |

写作本身在 `packages/agent/src/content/`：切入角度轮换、事实占位符、模板稿回退、套话与跨门店查重。

### 登录与账号

- 首次启动且没有任何账号时，创建 `hq`（总部）和 `store001`（示例门店），口令取 `.env` 的 `HQ_INITIAL_PASSWORD` / `STORE_INITIAL_PASSWORD`（默认 `hq123456` / `store123456`）。**登录后立即修改。**
- 令牌放在 HttpOnly Cookie（`hwpc_token`，SameSite=Lax，7 天），也接受 `Authorization: Bearer`。改口令后旧令牌全部失效。
- 主密钥 `AUTH_SECRET` 同时用于签名令牌和加密平台密钥。未设置时生成 `.runtime/marketing/master.key`；**丢失主密钥 = 已保存的 AppSecret 等全部无法解密**，公网部署请显式设置并备份。
- 后续要接企业统一登录（如企业微信 / 华为账号 OAuth）时，替换 `AuthService.login` 并保持 `authenticate` 的返回即可。

### 写作模型

总部「设置 → 系统设置」填写 OpenAI 兼容接口的地址、模型名、API Key 与写作温度，保存即生效；也可以用环境变量 `MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME`。都没有时生成**模板稿**并在界面标注。模型调用失败时同样回退模板稿，核验报告写明失败原因。

### 微信公众号

门店在「设置 → 平台账号」填写 AppID / AppSecret，并在公众号后台把服务器出口 IP 加入白名单。发布流程：`/cgi-bin/stable_token` → `/cgi-bin/media/uploadimg`（正文图）→ `/cgi-bin/material/add_material`（封面）→ `/cgi-bin/draft/add`；发布方式选“直接发布”时再调用 `/cgi-bin/freepublish/submit`。

> ⚠ 以上调用已用模拟接口测试（`test/marketing.test.ts`），**尚未用真实公众号联调**。各接口权限以公众号类型与认证状态为准；正文图需小于 1 MB 的 jpg/png。

### 小红书发布接口约定

小红书没有面向普通账号的公开发帖接口，默认走**辅助发布**：复制标题 / 正文、保存图片、打开小红书 App 或创作中心网页，导购发布后回填链接。

若你方有发布通道（自建中转、服务商或开放平台网关），在系统设置填写「发布接口地址」与「系统密钥」，门店把小红书发布方式改为“接口发布”。本服务会这样调用：

```http
POST <发布接口地址>
Content-Type: application/json
Authorization: Bearer <系统密钥>          # 系统设置里填写时才带
X-Store-Token: <门店访问令牌>             # 门店绑定里填写时才带

{
  "storeId": "store001",
  "accountId": "门店在发布接口侧的账号标识",
  "postId": "稿件编号",
  "title": "不超过 20 字的标题",
  "content": "正文（含行动引导与 #话题）",
  "tags": ["话题1", "话题2"],
  "images": [{ "imageId": "…", "mimeType": "image/jpeg", "caption": "…", "base64": "…" }]
}
```

期望响应：`{ "ok": true, "id": "笔记编号（可选）", "url": "笔记链接（可选）", "message": "说明（可选）" }`。返回 `url` 时记为已发布，否则记为已提交；HTTP 非 2xx 或 `ok:false` 记为失败，并把 `message` 展示给导购。

### 朋友圈与海报

个人微信没有发布接口：朋友圈只做辅助发布（复制文案、保存图片、打开微信）。海报在浏览器端用 canvas 生成 1080×1440 PNG 直接下载。如果门店使用企业微信，后续可以接“客户朋友圈发表任务”接口，实现总部一键下发、导购一键发表。

## 持久化与能力

- `FileSessionStore`：每个会话一个 JSON，临时文件 + 原子改名；启动后从 `.local-sessions/` 恢复需求版本、确认、方案、场景进度、反馈。
- 能力声明按运行时事实生成：`persistent` 取存储实现，`online_ai` 取模型配置，`live_updates` 取 ima 连接，不写死。
- 没有账号体系：`cross_device_continuation` 恒为 unsupported；分享是只读副本。

## 已知限制（不要在演示中越过）

- 顾问引擎目前是 `fixtures` 的模拟引擎（`components.engine.isMock=true`），不是真实模型判断。
- 真实资料模式下，多设备场景需要 A 提供成对设备的证据；缺少证据时方案会跳过该场景并写明原因，这是预期行为。
- 只读恢复 HTML 是"方案快照"，不是可交互离线体验包（场景运行时尚未接入导出）。
- 推文模块有登录鉴权；选购顾问接口（`/api/sessions`）仍无鉴权，所以服务只绑定回环地址。公网部署前需补齐访问控制、限流与 HTTPS（并设置 `COOKIE_SECURE=true`）。
- 资料层的表格解析存在列错位与表头残留（例如把厚度解析成长度、把“CPU”“继续访问”当成参数值）。推文侧已加过滤与尺寸合理性检查作为防线，但根本修复应在 `packages/data` 的解析器。

## 测试

```powershell
npx vitest run apps/server/test
```

- `sessions.test.ts`：确认门控、场景动作、反馈后旧方案过期、重开恢复
- `sessionRoutes.test.ts`：HTTP 纵向链路（目录 → 会话 → 方案 → 体验 → 反馈 → 导出）
- `api.test.ts`：旧营销接口
- `sessionConsistency.test.ts`：并发写入不丢更新、旧方案实例作废、确认版本与恢复门控
- `marketing.test.ts`：登录与权限、生成门控、选稿 → 辅助发布 → 回填 → 看板、公众号接口调用顺序与密钥加密、核验未通过不可发布、门店隔离
