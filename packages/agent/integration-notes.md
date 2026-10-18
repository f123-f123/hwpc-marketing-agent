# packages/agent 集成说明（Agent B → 主 Agent）

状态：第二轮方向调整（营销软文生成器 → 面向门店的场景体验与个性化选购智能体）。
本文随实现更新；"已实现"只表示代码与行为测试存在，见文末"验证范围"。

## 1. 定位变化

核心闭环：理解顾客 → 筛选候选并解释取舍 → 安排可操作场景 → 收集明确反馈 → 调整选购方案 → 保存并继续决策。
营销软文（赛题图文）降为可选输出：只有用户请求时才要求发布渠道等营销字段。

## 2. 可复用（保留，未重写）

| 模块 | 内容 |
| --- | --- |
| `state.ts` | 需求项（来源/历史/冲突）、指纹、版本提交、影响分析、序列化与恢复 |
| `understand.ts` | 一段自由表达映射多个需求项；模型输出不能携带确认 |
| `retrieval.ts` | 仅通过注入的 DataService 取数；候选与证据快照 |
| `gate.ts` | 程序级门控；确认绑定需求版本与摘要指纹 |
| `guard.ts` | 模型调用按用途区分（understanding / generation），生成用途受门控 |
| `verify.ts` | 文本级事实与合规核验（数值、量词、限制、型号、配置、价格、体验） |

## 3. 旧假设已改

- 营销字段（platform / deliveryFormat / goal / mustEmphasize）仅在 `outputRequest=marketing_article` 时必填。
- 互动方案不再强制同时生成平台文章（删除 `requiresPlatformArticle`）。
- "互动只能改变展示"分层：场景内操作只改变场景状态；用户**明确反馈**才可进入需求/方案更新。
- 摘要 `sections` 由固定 8 键改为有序数组 `{key,label,text}[]`。

## 4. 新增公共契约（待主 Agent 契约化）

1. `SceneCatalog`（由 C 编写、主 Agent 提供目录接口，注入 `ConsultantDeps.scenes`）：
   `list()` / `get(sceneId, version?)` 返回 `SceneDefinition`（见 `scenes.ts`）。B 只引用 `sceneId+version`，不生成场景代码。
2. `CapabilityChecker`（A 的证据能力检查，注入 `ConsultantDeps.capabilities`，可选）：
   `check({productRef, capabilityId}) → {status: supported|unsupported|unknown|conflict, factIds, note?}`。
   未注入时 B 用资料包事实的关键词规则兜底，且兜底只会给出 supported（有事实）或 unknown，不会凭空 supported。
   **希望 A 提供权威实现**。
3. 状态与动作：`ConversationState`（v2，旧 v1 可恢复）、`PersonalPlan`、`ExperienceEvent`、`Feedback`、`FeedbackImpact`。
   Consultant 方法：`start/message/confirm/editSummary/generate/explore/recordSceneEvent/submitFeedback/refreshEvidence/revise`。
4. 服务端必须在受理 generate 前调用 `evaluateGate(state)`；前端按钮禁用不是保障。
5. 确认只能由服务端在真实用户操作后调用 `confirm()`；聊天文本中的"确认"和模型输出的 confirmed 字段都会被忽略并写审计。
6. 事件：B 通过 `emit` 只报告真实发生的数据访问与阶段；模拟模型/资料产生的事件带 `simulated=true`。

## 5. 持久化

B 不写文件。每个公开方法返回新的完整 `ConversationState`（JSON 可序列化），主 Agent 原样保存，
下次调用传回。`restoreState` 用 schema 校验，损坏则拒绝。

## 6. 验证范围（诚实说明）

见 `README.md` 末尾的测试报告：模拟行为测试 / 真实资料验证 / 真实模型效果分别报告。
