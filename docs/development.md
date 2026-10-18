# 开发说明

## 环境

Node.js >= 20，npm workspaces。

```powershell
cd E:\Claude\黑客松_华为\code
npm install
Copy-Item .env.example .env   # 再按需填写；.env 已被忽略
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动后端（8787）与前端（5173），前端把 `/api` 代理到后端 |
| `npm run dev:server` | 只启动后端 |
| `npm run dev:web` | 只启动前端 |
| `npm run typecheck` | 各 workspace 类型检查 |
| `npm test` | 运行 vitest（契约样例一致性、服务端接口） |
| `npm run build` | 构建前端 |

没有配置任何凭证时，系统使用 mock 资料与 mock 模型，`/api/status` 中 `mockInUse` 为 true。

## 本地资料

赛题知识库压缩包位于 `E:\Claude\黑客松_华为\华为PC知识库.zip`（上级目录，不在 `code` 内）。资料现状：

- 解压后根目录为 `华为PC全板块深度知识库_v7/`，共 1796 项，约 1365 个 md、42 个 csv、111 张图片。
- `P1-产品参数库/` 下每个型号有 `产品事实.md`、`卖点与限制.md` 和 `images/`；`06-型号检索卡/` 有分卡摘要；`00-全库横向索引/` 有参数矩阵和 `全部图片联合检索表.csv`（含文件名、型号、画面说明、原图 URL、来源页）。
- `P4-价格政策库（机密）` 存在，使用前需 Agent A 确认其访问边界；比赛要求价格必须有资料依据。
- 该压缩包是本地副本，与 ima 共享知识库是否一致尚未验证。

解压到 `code/local-data/`（忽略目录），再设置 `LOCAL_KB_DIR`。不要在原压缩包上操作。

## 各 Agent 边界

- Agent A：只改 `packages/data`。
- Agent B：只改 `packages/agent`。
- Agent C：只改 `apps/web`。
- 其余（根配置、锁文件、`packages/contracts`、`apps/server`、`fixtures`、`docs`）由主控管理。
