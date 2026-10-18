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
| POST | `/api/sessions/:id/plan` | 组装个人方案（必须有有效确认） |
| POST | `/api/sessions/:id/explore` | 说明性浏览已注册场景 |
| POST | `/api/sessions/:id/instances/:instanceId/actions` | 场景动作 |
| POST | `/api/sessions/:id/feedback` | 明确反馈 → 影响分析 |
| POST | `/api/sessions/:id/resume` | 清除失败状态 |
| GET | `/api/sessions/:id/export?format=recovery_json\|recovery_html` | 只读恢复包 |
| POST | `/api/recovery/verify` | 校验恢复包完整性 |

写操作都带 `baseRevision`；过期返回 `409 stale_revision` 并附最新快照。同一会话的异步写操作在 `SessionManager` 内串行执行。

旧营销接口 `/api/tasks/*` 仍在，但面试/演示的主链路是上表。

## 持久化与能力

- `FileSessionStore`：每个会话一个 JSON，临时文件 + 原子改名；启动后从 `.local-sessions/` 恢复需求版本、确认、方案、场景进度、反馈。
- 能力声明按运行时事实生成：`persistent` 取存储实现，`online_ai` 取模型配置，`live_updates` 取 ima 连接，不写死。
- 没有账号体系：`cross_device_continuation` 恒为 unsupported；分享是只读副本。

## 已知限制（不要在演示中越过）

- 顾问引擎目前是 `fixtures` 的模拟引擎（`components.engine.isMock=true`），不是真实模型判断。
- 真实资料模式下，多设备场景需要 A 提供成对设备的证据；缺少证据时方案会跳过该场景并写明原因，这是预期行为。
- 只读恢复 HTML 是"方案快照"，不是可交互离线体验包（场景运行时尚未接入导出）。
- 仅绑定回环地址、无鉴权，只用于本地演示。

## 测试

```powershell
npx vitest run apps/server/test
```

- `sessions.test.ts`：确认门控、场景动作、反馈后旧方案过期、重开恢复
- `sessionRoutes.test.ts`：HTTP 纵向链路（目录 → 会话 → 方案 → 体验 → 反馈 → 导出）
- `api.test.ts`：旧营销接口
