/**
 * 模型调用守卫。所有模型调用必须声明用途：
 *  - understanding：理解需求，任何阶段可用；
 *  - generation：最终作品生成，只有程序级门控通过才放行。
 * 用途写入 system 消息首行标记，便于审计与测试区分。
 */
import type { ChatMessage, ModelRequest, ModelResponse, ModelService } from "@hwpc/contracts";
import { evaluateGate } from "./gate.js";
import { ConsultantError, audit } from "./state.js";
import type { ConversationState } from "./types.js";

export type ModelPurpose = "understanding" | "generation" | "repair";
export const PURPOSE_TAG = (p: ModelPurpose) => `[PURPOSE:${p}]`;
export const purposeOf = (messages: ChatMessage[]): ModelPurpose | undefined => {
  const m = messages[0]?.content.match(/^\[PURPOSE:(understanding|generation|repair)\]/);
  return m?.[1] as ModelPurpose | undefined;
};

export interface GuardedModel {
  call(purpose: ModelPurpose, system: string, user: string, opts?: Omit<ModelRequest, "messages">): Promise<ModelResponse>;
}

export function guardModel(model: ModelService, state: ConversationState, now: () => Date): GuardedModel {
  return {
    async call(purpose, system, user, opts = {}) {
      const at = now().toISOString();
      if (purpose !== "understanding") {
        const gate = evaluateGate(state);
        if (!gate.allowed) {
          audit(state, at, { type: "model_call_refused", purpose, detail: `门控未通过：${gate.failed.join(",")}` });
          throw new ConsultantError("generation_blocked", `生成门控未通过：${gate.failed.join("、")}`, gate);
        }
      }
      audit(state, at, { type: "model_call", purpose });
      return model.complete({ ...opts, messages: [{ role: "system", content: `${PURPOSE_TAG(purpose)}\n${system}` }, { role: "user", content: user }] });
    },
  };
}
