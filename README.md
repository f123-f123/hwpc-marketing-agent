# 华为 PC 门店场景选购与内容顾问

> AI+华为PC营销软文智能体（拓浙 AI 生态 · 浙客松｜华为·产业进阶赛道）

不是“一键写软文”，而是先把顾客需求聊清楚、把产品事实核准、把体验安排明白，再按平台产出可发布的图文。

- **ima** 提供华为产品事实与图片素材；
- **自研 Agent** 负责理解顾客、比较候选、编排体验、生成与核验内容；
- **模型** 只做“理解与表达”，事实、版本、确认与合规由程序守住。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 多轮需求沟通 | 从自由表达抽取任务、环境、预算、已有设备、必要软件、硬条件、偏好、顾虑；每轮最多追问 3 个关键问题 |
| 需求摘要与确认门 | 摘要绑定需求版本与指纹；只有用户点击确认才产生确认记录，聊天里说“确认”无效 |
| 候选比较与取舍 | 满足 / 不满足 / 需要妥协 / 证据不足四类分开；未知不当作满足，硬条件不满足不能用其他卖点抵消 |
| 个人方案与场景编排 | 确认后才允许组装；逐个校验场景版本、配置、设备绑定与适用性 |
| 全景体验空间 | 程序绘制的 360° 示意空间，热点进入局部任务；支持拖动、触摸、方向键与任务直达 |
| 场景运行时 | 声明式状态机，动作有前置状态；完成仅表示“走完流程”，不是实机测试 |
| 明确反馈闭环 | 只有显式反馈才改变需求；关键变化使旧确认失效、旧方案过期，非关键变化只标“待复核” |
| 导出与恢复 | 会话文件持久化、revision 门控、只读恢复包、完整性校验、能力声明 |
| 营销图文引擎（可选） | 公众号 / 小红书 / 门店朋友圈 / 门店海报的平台规则、提示词、事实核验、合规检查与四段式导出 |

## 架构

```text
apps/web（React + Vite）
  工作台：左侧对话常驻，右侧 需求 / 候选 / 体验（全景 + 场景任务）/ 方案（反馈、导出）
        │ /api（Vite 代理到 8787）
apps/server（Hono）
  SessionManager：用例编排、revision 门控、同会话串行写
  SceneRegistry：场景版本锁定、内容哈希、失效记录
  FileSessionStore：原子写、schema 复验、损坏隔离
  ModelService：OpenAI 兼容 chat/completions
        │
packages/contracts   类型 / zod schema / 一致性检查
packages/data        local / ima / 设备能力与关系
packages/agent       需求抽取 / 候选评估 / 策略 / 生成 / 核验 / 门控
scenes               声明式场景库与空间定义
fixtures             MOCK 产品、事实、图片、场景、规则引擎
```

关键不变量：

- 确认只能由用户产生，模型输出中的确认字段会被丢弃并记审计；
- 没有证据就没有“满足”，未知不计入满足；
- 场景版本不可变，内容变化会被哈希发现；
- 模拟内容全程标记 MOCK；
- 凭证只从服务端环境变量读取，前端拿不到；
- 每次写操作带 `baseRevision`，过期写入被拒绝。

## 快速开始

### 环境

- Node.js >= 20
- npm（根目录使用 npm workspaces）

### 安装

```powershell
npm install
Copy-Item .env.example .env
```

`.env` 已被 `.gitignore` 忽略，不要提交真实凭证。

### 无需任何凭证的完整演示（MOCK）

```powershell
# .env
DATA_SOURCE_MODE=mock
npm run dev
```

- 前端：<http://localhost:5173>
- 后端：<http://127.0.0.1:8787>
- 界面会常驻 MOCK 提示；可走通“沟通 → 确认 → 方案 → 全景 → 场景动作 → 反馈 → 导出”。

### 本地真实资料模式

准备一份知识库目录（根目录包含 `P1-产品参数库/`），或把赛题知识库解压到 `code/local-data/`：

```powershell
# .env
DATA_SOURCE_MODE=auto
LOCAL_KB_DIR=            # 留空则使用 code/local-data/华为PC全板块深度知识库_v7
npm run dev
```

打开 `GET /api/status` 确认 `activeDataOrigin=local`。本地知识库不随仓库提交（体积大且属于赛事资料），需自行放置。

### ima 共享知识库模式

