/**
 * 推文模块的文件存储：每条记录一个 JSON 文件，先写临时文件再改名（原子替换），读取时用 schema 复验。
 * 与会话存储一样只支持单进程写入。数据目录默认 code/apps/server/.runtime/marketing（已 gitignore）。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CampaignSchema, ChannelSchema, PostSchema, StoreProfileSchema, UserRoleSchema, IsoDateTimeSchema } from "@hwpc/contracts";

const SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;

export class JsonCollection<T> {
  constructor(
    private dir: string,
    private schema: z.ZodType<T>,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string): string {
    if (!SAFE_ID.test(id) || id.includes("..")) throw new Error(`非法的记录编号: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  get(id: string): T | undefined {
    if (!SAFE_ID.test(id) || id.includes("..")) return undefined;
    const f = this.file(id);
    if (!fs.existsSync(f)) return undefined;
    return this.schema.parse(JSON.parse(fs.readFileSync(f, "utf8")));
  }

  put(id: string, value: T): T {
    const parsed = this.schema.parse(value);
    const target = this.file(id);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(parsed), "utf8");
    fs.renameSync(tmp, target);
    return parsed;
  }

  delete(id: string): void {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  /** 损坏的文件跳过并打印告警，不拖垮列表。 */
  list(): T[] {
    const out: T[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        out.push(this.schema.parse(JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8"))));
      } catch (e) {
        console.warn(`[marketing] 跳过无法读取的记录 ${name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return out;
  }
}

/* ------------------------------ 内部记录（含散列与密文，不直接对外） ------------------------------ */

export const UserRecordSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_\-.]{1,64}$/),
  displayName: z.string().min(1),
  role: UserRoleSchema,
  storeId: z.string().optional(),
  passwordHash: z.string(),
  /** 改口令时 +1，令牌里带着它，旧令牌随即失效。 */
  passwordVersion: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
});
export type UserRecord = z.infer<typeof UserRecordSchema>;

export const BindingRecordSchema = z.object({
  storeId: z.string(),
  channel: ChannelSchema,
  displayName: z.string(),
  settings: z.record(z.string(), z.string()),
  /** 字段名 → SecretBox 密文 */
  secrets: z.record(z.string(), z.string()),
  lastCheck: z.object({ ok: z.boolean(), message: z.string(), at: IsoDateTimeSchema }).optional(),
  updatedAt: IsoDateTimeSchema,
});
export type BindingRecord = z.infer<typeof BindingRecordSchema>;

export const SettingsRecordSchema = z.object({
  model: z.object({ baseUrl: z.string(), name: z.string(), temperature: z.number(), apiKey: z.string().optional() }),
  wechat: z.object({ apiBase: z.string() }),
  xiaohongshu: z.object({ publishUrl: z.string(), apiKey: z.string().optional() }),
  updatedAt: IsoDateTimeSchema,
});
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;

export class MarketingRepo {
  readonly users: JsonCollection<UserRecord>;
  readonly stores: JsonCollection<z.infer<typeof StoreProfileSchema>>;
  readonly bindings: JsonCollection<BindingRecord>;
  readonly campaigns: JsonCollection<z.infer<typeof CampaignSchema>>;
  readonly posts: JsonCollection<z.infer<typeof PostSchema>>;
  private settingsFile: string;

  constructor(readonly dir: string) {
    this.users = new JsonCollection(path.join(dir, "users"), UserRecordSchema);
    this.stores = new JsonCollection(path.join(dir, "stores"), StoreProfileSchema);
    this.bindings = new JsonCollection(path.join(dir, "bindings"), BindingRecordSchema);
    this.campaigns = new JsonCollection(path.join(dir, "campaigns"), CampaignSchema);
    this.posts = new JsonCollection(path.join(dir, "posts"), PostSchema);
    this.settingsFile = path.join(dir, "settings.json");
  }

  bindingId(storeId: string, channel: string): string {
    return `${storeId}__${channel}`;
  }

  getSettings(): SettingsRecord | undefined {
    if (!fs.existsSync(this.settingsFile)) return undefined;
    return SettingsRecordSchema.parse(JSON.parse(fs.readFileSync(this.settingsFile, "utf8")));
  }

  putSettings(s: SettingsRecord): void {
    const tmp = `${this.settingsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(SettingsRecordSchema.parse(s)), "utf8");
    fs.renameSync(tmp, this.settingsFile);
  }
}
