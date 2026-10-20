/**
 * 系统设置（总部维护）：写作模型、公众号接口地址、小红书发布接口。
 * 优先级：界面保存的设置 > 环境变量（MODEL_BASE_URL / MODEL_API_KEY / MODEL_NAME）。
 * 密钥加密保存，只回显“是否已设置”。
 */
import type { ModelService, SystemSettingsInput, SystemSettingsView } from "@hwpc/contracts";
import type { ServerConfig } from "../config.js";
import { createModelService } from "../model.js";
import type { MarketingRepo, SettingsRecord } from "./repo.js";
import type { SecretBox } from "./security.js";

export const DEFAULT_WECHAT_API = "https://api.weixin.qq.com";
const DEFAULT_TEMPERATURE = 0.85;

export interface EffectiveModel {
  service?: ModelService;
  temperature: number;
  source: "settings" | "env" | "none";
}

export class SettingsService {
  private cached?: { key: string; model: EffectiveModel };

  constructor(
    private repo: MarketingRepo,
    private box: SecretBox,
    private env: ServerConfig["model"],
  ) {}

  private record(): SettingsRecord {
    return this.repo.getSettings() ?? { model: { baseUrl: "", name: "", temperature: DEFAULT_TEMPERATURE }, wechat: { apiBase: "" }, xiaohongshu: { publishUrl: "" }, updatedAt: new Date(0).toISOString() };
  }

  view(): SystemSettingsView {
    const r = this.record();
    const fromSettings = Boolean(r.model.baseUrl && r.model.name && r.model.apiKey);
    const fromEnv = Boolean(this.env.baseUrl && this.env.name && this.env.apiKey);
    return {
      model: { baseUrl: r.model.baseUrl, name: r.model.name, temperature: r.model.temperature, apiKeySet: Boolean(r.model.apiKey), source: fromSettings ? "settings" : fromEnv ? "env" : "none" },
      wechat: { apiBase: r.wechat.apiBase },
      xiaohongshu: { publishUrl: r.xiaohongshu.publishUrl, apiKeySet: Boolean(r.xiaohongshu.apiKey) },
      ...(this.repo.getSettings() ? { updatedAt: r.updatedAt } : {}),
    };
  }

  update(input: SystemSettingsInput): SystemSettingsView {
    const prev = this.record();
    const keep = (next: string | undefined, old: string | undefined) => (next === undefined ? old : next.trim() ? this.box.seal(next.trim()) : undefined);
    const modelKey = keep(input.model.apiKey, prev.model.apiKey);
    const xhsKey = keep(input.xiaohongshu.apiKey, prev.xiaohongshu.apiKey);
    this.repo.putSettings({
      model: { baseUrl: input.model.baseUrl.trim(), name: input.model.name.trim(), temperature: input.model.temperature, ...(modelKey ? { apiKey: modelKey } : {}) },
      wechat: { apiBase: input.wechat.apiBase.trim() },
      xiaohongshu: { publishUrl: input.xiaohongshu.publishUrl.trim(), ...(xhsKey ? { apiKey: xhsKey } : {}) },
      updatedAt: new Date().toISOString(),
    });
    this.cached = undefined;
    return this.view();
  }

  /** 当前可用的写作模型；都没配置时 service 为空，引擎使用模板稿。 */
  model(): EffectiveModel {
    const r = this.record();
    const key = `${r.updatedAt}|${r.model.baseUrl}|${r.model.name}`;
    if (this.cached?.key === key) return this.cached.model;
    let model: EffectiveModel;
    if (r.model.baseUrl && r.model.name && r.model.apiKey) {
      model = { service: createModelService({ baseUrl: r.model.baseUrl, name: r.model.name, apiKey: this.box.open(r.model.apiKey), timeoutMs: this.env.timeoutMs }), temperature: r.model.temperature, source: "settings" };
    } else if (this.env.baseUrl && this.env.name && this.env.apiKey) {
      model = { service: createModelService(this.env), temperature: r.model.temperature, source: "env" };
    } else {
      model = { temperature: r.model.temperature, source: "none" };
    }
    this.cached = { key, model };
    return model;
  }

  wechatApiBase(): string {
    return (this.record().wechat.apiBase || DEFAULT_WECHAT_API).replace(/\/+$/, "");
  }

  xiaohongshu(): { publishUrl: string; apiKey?: string } {
    const r = this.record().xiaohongshu;
    return { publishUrl: r.publishUrl, ...(r.apiKey ? { apiKey: this.box.open(r.apiKey) } : {}) };
  }
}
