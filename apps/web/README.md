# apps/web

门店选购工作台（React + Vite）。入口是 `src/session/SessionApp.tsx`，所有状态以后端 `/api/sessions/:id` 快照为准。

```powershell
cd E:\Claude\黑客松_华为\code
npm run dev            # 后端 8787 + 前端 5173
npm run dev:web        # 只起前端（默认代理 /api → http://localhost:8787）
$env:VITE_API_TARGET='http://localhost:8788'; npm run dev:web   # 连 mock 演示后端
npm run build          # 产物在 dist/
```

## 界面结构

- 开始界面：标题 + 需求输入（唯一主按钮）+ 三个常见场景卡片 + "接下来会发生什么" + "现在的能力与限制"（资料源 / 顾问是否模拟 / 持久化 / 跨设备）。
- 会话界面：左侧对话与需求摘要、候选取舍；右侧全景 / 任务直达 / 个人方案，场景内可操作并提交明确反馈。
- 加载用骨架屏，错误带"重试"，能力不足时如实标注，不隐藏。

## 样式与设计 token

- 所有视觉值集中在 `src/styles/tokens.css`：颜色、字号（12/14/16/20/24/32）、间距（4 的倍数）、3 档圆角、1 档阴影。
- `src/scenes/scene.css` 里的旧变量名（`--bg/--ink/--brand` 等）已指向 token，新增样式一律用 `--color-*`、`--space-*`、`--text-*`。
- 不引入第二个强调色；语义色只用于状态；不使用 emoji 当图标。
- 新增组件前先确认：加载 / 空 / 错误 / disabled / focus-visible 是否齐全。

## 图片素材

- 来源：`local-data/华为PC全板块深度知识库_v7/P6-营销素材库/04-图片/02-华为商城电脑专区素材`（华为商城电脑专区公开素材，2026-10-17 快照；原始 URL 与尺寸见该目录 `图片索引.csv`）。
- 已复制到 `public/media/`：`home-collab.jpg`（首页，多人协作场景）、`hero-device.png`（方案页 hero，产品外观）、`scene-multidevice.png`（场景体验区，多设备场景）。
- 三张图都**裁掉了图内营销文案**，并在界面用 figcaption 标注「素材来源 + 场景示意，不证明具体型号能力与参数」。
- 使用约束：只作为场景/外观示意，不据此推导处理器、内存、存储、续航或兼容性；不含价格、活动、赠品信息；不称为实拍或用户证言。正式对外发布前仍需按素材说明核对授权与型号。

## 测试

```powershell
cd apps\web; npx vitest run
```

现有 22 个测试覆盖旧的 `src/advisor` 链路（`App.tsx`、MockAdvisorClient、导出器），**不覆盖**已挂载的 `SessionApp`；会话链路的测试在 `apps/server/test/sessionRoutes.test.ts`。
