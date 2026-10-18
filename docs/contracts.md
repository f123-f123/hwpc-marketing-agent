# 协作契约（contracts）

公共契约位于 `packages/contracts/src`，由主控（根配置、契约、服务端）维护。Agent A/B/C 只修改各自目录；需要新依赖或契约变更时，在自己目录写 `integration-notes.md`。

## 1. 模块入口

| 目录 | 负责人 | 入口 | 需要实现 |
| --- | --- | --- | --- |
| `packages/contracts` | 主控 | `src/index.ts` | 类型、zod schema、HTTP 路径、一致性检查 |
| `apps/server` | 主控 | `src/main.ts` | HTTP 接口、内存任务存储、模型调用、导出 |
| `packages/data` | Agent A | `src/index.ts` 的 `createDataService(config)` | `DataService`（local / ima / mock） |
| `packages/agent` | Agent B | `src/index.ts` 的 `createWorkflow(deps)` | `MarketingWorkflow`（run / resume / revise） |
| `apps/web` | Agent C | `src/App.tsx` | 界面，通过 `API_PATHS` 与 schema 调用后端 |
| `fixtures` | 主控 | `src/index.ts` | 模拟数据与模拟服务，均标明 MOCK |

`data` 和 `agent` 目前返回 fixtures 里的 mock 实现。替换实现时函数签名不变，服务端无需改动。

## 2. 公共数据结构

| 结构 | 文件 | 要点 |
| --- | --- | --- |
| `MarketingTaskInput` | `task.ts` | 至少给出 `rawRequest` / `productQuery` / `productRef` 之一，其余可选 |
| `ClarificationQuestion` / `Answer` | `task.ts` | `kind`：缺信息、型号歧义、配置选择、冲突确认、断言确认 |
| `ProductIdentity` | `product.ts` | 型号 `model` 与配置 `configurations[]` 分开；`ProductRef` 可只到型号，也可细化到配置 |
| `FactRecord` | `material.ts` | 带 `source`、`qualifiers`（限制条件）、`configurationIds`（空 = 全配置通用） |
| `ImageRecord` | `material.ts` | 带 `source`、适用 `productId` / `configurationIds`、`role` 用途、`access` 访问方式 |
| `MaterialPack` / `MaterialConflict` | `material.ts` | `gaps` 记录缺口；`isMock` 必须与来源一致 |
| `ContentStrategy` | `strategy.ts` | `angle`（切入点）与 `platformPlan`（结构、字数、语气、图片数、引导）可检查 |
| `Article` | `article.ts` | `blocks` 按顺序混排段落和图片；段落绑 `factIds`，图片块绑 `imageId` 并带说明和位置理由 |
| `VerificationReport` | `verification.ts` | `findings`（含处理结果）、`pendingConfirmations`、`deliveryStatus` |
| `WorkflowEvent` / `ExecutionEvent` | `run.ts` | 只报告真实发生的事；`simulated=true` 表示 mock 产生 |
| `ResultVersion` | `run.ts` | 一次完整结果：策略 + 图文 + 核验 + 资料包；版本号从 1 递增 |

`ImageAccess.kind`：`local_file`、`remote_url`、`ima_media`、`mock_placeholder`。前端不直接访问这些地址，统一走 `GET /api/tasks/:id/images/:imageId`。

### 一致性检查（`validate.ts`）

schema 之外，`checkMaterialPack` 和 `checkResultVersion` 检查引用关系，服务端在保存每个版本前强制执行（`parseResultVersion`）：

- 事实、图片的产品和配置必须存在于资料包。
- 段落、策略、核验项引用的 `factId` / `imageId` 必须存在。
- 来源含 mock 时，`isMock` 必须为 true，图片必须是 `mock_placeholder`。
- 有待确认项时，`deliveryStatus` 不能是 `deliverable` 或 `deliverable_with_notes`。
- 存在 `unresolved` 的资料冲突时，`deliveryStatus` 必须是 `blocked`。

## 3. 资料层接口 `DataService`

```ts
interface DataService {
  getStatus(signal?): Promise<SourceStatus[]>;            // 连接状态、账号（脱敏）、知识库
  searchProducts(query, signal?): Promise<ProductSearchResult>; // 歧义时 ambiguous=true + disambiguation
  getMaterialPack(request: MaterialRequest): Promise<MaterialPack>;
  readImage(image: ImageRecord, signal?): Promise<ImageContent>;
}
```

