import {
  ModelServiceError,
  type ModelRequest,
  type ModelResponse,
  type ModelService,
  type ModelStatus,
} from "@hwpc/contracts";
import { createMockModelService } from "@hwpc/fixtures";
import type { ServerConfig } from "./config.js";

/**
 * OpenAI 兼容 chat/completions 模型服务。凭证只来自环境变量，不写日志、不返回给前端。
 * 未配置时回退到 mock 模型，状态如实显示 provider=mock。
 * 注意：getStatus 只检查配置是否齐全，不做真实调用（避免消耗额度）；真实可用性需 complete 实测。
 */
export function createModelService(cfg: ServerConfig["model"]): ModelService {
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.name) {
    const mock = createMockModelService();
    return {
      ...mock,
      async getStatus(): Promise<ModelStatus> {
        return {
          state: "not_configured",
          provider: "mock",
          message: "未配置 MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME，当前使用模拟模型",
        };
      },
    };
  }
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let lastError: string | undefined;
  let verified = false;

  return {
    async getStatus(): Promise<ModelStatus> {
      return {
        state: lastError ? "error" : verified ? "connected" : "unverified",
        provider: "openai_compatible",
        modelName: cfg.name,
        message: lastError ?? (verified ? "最近一次调用成功" : "已配置，尚未发生真实调用"),
        lastCheckedAt: new Date().toISOString(),
      };
    },
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.name,
            messages: req.messages,
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            ...(req.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
      } catch (e) {
        const timedOut = timeout.aborted;
        lastError = timedOut ? "模型调用超时" : "模型服务无法连接";
        throw new ModelServiceError(timedOut ? "timeout" : "upstream_error", lastError);
      }
      if (!res.ok) {
        lastError = `模型服务返回 HTTP ${res.status}`;
        throw new ModelServiceError(res.status === 401 || res.status === 403 ? "unauthorized" : "upstream_error", lastError);
      }
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        lastError = "模型响应缺少 choices[0].message.content";
        throw new ModelServiceError("bad_output", lastError);
      }
      lastError = undefined;
      verified = true;
      return {
        text,
        usage: { promptTokens: body.usage?.prompt_tokens, completionTokens: body.usage?.completion_tokens },
        simulated: false,
      };
    },
  };
}
