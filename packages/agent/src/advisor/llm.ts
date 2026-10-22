/**
 * 大模型只做两件事：把用户原话补充解析成需求编辑、把程序拼好的回复改写得更像人说话。
 * 候选筛选、证据、追问一律由程序完成；模型输出要过代码门槛，不过就用规则版。
 *
 * 门槛：
 * - 改写后的回复里出现的每个数字，都必须出现在给模型的资料里（防止编参数、编价格）；
 * - 不能声称“已确认 / 已下单 / 保证”；
 * - 需求编辑的 quote 必须是用户原话（服务端还会再核一遍）。
 */
import { NeedEditSchema, NeedKeySchema, type ModelService, type NeedEdit } from "@hwpc/contracts";
import { z } from "zod";

export type ModelResolver = () => ModelService | undefined;

const numbers = (s: string) => [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);

/** 回复里的数字都能在资料里找到。 */
export function numbersGrounded(reply: string, material: string): boolean {
  const pool = new Set(numbers(material));
  return numbers(reply).every((n) => pool.has(n) || Number(n) <= 3);
}

const FORBIDDEN = /已确认|帮你下单|已下单|保证|绝对|最好的|第一|唯一/;

function jsonOf(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("模型没有返回 JSON");
  return JSON.parse(cleaned.slice(s, e + 1));
}

const REWRITE_SYSTEM = `你是华为门店的选购顾问，正在和顾客聊天。
你会拿到一份程序整理好的材料（JSON）：顾客刚说的话、记下的需求、知识库筛出的候选及证据、知识库检索到的提醒、接下来要问的问题，以及一段规则版回复。
请把规则版回复改写成自然、亲切、简洁的中文口语（不超过 220 字），要求：
1. 只能使用材料里出现过的型号、数字、价格和事实，不得新增任何参数、价格、功能或评价；
2. 价格必须带上价格类型（如“官方商城页面价”“官网参考起价”），重量、续航要保留“约”“额定容量”等限定；
3. 不要说“已确认”“保证”“最好”，确认只能由顾客点按钮完成；
4. 结尾自然地引出材料里的下一个问题（如果有）；不要列出问题的选项；
5. 输出 JSON：{"reply": "..."}。`;

export async function rewriteReply(model: ModelService, material: Record<string, unknown>, fallback: string, signal?: AbortSignal): Promise<{ text: string; used: boolean; error?: string }> {
  const payload = JSON.stringify(material);
  try {
    const res = await model.complete({
      messages: [
        { role: "system", content: REWRITE_SYSTEM },
        { role: "user", content: payload },
      ],
      json: true,
      temperature: 0.4,
      maxTokens: 700,
      signal,
    });
    if (res.simulated) return { text: fallback, used: false, error: "模型为模拟模式" };
    const reply = z.object({ reply: z.string().min(4).max(800) }).parse(jsonOf(res.text)).reply.trim();
    if (!numbersGrounded(reply, payload)) return { text: fallback, used: false, error: "改写里出现了资料中没有的数字" };
    if (FORBIDDEN.test(reply)) return { text: fallback, used: false, error: "改写里出现了禁用表述" };
    return { text: reply, used: true };
  } catch (e) {
    return { text: fallback, used: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const EXTRACT_SYSTEM = `从顾客这句话里抽取选购需求，输出 JSON：{"edits":[{"key":"...","value":"...","quote":"..."}]}
key 只能是：task（用途）、environment（使用环境与频率）、budget（预算）、existingDevices（已有设备）、requiredSoftware（必须用的软件）、hardConstraints（硬条件，不满足就不要）、preferences（偏好）、concerns（顾虑）。
value 用简短中文概括；quote 必须逐字摘自顾客原话。没有就输出空数组。不要编造顾客没说的内容。`;

const ExtractSchema = z.object({
  edits: z.array(z.object({ key: NeedKeySchema, value: z.string().min(1).max(120), quote: z.string().min(1).max(200) })).max(8),
});

/** 模型补充抽取；只保留 quote 出自原话、且规则没有覆盖到的维度。 */
export async function extractWithModel(model: ModelService, text: string, ruleEdits: NeedEdit[], signal?: AbortSignal): Promise<NeedEdit[]> {
  try {
    const res = await model.complete({ messages: [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: text }], json: true, temperature: 0, maxTokens: 500, signal });
    if (res.simulated) return [];
    const parsed = ExtractSchema.parse(jsonOf(res.text));
    const covered = new Set(ruleEdits.flatMap((e) => (e.op === "set" ? [e.key] : [])));
    return parsed.edits
      .filter((e) => text.includes(e.quote) && !covered.has(e.key))
      .map((e) => NeedEditSchema.parse({ op: "set", key: e.key, value: e.value, quote: e.quote, status: "known", note: "模型补充理解" }));
  } catch {
    return [];
  }
}

const QA_SYSTEM = `你是华为门店的答疑助手。顾客在看一份为他生成的选购体验页，向你提问。
你会拿到 JSON 材料：问题、页面里的候选与方案、相关产品事实、知识库检索摘录，以及一段规则版回答。
请用自然的中文回答（不超过 260 字）：
1. 只能使用材料里的事实、数字和原文，不得补充材料外的参数、价格、兼容性或评价；材料不够就直说“资料里没有”，建议到店用真机核对；
2. 涉及数字时保留限定条件（如“典型值”“以实际销售版本为准”）；
3. 不修改顾客的需求和方案；如果顾客想改需求，提醒他回到需求沟通；
4. 输出 JSON：{"reply": "..."}。`;

export async function rewriteAnswer(model: ModelService, material: Record<string, unknown>, fallback: string, signal?: AbortSignal) {
  const payload = JSON.stringify(material);
  try {
    const res = await model.complete({ messages: [{ role: "system", content: QA_SYSTEM }, { role: "user", content: payload }], json: true, temperature: 0.3, maxTokens: 800, signal });
    if (res.simulated) return { text: fallback, used: false };
    const reply = z.object({ reply: z.string().min(2).max(1200) }).parse(jsonOf(res.text)).reply.trim();
    if (!numbersGrounded(reply, payload) || FORBIDDEN.test(reply)) return { text: fallback, used: false };
    return { text: reply, used: true };
  } catch {
    return { text: fallback, used: false };
  }
}
