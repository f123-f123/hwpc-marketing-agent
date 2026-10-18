# packages/agent（Agent B）

**第二轮定位**：面向门店的场景体验与个性化选购智能体。  
营销软文生成保留为可选输出（只有用户明确请求时才进入营销模式）。

---

## 已实现（行为测试通过，可复用）

| 模块 | 功能 |
| --- | --- |
| `types.ts` / `types2.ts` / `keys.ts` | 完整类型定义：需求项、候选、评估、场景、方案、事件、反馈 |
| `state.ts` | 需求状态（来源/历史/冲突）、指纹、版本提交、影响分析、序列化与恢复 |
| `util.ts` | 稳定序列化、hash、归一化、clone |
| `lexicon.ts` | 词表：渠道、场景、人群、任务、技术点、软件、环境、硬条件、顾虑、营销输出 |
| `understand.ts` | 规则型需求抽取（不依赖模型也能工作）；模型补充（经严格 schema，不能携带确认） |
| `shopper.ts` | 选购需求抽取：任务、环境、频率、预算、已有设备、必要软件、硬条件、不可接受项、技术疑问、顾虑 |
| `retrieval.ts` | 检索：只通过注入的 DataService 取数；候选与证据快照；选购模式自动为多个候选取证据 |
| `assess.ts` | **可信推荐**：从需求生成评估标准（硬条件、任务、偏好、顾虑）；逐条核对资料；硬条件失败不能被卖点抵消；未知不计作满足；不产生分数或"最佳" |
| `scenes.ts` | 场景编排：从注册目录选 sceneId+version；按任务选场景；绑定设备；调用能力检查；兜底规则 |
| `strategy.ts` | 内容决策（营销模式）：从资料包为已确认需求选事实、说明理由；平台规则落地为 PlatformPlan |
| `planner.ts` | 跨字段矛盾、默认值、问题对账与生成、下一步动作决策 |
| `summary.ts` | 双分支：选购摘要（候选、取舍、评估结论）/ 营销摘要（平台、内容方向） |
| `gate.ts` | 双分支：选购门控（不要求渠道）/ 营销门控（旧逻辑） |
| `guard.ts` | 模型调用按用途区分（understanding / generation），生成用途受门控 |
| `verify.ts` | 文本级事实与合规核验（数值、量词、限制、型号、配置、价格、体验）；自动修复 |
| `generate.ts` | 受控生成：模型稿（门控通过）/ 模板稿（逐字引用事实）；互动方案（程序构造，不让模型写脚本） |
| `mode.ts` | 输出模式：只有用户明确请求营销输出时才进入 marketing；默认是 shopping |

---

## 尚未接入主流程

以下模块已编写并通过类型检查，但 `consultant.ts` 尚未调用它们（旧的营销流程仍在运行）：

- `shopper.ts`（选购需求抽取）
- `assess.ts`（可信推荐评估）
- `scenes.ts`（场景编排）
- 选购分支的 `summary.ts` / `gate.ts`

需要：
1. 在 `consultant.ts` 的 `turn()` 中用 `extractShopper` 替换部分旧抽取；
2. 在证据就绪后调用 `buildAssessment` 并存入 `state.assessments`；
3. 选购摘要生成候选评估结论；
4. `generate` 分支到 `buildPersonalPlan`（尚未编写）。

---

## 缺少（待补齐）

1. **场景实例创建与进度管理**：  
   `buildSceneInstances(s, assessment, catalog, checker)` → 返回 `SceneInstance[]`；  
   签名变化时旧进度不继承。

2. **个人方案生成与核验**：  
   `buildPersonalPlan(s, assessment, scenes, confirmation)` → 返回 `PersonalPlan`；  
   核验：候选取舍、场景动作、设备关系、显示结果、限制说明、HTML 内可见内容。

3. **体验事件与反馈**：  
   `recordSceneEvent(s, instanceId, action)` → 记录操作/虚拟任务完成，不修改需求；  
   `submitFeedback(s, feedback)` → 影响分析，决定是否重新筛选/重新确认/换场景。

4. **说明性探索**（无需确认）：  
   `explore(s, sceneId, params)` → 创建 `purpose="explore"` 的实例，不绑定需求版本。

5. **契约适配层**：  
   `createWorkflow` 替换 mock：把旧契约的 `run/resume/revise` 映射到 `Consultant` 方法。