约定：

- 资料不可用时抛 `DataServiceError(code, message, origin)`，不得返回编造内容。
- 每条事实和图片必须带真实 `SourceRef`；`origin` 取 `local` / `ima` / `mock`。
- 凭证只读环境变量，不进入任何返回值。账号信息只返回脱敏后的 `clientIdMasked`。
- `kb_id` 只在内部使用，不进入契约。
- ima 搜索无结果不等于无权限：应按目录回退（赛题 §六）。

`SourceStatus.state`：`connected`（已真实验证）、`not_configured`、`error`、`unverified`（已配置未调用）。

## 4. 工作流接口 `MarketingWorkflow`

```ts
interface MarketingWorkflow {
  run(input, ctx): Promise<WorkflowOutcome>;
  resume(checkpoint, answers, ctx): Promise<WorkflowOutcome>;
  revise(previous: ResultVersion, input, instruction, ctx): Promise<WorkflowOutcome>;
}
type WorkflowOutcome =
  | { kind: "needs_clarification"; questions; checkpoint }
  | { kind: "completed"; result };   // 服务端补 version / createdAt / reason / instruction
```

- 依赖通过 `createWorkflow({ data, model })` 注入。工作流不读环境变量，不自己创建客户端。
- `ctx.emit(event)` 报告真实事件，服务端补 `seq` / `taskId` / `at`。mock 实现必须 `simulated: true`。
- 澄清触发：必要信息缺失、型号或配置歧义、资料冲突、用户要求资料中没有的内容（如价格）。
- `checkpoint.state` 由工作流自定，必须可 JSON 序列化，服务端原样保存并在 `resume` 时传回。
- 抛出的异常会使任务进入 `failed`，错误名和消息写入任务与事件。

## 5. 模型服务 `ModelService`

服务端实现（`apps/server/src/model.ts`），OpenAI 兼容 `chat/completions`。未配置时回退 mock 模型，状态显示 `provider: "mock"`。`getStatus` 只检查配置，不发真实请求；`connected` 表示最近一次调用成功。

## 6. HTTP 接口

所有路径在 `API_PATHS`，请求和响应 schema 在 `api.ts`。JSON，无需认证（仅绑定 127.0.0.1，见第 9 节）。

| 方法与路径 | 说明 | 成功响应 |
| --- | --- | --- |
| `GET /api/health` | 存活检查 | 200 |
| `GET /api/status` | 连接状态（资料来源、账号脱敏、知识库、模型、`mockInUse`） | 200 `ConnectionStatus` |
| `GET /api/products/search?q=` | 搜索产品，含歧义选项 | 200 `ProductSearchResult` |
| `POST /api/tasks` | 提交任务，`{ input }` | 202 `{ taskId, status }` |
| `GET /api/tasks/:id` | 任务状态、待答问题、最新版本 | 200 `TaskSnapshot` |
| `GET /api/tasks/:id/events?after=<seq>` | 执行事件，增量轮询 | 200 `{ events, lastSeq }` |
| `POST /api/tasks/:id/answers` | 回答澄清，`{ answers: [{questionId, answer}] }` | 202 |
| `POST /api/tasks/:id/revisions` | 修改要求，`{ instruction, inputPatch? }` | 202，完成后新增版本 |
| `GET /api/tasks/:id/export?format=markdown\|text\|json&version=` | 导出 | 200 `ExportResponse` |
| `GET /api/tasks/:id/images/:imageId` | 图片内容（经服务端读取） | 200 二进制 |

轮询建议：任务状态 1 秒一次；`events?after=lastSeq` 同频。状态为 `completed` / `failed` / `awaiting_clarification` 时停止轮询。

### 任务状态与转换

```
queued ──> running ──> completed ──(revisions)──> running
              │  ▲
              ▼  │(answers)
   awaiting_clarification
任意进行中状态 ──> failed
```

允许的转换见 `TASK_TRANSITIONS`。POST 创建、回答、修改后，任务立即进入 `running`（接口返回时状态已更新），工作流异步执行。

### 错误语义

响应体统一为 `{ "error": { "code", "message", "details"? } }`。

