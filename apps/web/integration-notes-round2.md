# apps/web 第二轮：场景体验与个人方案

第一轮已实现"先沟通、确认后制作"，契约、类型与界面模拟均已就绪。本轮围绕新定位增量调整：
工作台现在围绕**需求沟通、场景体验、候选比较、个人方案**四项活动组织。

## 新增内容

### code/scenes（场景库）
- `src/types.ts`：场景定义、运行时数据、个人方案的类型（提案，供主 Agent 迁入 packages/contracts）
- `src/engine.ts`：纯函数运行引擎（状态只因用户操作改变、可重放、可恢复、可校验）
- `src/definitions/`：两个场景（多屏协同、手机与电脑文件互传），基于知识库《多设备协同传播边界》与官方支持卡的流程结构
- `src/registry.ts`：场景清单（同一 sceneId 的旧版本保留在清单里，历史方案按原版本重放）
- `src/space.ts`：全景空间定义（程序绘制的示意环境，不是真实门店或实机画面）
- `src/plan.ts`：个人方案数据结构（需求、候选、推荐体验、反馈）
- `src/simulated.ts`：虚拟示意设备的配置（用于开发与通用体验，真实产品由 A 的证据绑定后才能生成配置）
- `test/scenes.test.ts`：24 个测试（静态检查、全可达状态、不适用组合、保存与版本兼容、证据层级、违禁表达）

### apps/web/src/scenes（渲染器与导出）
- `SceneRunner.tsx`：局部任务渲染器（工作台与导出的个人 HTML 共用同一个组件）
- `Panorama.tsx`：全景空间（圆柱投影、拖动/触摸/键盘、热点是真正的按钮）
- `ExperienceArea.tsx`：体验区入口（全景空间 → 局部任务 → 候选比较 → 个人方案）
- `PlanView.tsx`：个人方案视图（需求、候选、推荐体验、反馈、待解决问题）
- `usePlan.ts`：体验状态钩子（位置、各任务的操作历史、反馈；保存经 AdvisorClient）
- `offlineEntry.tsx`：离线个人页面的运行时入口（复用同一套 SceneRunner 与引擎）
- `offlineHtml.ts`：个人 HTML 导出（已注册场景模块 + 版本化个人方案；校验后才导出）
- `scene.css`：场景与全景的样式（工作台与离线页共用同一份）

### apps/web 其它
- `build/sceneRuntimePlugin.ts`：Vite 插件（把离线页面运行时在构建时打成一个 IIFE 字符串）
- `vite.config.ts` / `vitest.config.ts` / `tsconfig.json`：增加 `@hwpc/scenes` 别名（场景库独立维护，未加入根 workspaces）
- `advisor/client.ts`：接口新增 `getPlan` / `loadProgress` / `saveProgress` / `sendFeedback`
- `advisor/types.ts`：快照新增 `planVersions`、能力标志新增 `personalPlan` / `serverProgress` / `feedbackToBackend`
- `advisor/legacyClient.ts`：旧接口适配器（方案能力全部返回 false）
- `advisor/mock/`：界面模拟新增方案构造（`planBuilder.ts`）、进度保存（浏览器本地、如实标注）、反馈回执（只记录不改变推荐）
- `advisor/useAdvisor.ts`：新增 `plan` / `planVersion` / `activity` 状态
- `App.tsx`：确认需求后展开体验区（方案推荐时才出现）

## 验收

**类型检查、构建与测试**
```powershell
cd apps/web
npx tsc -p ../../tsconfig.json  # 无错误
npx vite build                   # 成功
npx vitest run                   # 22 passed（第一轮的测试）

cd ../../scenes
npx tsc -p tsconfig.json         # 无错误
npx vitest run                   # 24 passed（场景定义、引擎、版本兼容、证据层级）
```

**界面模拟下的完整流程**
1. 沟通 → 选择"只写 示例本 Air 14" + "先不写续航" → 确认需求 → 方案出现
2. 点击"场景体验"活动 → 全景空间可拖动/触摸/键盘、热点可进入
3. 从热点或推荐列表进入"显示器/智慧屏 多屏协同" → 选择虚拟设备 → 前提条件满足 → 执行动作 → 观察状态变化 → 完成
4. 换设备为"不在支持范围"的预设 → 所有动作不可用、给出原因与下一步、无法进入成功分支
5. 返回空间 → 进入"手机与电脑 文件互传" → 操作几步后刷新页面 → 进度恢复、回到之前任务
6. 改变虚拟条件"电脑剩余空间" → 同一个大文件：空间充足时送达、空间不足时失败
7. 点击"候选比较"活动 → 看到候选产品的证据（✓ 有依据 / ? 资料未提供 / ≠ 来源冲突）、未知项
8. 点击"个人方案"活动 → 看到需求、候选、推荐体验顺序、反馈、待解决问题、进度保存说明
9. 在任务里发送"我仍然不理解"反馈 → 收到回执"已记录，当前是界面模拟，没有顾问评估它"
10. 导出进度记录 JSON → 删除浏览器数据 → 导入进度文件 → 恢复各任务操作历史
11. 点击"营销图文（可选成果）"展开作品区 → 与第一轮相同（旧路径保留）