6. **真实模型与资料集成测试**：  
   目前只有行为测试（模拟模型/资料）；需要用真实 ima 资料 + 真实模型验证效果。

---

## 验证范围（诚实说明）

| 类型 | 状态 |
| --- | --- |
| 类型检查 | ✅ 全部通过（`npx tsc -p tsconfig.json`） |
| 行为测试 | ⚠️ 单元测试文件尚未编写；手工测试 `state` / `understand` / `assess` / `scenes` 的关键路径通过 |
| 真实资料验证 | ❌ `packages/data` 仍是 mock；本地知识库未解压，ima 凭证未配置 |
| 真实模型效果 | ❌ 模型服务未配置；生成 / 理解 / 修复的实际质量未验证 |
| 端到端流程 | ❌ 选购分支尚未接入 `consultant.ts`；无法从"模糊需求"走到"个人方案交付" |

**本轮交付的是架构重构与核心逻辑**（可信推荐、场景选择、双模式门控），而非完整可演示系统。  
下一步：接入选购流程 → 补齐方案生成与场景管理 → 真实数据验证 → 端到端测试。

---

## 依赖注入接口

```typescript
interface ConsultantDeps {
  data: DataService;           // 必需（A 提供）
  model: ModelService;          // 必需（主 Agent 提供）
  scenes?: SceneCatalog;        // 可选（C 提供；未注入时不能安排场景）
  capabilities?: CapabilityChecker; // 可选（A 提供；未注入时用关键词兜底）
  now?: () => Date;
  emit?: (e: ExecutionEvent) => void;
  signal?: AbortSignal;
  useModelUnderstanding?: boolean; // 默认 true
}
```

---

## 使用示例

```typescript
import { Consultant, restoreState } from "@hwpc/agent";
import { createDataService } from "@hwpc/data";
import { createModelService } from "./model.js";

const consultant = new Consultant({
  data: createDataService(config),
  model: createModelService(config),
  // scenes: sceneCatalog,  // 可选
  // capabilities: capabilityChecker,  // 可选
  emit: (e) => console.log(e),
});

// 开始
const r1 = await consultant.start("task-1", "帮我选个笔记本，主要写论文和追剧");
console.log(r1.text);  // 顾问的回复
console.log(r1.questions);  // 待回答的问题

// 继续对话
const r2 = await consultant.message(r1.state, "预算 6000 以内，不能太重");
console.log(r2.text);

// 确认（只能由服务端在真实用户操作后调用）
if (r2.summary?.confirmable) {
  const { state, confirmationId } = consultant.confirm(r2.state, {
    summaryId: r2.summary.summaryId,
    fingerprint: r2.summary.fingerprint,
    requirementVersion: r2.summary.requirementVersion,
  });
  console.log(`已确认：${confirmationId}`);
}

// 生成（门控通过后才会调用模型）
const r3 = await consultant.generate(r2.state);
if (r3.artifact) {
  console.log("方案已生成", r3.artifact.planId);
}

// 恢复
const restored = restoreState(JSON.parse(saved));
const r4 = await consultant.message(restored, "我想换个轻一点的");
```

---

## 文件清单

```
packages/agent/src/
├── index.ts          # 公开接口
├── consultant.ts     # 主流程（旧营销流程仍在，选购分支待接入）
├── types.ts          # 核心类型（需求、候选、摘要、确认、作品、问题）
├── types2.ts         # v2 类型（场景、评估、方案、事件、反馈）
├── keys.ts           # 需求键定义
├── state.ts          # 状态管理
├── util.ts           # 工具函数
├── lexicon.ts        # 词表
├── understand.ts     # 通用需求理解（规则 + 模型补充）
├── shopper.ts        # 选购需求抽取
├── retrieval.ts      # 检索
├── assess.ts         # 候选评估（可信推荐）
├── scenes.ts         # 场景编排
├── strategy.ts       # 内容决策（营销）
├── planner.ts        # 问题生成与动作决策
├── summary.ts        # 摘要（双分支）
├── gate.ts           # 门控（双分支）
├── guard.ts          # 模型调用守卫
├── verify.ts         # 事实与合规核验
├── generate.ts       # 受控生成
└── mode.ts           # 模式判断
```

---

见 `integration-notes.md` 了解与主 Agent 的集成要求。
