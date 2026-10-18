# apps/web 接口需求（Agent C → 主 Agent）

前端已按"对话式顾问工作台"实现。现有 API 没有独立的需求确认、对话恢复、互动方案、HTML 导出和版本化图片访问，
前端**没有假设旧接口已满足**这些要求。下面是需要主 Agent 在 `packages/contracts` 与服务端落地的内容。
形状以 `apps/web/src/advisor/types.ts`（快照与作品视图）和 `client.ts`（调用方法）为准，字段名可调整，语义请保留。

## 0. 依赖变更

无新增依赖。`apps/web` 只用 react、`@hwpc/contracts`、`@hwpc/fixtures`。
测试用 `apps/web/vitest.config.ts` 单独运行（`cd apps/web; npx vitest run`），根配置的 `include` 未包含 `apps/web/test`。
若希望 `npm test` 一并运行，请在根 `vitest.config.ts` 加入 `apps/web/test/**/*.test.ts`（根配置归你管）。

## 1. 对话与需求状态（会话快照）

`GET /api/sessions/:id` 返回 `AdvisorSnapshot`，前端一切界面状态以它为准：

- `messages[]`：完整对话记录（刷新恢复的唯一来源）。每条带 `messageId`、`role`、`editable`。
- `requirements[]`：8 项（人群、主要问题、营销目标、产品范围、发布渠道、交付形式、核心方向、限制），
  每项带 `provenance`：`user_said` / `system_suggested` / `assumed_default` / `pending`，以及 `basis`。
- `questions[]`：B 决定，**1–3 个**。`category`：`preference`（用户偏好）与 `material`（资料缺口/冲突决定）分开；
  `options` 简洁，`allowFreeText` 控制是否允许补充。
- `gaps[]`、`candidates[]`（含 `evidence[]`、`unknowns[]`、`differences[]`；`evidence.status` 为
  supported / unknown / conflict，**未知不得当作已满足**）。
- `progress[]`：来自后端真实事件。每步 `purpose`（做什么、为什么）、`origin`、`simulated`。前端不用定时器伪造完成。
- `phase`：discussing / retrieving / awaiting_confirmation / producing / delivered / blocked / failed / interrupted。
- `revision`：快照修订号，所有写操作回传 `baseRevision`，过期返回 `stale_revision`。
- `backend`：`dataOrigin`(local/ima/mock)、`modelProvider`、`modelSimulated`、`mockInUse`。
- `capabilities`：能力声明；缺哪项前端就如实禁用并说明。

## 2. 对话写操作

| 操作 | 说明 |
| --- | --- |
| `POST /api/sessions` `{text}` | 创建会话，不得立即出作品 |
| `POST /api/sessions/:id/messages` `{text, baseRevision}` | 自由表达 |
| `POST /api/sessions/:id/answers` `{answers[], freeText?, baseRevision}` | `answers` 可为空数组：一段 `freeText` 覆盖多个问题，由 B 解释 |
| `POST /api/sessions/:id/messages/:mid/edit` `{text, baseRevision}` | 仅"等待回答/摘要确认"阶段允许；其后对话、检索结果、摘要由服务端按新表达重新生成。已进入制作的返回 `invalid_state` |

## 3. 需求摘要与确认（最关键）

`summary`（`RequirementSummary`）：`summaryId`、`requirementVersion`、`status`（pending_confirmation / confirmed / superseded）、
`fields[]`、`defaults[]`、`limitations[]`、`blockers[]`、`affected[]`（相对上一版变化的项）。

- `POST /api/sessions/:id/summary/confirm` `{summaryId, requirementVersion}`
  - 服务端校验摘要仍是当前待确认版本；**幂等**：同一摘要重复确认只触发一次制作（返回 `duplicate:true`）。
  - 拒绝原因（HTTP 409，机器可读）：`stale_summary`（旧页面/其他窗口产生了新版本）、`not_pending`、`blocked`（摘要有 `blockers`）、`unavailable`。
    拒绝时响应附带最新快照，前端据此刷新而不报错。
- `POST /api/sessions/:id/summary/revise` `{summaryId, requirementVersion, edits:[{key,value}]}`：产生新摘要版本，旧版本置 `superseded`。
- `POST /api/sessions/:id/summary/continue` `{summaryId, requirementVersion}`：继续讨论，不触发制作。
- 是否"需求已充分/能否生成"完全由 B 与服务端判定，前端不据输入框是否填满推断。
- 确认前，服务端**不得**向前端返回任何作品内容（前端不靠隐藏来保证）。

## 4. 作品版本

- `versions[]`（`WorkVersionMeta`）：`version`、`requirementVersion`（该作品基于的需求版本）、`currentRequirement`、
  `staleReason`、`deliveryStatus`、`isMock`。
