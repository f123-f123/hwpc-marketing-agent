# apps/web

门店选购工作台（React + Vite）。入口是 `src/App.tsx`，所有状态以后端 `/api/sessions/:id` 快照为准，前端不推演业务状态。

```powershell
cd E:\Claude\黑客松_华为\code
npm run dev            # 后端 8787 + 前端 5173
npm run dev:web        # 只起前端（默认代理 /api → http://localhost:8787）
$env:VITE_API_TARGET='http://localhost:8788'; npm run dev:web   # 连 mock 演示后端
npm run build          # 产物在 dist/
```

## 界面结构

- 首页（`components/Home.tsx`）：一句话需求输入 + 三个常见场景 + “接下来会怎样” + 当前服务状态（资料源 / 顾问是否模拟 / 保存方式）。
- 工作台（`components/Workspace.tsx`）：
  - 宽屏：左侧对话常驻（`ChatPanel`），右侧按“需求 → 候选 → 体验 → 方案”分页；顶部一条“下一步”横幅给出唯一主操作（`lib/stage.ts` 的 `nextStep`）。
  - 窄屏（≤960px）：分页在上，“对话”成为单独一页。
- 场景任务（`SceneTask`）在体验页内打开；全景（`scenes/Panorama.tsx`）的视角只在体验面板内更新，停止拖动后才写入本地。

## 目录

```text
src/
├─ App.tsx              顶栏、通知、首页 / 工作台切换
├─ api/client.ts        /api 调用；非 JSON 响应、断网都转成可读的 ApiError
├─ state/useSession.ts  会话快照与动作；动作失败返回 null，调用方据此保留用户输入
├─ lib/                 标签文案、阶段判断、localStorage 安全读写
├─ components/          Home / Workspace / ChatPanel / NeedsPanel / CandidatesPanel / ExperiencePanel / SceneTask / PlanPanel / ui
├─ scenes/Panorama.tsx  360° 示意空间
└─ styles/              tokens.css → base.css → app.css
```

## 样式与设计 token

- 三层样式：`tokens.css`（变量）→ `base.css`（重置、按钮、表单、标签、提示条、卡片）→ `app.css`（布局与业务组件）。组件样式不写裸色值、裸字号。
- 字号阶梯 12/13/14/16/18/22/28，正文 14；中文最小 12px。字重只用 400 / 600，不对中文做负字距。
- 一个品牌色（华为红）+ 中性灰 + 成功/警示/危险三个语义色；语义色只表达状态。
- 图标统一用 `components/ui.tsx` 的线性 SVG，不用 emoji 或 Unicode 符号。
- 新增组件前先确认：加载 / 空 / 错误 / disabled / focus-visible 是否齐全。

## 图片素材

- 来源：`local-data/华为PC全板块深度知识库_v7/P6-营销素材库/04-图片/02-华为商城电脑专区素材`（华为商城电脑专区公开素材，2026-10-17 快照；原始 URL 与尺寸见该目录 `图片索引.csv`）。
- 已复制到 `public/media/`（来源对照见 `public/media/SOURCES.md`）。当前界面只在首页使用 `home-collab.jpg`；`hero-device.png`、`scene-multidevice.png`、`huawei-collaboration.png`、`huawei-continuity.png` 暂未引用，保留备用。
- 图片都**裁掉了图内营销文案**，并在界面用 figcaption 标注「素材来源 + 场景示意，不证明具体型号能力与参数」。
- 使用约束：只作为场景/外观示意，不据此推导处理器、内存、存储、续航或兼容性；不含价格、活动、赠品信息；不称为实拍或用户证言。正式对外发布前仍需按素材说明核对授权与型号。

## 测试

```powershell
npx vitest run apps/web    # 在仓库根目录运行
```

`test/web.test.ts` 覆盖“下一步”判定与 API 客户端的错误处理；会话链路的端到端测试在 `apps/server/test/`。