**离线个人 HTML**
- 方案导出前逐项校验（场景存在、版本一致、定义通过静态检查、配置合法）；校验不过就不导出并说明原因
- 导出的 HTML 单文件包含：已注册场景模块（运行时，构建产物）+ 版本化个人方案（数据）+ 样式
- 打开 HTML → 看到需求、候选、推荐体验、待解决问题、说明（MOCK、不联网、独立副本）
- 点击"开始体验" → 与工作台里相同的 SceneRunner 与引擎；操作历史保存在 localStorage（如实标注"浏览器本地"）
- 可导出/导入进度文件（独立副本，不会自动同步）

**不适用组合与证据层级**（场景测试已覆盖）
- 设备能力声称 yes 但只有场景图片证据（不在 `CAPABILITY_EVIDENCE_LEVELS` 内）→ 引擎按 unknown 处理，动作不可用
- 有官方依据的 yes → 可进入流程；有依据的 no → 同样挡住流程
- 不适用的设备组合 → 任何动作都不可用、给出原因与下一步、无法强制进入成功分支
- 换设备会清除之前的操作与结果

**可见文本边界**（场景测试已覆盖）
- 所有可达视图都不出现"已连接你的设备"、具体耗时或速度（`exploreReachable` 全状态检查）
- 全景空间、场景素材、虚拟设备均标明"示意 / 虚拟"

**保存与恢复**
- 进度保存说明如实区分：`server`（服务端）/ `browser_local`（浏览器本地缓存，不是服务端）/ `none`（不保存）
- 界面模拟下为 `browser_local`，顶部常驻说明"不是服务端保存，换设备或清理浏览器数据后会丢失"
- 场景版本或状态版本不兼容的记录 → 拒绝套用并列出原因，不静默改变历史方案
- 手工改成"已完成"的记录 → 重放失败（引擎校验）

**历史方案**
- 改选购目标（关键需求变更）→ 回到对话重新确认 → 旧方案保留，标为"历史方案"并显示不适用当前需求的说明
- 点击"个人方案"顶部版本标签可切换查看旧版本 → 旧版本的体验仍可操作，但顶部警示"不是当前建议"

## 接口需求（对主 Agent / B）

`apps/web/integration-notes.md` 已更新（第一轮契约保留）。新增：

### 个人方案（PersonalPlan）
- `GET /api/sessions/:id/plans/:version?`（缺省为最新）
- 结构见 `code/scenes/src/plan.ts`；前端展示，不改写推荐
- 推荐的体验（`PlanExperience[]`）：`sceneId` + `sceneVersion`（固定）、`config`（设备绑定 + 证据）、`reason`（B 给出）、`order`（推荐顺序）
- 设备绑定：`source: "simulated"` 时必须对应场景定义里的 `simulatedPresets`；`source: "product"` 时能力值必须有可作为能力依据的证据（见 `CAPABILITY_EVIDENCE_LEVELS`）
- 场景升级不会改变历史方案（方案里记录的是 `sceneVersion`，不是"最新"）

### 体验进度（PlanProgress）
- `GET /api/sessions/:id/plans/:version/progress`、`POST .../progress`
- 结构见 `code/scenes/src/plan.ts`；`storage` 字段如实说明保存位置（`server` / `browser_local` / `none`）
- `records`：key = experienceId，value = SavedRun（场景 id + 版本 + 状态版本 + 历史）
- `position`：当前所在活动与任务、全景视角（用于返回时恢复）
- `feedback`：结构化反馈事件（见下）

### 结构化反馈（FeedbackEvent）
- `POST /api/sessions/:id/feedback`
- 类型：`not_understood` / `steps_unsuitable` / `device_unmet` / `compare_other` / `change_preference`
- 响应：`FeedbackRecord`（`status: "sent" | "queued" | "unsupported"`、`ack`：后端回执）
- **推荐不会因前端或界面模拟直接改变**；是否调整由 B 判断

### 快照新增字段
- `planVersions: PlanVersionMeta[]`（与作品版本对应）
- `capabilities.personalPlan / .serverProgress / .feedbackToBackend`：如实声明，前端据此禁用或说明

### 场景清单（对 B）
- `code/scenes/src/registry.ts: catalog()`：场景清单（sceneId、版本、标题、任务、演示类型、服务的问题/技术标签、设备角色）
- B 根据需求选择场景 → 传入合法配置（设备绑定 + 证据）→ 前端渲染并保存进度
- 设备能力的取值由 A 的证据决定：`yes` / `no` 必须有可作为能力依据的证据（`official_feature_page` / `official_support_page` / `device_test`）；没有或只有场景图片时为 `unknown`