```powershell
# .env
DATA_SOURCE_MODE=ima
IMA_OPENAPI_CLIENTID=...
IMA_OPENAPI_APIKEY=...
IMA_KB_NAME=任德耀新建华为PC知识库
npm run dev
```

凭证只从环境变量读取；接口与日志只输出脱敏值。当前适配层尚未用真实凭证验证，接入前请先用 `search_knowledge_base` 核对字段名（详见“已知限制”）。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动后端 8787 与前端 5173 |
| `npm run dev:server` | 只启动后端 |
| `npm run dev:web` | 只启动前端 |
| `npm run typecheck` | 各 workspace 类型检查 |
| `npm test` | 运行 vitest |
| `npm run build` | 构建前端到 `apps/web/dist` |

## 目录结构

```text
code/
├─ apps/
│  ├─ server/           Hono 服务、会话用例、场景注册表、文件存储、模型客户端
│  └─ web/              React 前端：首页、工作台（对话 + 分页面板）、全景、场景任务、导出
├─ packages/
│  ├─ contracts/        zod 契约、需求/确认/方案/场景/恢复包、一致性检查
│  ├─ data/             本地知识库、ima OpenAPI、设备知识
│  └─ agent/            需求抽取、问题规划、候选评估、策略、生成、核验、门控
├─ scenes/              声明式场景库、空间定义、运行时
├─ fixtures/            MOCK 产品/事实/图片/场景/规则引擎/固定样例
├─ local-data/          本地知识库副本（gitignore，不提交）
├─ docs/                契约与开发说明
└─ .env.example         配置模板
```

## 当前状态与已知限制

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 会话顾问主链路 | ✅ 可运行 | 沟通、确认、候选、方案、全景、场景动作、反馈、导出、重启恢复 |
| 真实资料检索 | ✅ 可运行 | `auto → local` 可读取本地知识库；证据不足时方案会少安排场景而不是虚构 |
| ima 适配层 | 🟡 已实现，未验证 | 本仓库没有凭证；需用真实账号核对 `kb_id` / `kb_name` 等字段 |
| 顾问模型引擎 | 🟡 代码已实现，默认未接线 | `packages/agent` 的 `Consultant` 已实现；默认 `main.ts` 使用规则引擎（MOCK） |
| 营销图文工作流 | 🟡 代码已实现，默认未接线 | `/api/tasks` 仍返回 fixtures 模拟工作流；提示词、核验、导出在 `packages/agent` |
| 鉴权与公网部署 | ⛔ 未实现 | 服务仅绑定 `127.0.0.1`，用于本地演示；公网前必须加鉴权、限流、TLS |

其他边界：

- 本地知识库、`.env`、`.local-sessions/`、`node_modules`、构建产物均不提交；
- 价格/促销默认不生成：没有带条件的资料依据时不写价格；
- MOCK 内容不得当作真实华为资料或真机测试结果；
- 同一进程内写操作按会话串行；多进程写同一存储目录不支持。

## 安全说明

- 不要把 `IMA_OPENAPI_CLIENTID`、`IMA_OPENAPI_APIKEY`、模型密钥写入源码、README、截图或视频；
- `.env` 只提交模板 `.env.example`；
- 前端只通过相对路径访问 `/api`，不接触任何凭证；图片也由服务端代理读取；
- 导出恢复包使用完整性哈希，仅用于发现损坏或意外修改，不是数字签名；
- 公网部署前必须增加访问控制与限流，并重新评估 CORS。

## 文档

- [`docs/contracts.md`](docs/contracts.md)：公共契约、接口、错误语义、一致性检查
- [`docs/development.md`](docs/development.md)：开发环境、命令、本地资料与目录边界

## 赛题对应

- 场景解析 → 需求版本与摘要；
- 平台策略 → `PLATFORM_PLANS` 与内容方向；
- ima 资料与图片检索 → `packages/data`，保留来源、原文与限制条件；
- 事实点提取 → 事实白名单与 `factId` 绑定；
- 图文编排与软文生成 → 受控生成 + 模板回退；
- 事实与图片核验 → 数值、量词、限制条件、型号/配置、图片说明；
- 合规检查 → 绝对化、虚构体验、价格误导、竞品贬低；
- 导出 → 场景判断 / 知识库依据 / 图文软文 / 核验结果四段式。