| code | HTTP | 含义 |
| --- | --- | --- |
| `validation_error` | 400 | 请求体、参数不合法，或回答缺少/多出问题编号。`details` 为 zod issues |
| `not_found` | 404 | 任务、版本、图片不存在 |
| `invalid_state` | 409 | 当前状态不允许该操作（如非 `awaiting_clarification` 时回答，非 `completed` 时修改） |
| `data_unavailable` | 503 | 资料来源未配置、鉴权失败或上游错误。`details.code` 为 `DataErrorCode` |
| `model_unavailable` | 503 | 模型服务不可用 |
| `workflow_unavailable` | 501 | 预留 |
| `internal_error` | 500 | 未预期异常，不泄露内部细节 |

工作流执行中的失败不走 HTTP 错误，而是任务进入 `failed`，`TaskSnapshot.error` 给出原因。

## 7. 字段示例

任务输入：

```json
{
  "input": {
    "productQuery": "示例本 Air 14",
    "productRef": { "productId": "mock-air-14", "configurationId": "mock-air-14-std" },
    "audience": "大学新生",
    "scenario": "back_to_school",
    "platform": "xiaohongshu",
    "extraRequirements": "不要提价格"
  }
}
```

事实（节选）：

```json
{
  "factId": "mock-f-003", "productId": "mock-air-14", "configurationIds": [],
  "category": "battery", "field": "续航", "value": "视频播放最长 10 小时（虚构）",
  "qualifiers": ["实验室数据，实际使用因场景而异（虚构）"],
  "source": { "origin": "mock", "title": "【MOCK】mock-air-14 规格", "locator": "mock://mock-air-14/facts.md" }
}
```

图文块：

```json
{ "type": "paragraph", "heading": "撑一天", "text": "……", "factIds": ["mock-f-003"] }
{ "type": "image", "imageId": "mock-i-002", "caption": "校园场景", "placementReason": "紧跟携带段落，呼应场景" }
```

澄清问题：

```json
{ "questionId": "q-platform", "kind": "missing_info", "field": "platform",
  "prompt": "要发布到哪个平台？",
  "options": [{ "value": "xiaohongshu", "label": "小红书" }], "allowFreeText": false }
```

完整样例见 `fixtures/src/data.ts` 与 `fixtures/src/result.ts`。

## 8. 模拟数据（MOCK）

`@hwpc/fixtures` 提供：

- `mockProducts`、`mockFacts`、`mockImages`：虚构的“示例本 Air 14 / 16”，含两个配置（标准版 / SE 版）用于型号与配置区分。
- `buildMockMaterialPack(taskId, productId?)`：单型号资料包。
- `buildMockConflictPack(taskId)`：含未解决冲突，用于测试停止与人工确认。
- `buildMockResultVersion()`：完整结果（小红书 + 开学季）。
- `mockTaskInput` / `mockIncompleteTaskInput` / `mockAmbiguousTaskInput`：完整、信息不足、型号歧义三类输入。
- `createMockDataService()` / `createMockModelService()` / `createMockWorkflow()`。

约束：所有记录 `origin: "mock"`，名称带“【MOCK】”前缀，图片为 SVG 占位图。导出文本带 MOCK 横幅。界面在 `ConnectionStatus.mockInUse` 为 true 或结果 `isMock` 为 true 时必须常驻提示。不得把 mock 内容当作真实华为资料或真实 ima 调用展示。

## 9. 配置与安全

- 环境变量见 `.env.example`；ima 变量名与赛题手册一致（`IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY`）。
- 凭证只从环境变量读取；日志与接口只输出脱敏值。
- 服务端当前**没有身份认证**，只绑定 `127.0.0.1`。在线部署前必须增加访问控制、限流，并重新评估 CORS。
- 本地知识库解压目录放在 `code/local-data/`（已被 `.gitignore` 忽略），不要提交。
- 任务存储在内存中，重启即丢失。

## 10. 变更流程

1. Agent 在自己目录写 `integration-notes.md`：需要的依赖（包名、版本、理由）、契约变更（字段、原因、影响面）。
2. 主控统一处理根配置、锁文件和 `packages/contracts`，并更新本文档。
3. 契约变更后，各 Agent 以 `packages/contracts` 的最新类型为准。
