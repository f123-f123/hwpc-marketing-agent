import {
  DataServiceError,
  type ClarificationAnswer,
  type DataService,
  type ImageContent,
  type ImageRecord,
  type MarketingTaskInput,
  type MarketingWorkflow,
  type MaterialRequest,
  type ModelRequest,
  type ModelResponse,
  type ModelService,
  type ModelStatus,
  type ProductSearchResult,
  type ResultVersion,
  type SourceStatus,
  type WorkflowCheckpoint,
  type WorkflowContext,
  type WorkflowDeps,
  type WorkflowOutcome,
} from "@hwpc/contracts";
import { buildMockMaterialPack, mockProducts } from "./data.js";
import { buildMockResultVersion } from "./result.js";

/** 模拟资料服务：仅用于联调。永远返回 origin="mock"。 */
export function createMockDataService(): DataService {
  return {
    async getStatus(): Promise<SourceStatus[]> {
      return [{ origin: "mock", state: "connected", enabled: true, message: "模拟数据（非真实资料）" }];
    },
    async searchProducts(query: string): Promise<ProductSearchResult> {
      const q = query.trim().toLowerCase().replace(/\s+/g, "");
      const hit = mockProducts.filter((p) =>
        [p.model, p.family, ...p.aliases].some((n) => {
          const t = n.toLowerCase().replace(/\s+/g, "");
          return t.includes(q) || q.includes(t);
        }),
      );
      const exact = hit.length === 1 ? hit[0] : undefined;
      const needConfig = exact !== undefined && exact.configurations.length > 1;
      const ambiguous = hit.length > 1 || needConfig;
      return {
        query,
        candidates: hit,
        ambiguous,
        disambiguation: ambiguous
          ? {
              question: needConfig ? "该型号有多个配置，请选择要写的配置" : "命中多个型号，请选择具体型号",
              options: needConfig
                ? exact!.configurations.map((c) => ({ productId: exact!.productId, configurationId: c.configurationId, label: c.label }))
                : hit.map((p) => ({ productId: p.productId, label: p.model })),
            }
          : undefined,
      };
    },
    async getMaterialPack(request: MaterialRequest) {
      if (!mockProducts.some((p) => p.productId === request.product.productId)) {
        throw new DataServiceError("not_found", `mock 中没有产品 ${request.product.productId}`, "mock");
      }
      return buildMockMaterialPack(request.taskId, request.product.productId);
    },
    async readImage(image: ImageRecord): Promise<ImageContent> {
      const label = image.access.kind === "mock_placeholder" ? image.access.label : image.imageId;
      const esc = label.replace(/[<>&"]/g, "");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" font-size="48" text-anchor="middle" fill="#6b7280">${esc} (MOCK)</text></svg>`;
      return { mimeType: "image/svg+xml", bytes: new TextEncoder().encode(svg) };
    },
  };
}

/** 模拟模型：不调用任何外部服务，返回固定 JSON/文本，simulated=true。 */
export function createMockModelService(): ModelService {
  return {
    async getStatus(): Promise<ModelStatus> {
      return { state: "connected", provider: "mock", message: "模拟模型（不调用真实模型）" };
    },
    async complete(_request: ModelRequest): Promise<ModelResponse> {
      return { text: JSON.stringify({ mock: true }), simulated: true };
    },
  };
}

/**
 * 模拟工作流：用于在 Agent B 交付前打通服务端与前端。
 * 行为：缺平台 → 追问；型号歧义 → 追问；否则返回固定模拟结果。事件均 simulated=true。
 */
export function createMockWorkflow(_deps?: WorkflowDeps): MarketingWorkflow {
  const finish = (taskId: string, ctx: WorkflowContext, note?: string): WorkflowOutcome => {
    const base = buildMockResultVersion(taskId);
    const { version: _v, createdAt: _c, reason: _r, ...result } = base;
    for (const stage of ["material_retrieval", "drafting", "verification", "compliance"] as const) {
      ctx.emit({ stage, type: "stage_completed", message: `（模拟）${stage} 完成`, simulated: true });
    }
    if (note) result.article = { ...result.article, title: `${result.article.title}｜${note}` };
    return { kind: "completed", result };
  };

  const ask = (input: MarketingTaskInput, taskId: string, ctx: WorkflowContext): WorkflowOutcome | undefined => {
    ctx.emit({ stage: "scenario_analysis", type: "stage_started", message: "（模拟）解析任务", simulated: true });
    const questions = [];
    if (!input.platform) {
      questions.push({
        questionId: "q-platform",
        kind: "missing_info" as const,
        field: "platform",
        prompt: "要发布到哪个平台？",
        options: [
          { value: "wechat_article", label: "公众号" },
          { value: "xiaohongshu", label: "小红书" },
          { value: "store_moments", label: "门店朋友圈" },
          { value: "store_poster", label: "门店海报" },
        ],
        allowFreeText: false,
      });
    }
    if (questions.length === 0) return undefined;
    ctx.emit({ stage: "scenario_analysis", type: "clarification_requested", message: "（模拟）信息不足，需要补充", simulated: true });
    const checkpoint: WorkflowCheckpoint = { taskId, resumeStage: "scenario_analysis", state: { input } };
    return { kind: "needs_clarification", questions, checkpoint };
  };

  return {
    async run(input, ctx) {
      return ask(input, ctx.taskId, ctx) ?? finish(ctx.taskId, ctx);
    },
    async resume(checkpoint: WorkflowCheckpoint, answers: ClarificationAnswer[], ctx) {
      const input = { ...(checkpoint.state["input"] as MarketingTaskInput) };
      for (const a of answers) if (a.questionId === "q-platform") input.platform = a.answer as MarketingTaskInput["platform"];
      return ask(input, ctx.taskId, ctx) ?? finish(ctx.taskId, ctx);
    },
    async revise(_previous: ResultVersion, _input: MarketingTaskInput, instruction: string, ctx) {
      ctx.emit({ stage: "drafting", type: "stage_started", message: "（模拟）按修改要求重写", simulated: true });
      return finish(ctx.taskId, ctx, `修改：${instruction.slice(0, 20)}`);
    },
  };
}