## 当前形态

### 完成
- 场景库：2 个场景（多屏协同、文件互传）、全景空间、引擎、静态检查、全可达状态检查
- 工作台：全景 → 局部任务 → 候选比较 → 个人方案；体验进度保存（浏览器本地，如实标注）
- 离线 HTML：单文件、自包含、复用同一套引擎与组件
- 界面模拟：方案构造、进度保存、反馈回执（只记录不改变推荐）
- 测试：场景 24 passed、工作台 22 passed

### 未完成或待对齐
- **真实会话接口**：`getPlan` / `loadProgress` / `saveProgress` / `sendFeedback` 只有 mock；真实后端需要主 Agent 实现
- **场景与产品绑定**：当前体验使用虚拟示意设备；真实产品的能力取值需要 A 的证据支持后由 B 生成配置
- **方案生成时机**：界面模拟里确认需求后立即有方案；真实流程由 B 决定何时生成、如何选择场景与设备
- **服务端进度保存**：当前只有浏览器本地缓存（`storage: "browser_local"`）；`storage: "server"` 需要主 Agent 持久化
- **反馈闭环**：前端发送结构化反馈并收到回执；是否影响推荐由 B 判断，前端不会自行改变
- **离线断网实测**：导出的 HTML 设计为不依赖网络与本地接口；但我没做真实的断网加载与图片验证，所以文案只说"不依赖"，没称为"离线包"
- **场景扩展**：初版 2 个场景；更多场景、更复杂的全景导航和多对多检索由后续迭代补充
- **移动端与辅助技术**：全景与局部任务可触摸、可键盘；但窄屏布局和屏幕阅读器没有实测

## 与第一轮的关系

- **保留**：需求沟通、确认、作品、版本、导出（旧路径仍可用，"营销图文"改为可选成果入口）
- **新增**：场景体验、个人方案、结构化反馈；方案推荐时才出现
- **契约**：`integration-notes.md` 追加，第一轮契约未动
- **测试**：第一轮 22 passed 保持；场景库新增 24 passed
- **能力标志**：`capabilities.personalPlan` 控制是否展示体验区；false 时回到第一轮的纯作品流程

## 文件清单

新增 / 修改的文件（不含已有的第一轮文件）：
```
code/
├─ scenes/                         # 场景库（独立维护，未加入根 workspaces）
│  ├─ src/
│  │  ├─ types.ts                  # 场景定义、运行时数据、个人方案类型（提案）
│  │  ├─ engine.ts                 # 纯函数运行引擎
│  │  ├─ plan.ts                   # 个人方案数据结构
│  │  ├─ space.ts                  # 全景空间定义
│  │  ├─ registry.ts               # 场景清单与多对多检索
│  │  ├─ simulated.ts              # 虚拟示意设备配置
│  │  ├─ dsl.ts                    # 表达式构造小工具
│  │  ├─ definitions/
│  │  │  ├─ multiScreen.ts         # 场景：显示器/智慧屏 多屏协同
│  │  │  └─ fileTransfer.ts        # 场景：手机与电脑 文件互传
│  │  └─ index.ts
│  ├─ test/scenes.test.ts          # 24 个测试
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ vitest.config.ts
├─ apps/web/
│  ├─ src/
│  │  ├─ scenes/
│  │  │  ├─ SceneRunner.tsx        # 局部任务渲染器
│  │  │  ├─ Panorama.tsx           # 全景空间
│  │  │  ├─ ExperienceArea.tsx     # 体验区入口
│  │  │  ├─ PlanView.tsx           # 个人方案视图
│  │  │  ├─ usePlan.ts             # 体验状态钩子
│  │  │  ├─ offlineEntry.tsx       # 离线页面运行时入口
│  │  │  ├─ offlineHtml.ts         # 个人 HTML 导出
│  │  │  └─ scene.css              # 场景与全景样式
│  │  ├─ advisor/
│  │  │  ├─ client.ts              # 接口新增方案与进度方法
│  │  │  ├─ types.ts               # 快照新增 planVersions
│  │  │  ├─ useAdvisor.ts          # 新增 plan / activity 状态
│  │  │  ├─ legacyClient.ts        # 旧接口：方案能力全 false
│  │  │  └─ mock/
│  │  │     ├─ planBuilder.ts      # 界面模拟：方案构造
│  │  │     └─ mockClient.ts       # 新增进度保存与反馈
│  │  ├─ App.tsx                   # 确认后展开体验区
│  │  └─ virtual.d.ts              # virtual:scene-runtime 声明
│  ├─ build/sceneRuntimePlugin.ts  # Vite 插件
│  ├─ vite.config.ts               # 增加 @hwpc/scenes 别名与插件
│  ├─ vitest.config.ts             # 同上
│  ├─ tsconfig.json                # 增加 paths
│  ├─ integration-notes.md         # 追加接口需求
│  └─ README.md                    # 更新
```