- **关键需求变更后旧版本必须由服务端标 `currentRequirement=false`**，前端据此隐藏核验通过徽标、导出时加"历史版本"说明。
- `GET /api/sessions/:id/works/:version` → `WorkView`：`ResultVersion`（沿用现有契约，不改）+ `interactive?` + `basisSummary?`。
- `POST /api/sessions/:id/work-revisions` `{instruction, baseWorkVersion}`：内容级修改，不改需求，生成新版本并重新核验。
- `POST /api/sessions/:id/requirement-changes` `{note, baseWorkVersion}`：关键需求变化（选购目标、产品范围、渠道等），
  回到需求沟通并产出新摘要；确认前旧作品保留为历史版本。
- 现有 `POST /revisions` 的 `inputPatch` 可以直接改渠道等字段并重新生成，**绕过确认**；建议只保留内容级修改。
- 任务中断/恢复：`phase=interrupted` + `error.recoverable`，`POST /api/sessions/:id/resume`。

## 5. 互动方案（B 输出，待契约化）

`InteractivePlan`（见 `types.ts`）：`scenes[]`、`claims[]`、可选 `compare`，文案以外的**产品事实一律用 `factIds`/`imageIds` 引用**
`materialPack`，不接受模型直接写出的事实文字、HTML 或脚本。

- `verifiedStateIds[]`：后端核验过的**全部互动状态**（每个场景、卖点、对比，不仅是默认首屏）。
  前端渲染前检查：状态在名单内、引用的事实/图片属于当前版本、事实的型号在当前版本范围。不满足则不渲染并列出原因。
- 对比表里资料没有的单元格 `factIds=[]`，前端显示"资料未提供，不视为满足"。
- 交付形式不含互动网页时 `interactive` 为空，前端显示"本版本没有互动网页"，不制作占位页。
- 需要 B 确认：互动状态的核验是否与图文核验同一套事实/图片一致性检查（`checkResultVersion` 的扩展）。

## 6. HTML 导出与离线性（待共同定义）

当前前端从 `WorkView` 生成**单个自包含 HTML**（`exporters.ts: buildInteractiveHtml`）：

- 仅写入通过检查的状态；模型文本一律 HTML 转义；唯一脚本是固定的 tab 切换，不含模型生成的代码。
- 图片以 data URI 内嵌，不依赖本地接口或外部网络。
- 页脚和顶部横幅保留 MOCK、历史版本、待确认/阻止交付说明。

建议改为服务端生成，以便与主 Agent 的导出一致，需要：

- `GET /api/sessions/:id/works/:version/export?format=report_md|platform_text|interactive_html`
- 响应带 `isMock`、`deliveryStatus`、`currentRequirement`，并保证导出内容保留上述状态说明。
- 若承诺"可离线浏览"，请同时提供一个离线验证（断网加载 HTML、图片可见）。**前端目前没有做离线断网实测**，
  所以文案只说"不依赖本地接口或外部网络"，没有称为"离线包"；也不提供 zip 包。

## 7. 版本化图片与来源访问

现有 `GET /api/tasks/:id/images/:imageId` 总是取**最新版本**，查看旧版本会加载新版本的图片。需要：

- `GET /api/sessions/:id/works/:version/images/:imageId`，只允许访问该版本资料包内的图片。
- 前端对 legacy 接口的处理：只在查看最新版本时给出图片地址，历史版本显示"图片暂不可访问"，不冒用最新版图片。
- 事实/图片来源详情已在 `materialPack` 中，无需新接口；`kb_id` 与密钥不得出现在任何响应中。

## 8. 前端当前形态与证据

- `?backend=api`（或界面右上角"后端"下拉）：旧接口适配器 `legacyClient.ts`，`capabilities` 全部如实为 false 的项会禁用。
  已对本地 `npm run dev:server`（mock 资料、mock 模型）实测：提问 → 回答 → 作品 → 图片 → 刷新。
  旧后端信息齐全后直接生成，**前端无法在其前面加确认门**，界面会显示该限制。刷新后只能恢复任务输入与版本，无法恢复对话。
- 默认：界面模拟服务 `mock/*`（MOCK-UI）。它在浏览器里模拟 B 与服务端的行为，**关键词匹配不代表真实判断**；
  会话记录存 localStorage 以模拟服务端恢复。所有进度步骤标 `simulated`。
- 模拟覆盖：模糊需求、多轮澄清与检索候选、摘要待确认、用户修改摘要、生成与核验、资料冲突阻塞、
  关键需求变更与旧版本失效、过期确认、检索失败、制作中断与恢复。
- 切换到真实会话接口：实现 `AdvisorClient`（`advisor/client.ts`）的 HTTP 版本即可，界面组件不需要改。
