import {
  SceneDefinitionSchema,
  sceneContentHash,
  type SceneCatalog,
  type SceneCatalogItem,
  type SceneDefinition,
  type SceneInvalidation,
} from "@hwpc/contracts";

export class SceneRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneRegistryError";
  }
}

interface Entry {
  def: SceneDefinition;
  hash: string;
  /** 锁文件中记录的哈希；缺失表示该版本尚未锁定。 */
  lockedHash?: string;
}

export interface SceneRegistryInput {
  definitions: unknown[];
  /** "sceneId@version" -> 内容哈希。已发布版本不可变：内容变化但哈希不变会被发现。 */
  lock?: Record<string, string>;
  invalidations?: SceneInvalidation[];
}

/**
 * 静态场景注册表：启动时加载并校验，运行期只读。
 * - (sceneId, version) 唯一且不可变：重复注册直接报错。
 * - 锁文件对不上 → integrity=hash_mismatch，该版本不可用于新实例（已保存方案用自己的冻结副本）。
 * - 无锁记录 → integrity=not_locked：仅提示，开发期允许使用。
 * - 失效记录 → status=invalidated，不再用于新实例。
 */
export class SceneRegistry implements SceneCatalog {
  private entries = new Map<string, Entry>();
  private invalid = new Map<string, SceneInvalidation>();
  readonly loadErrors: string[] = [];

  constructor(input: SceneRegistryInput, opts: { strict?: boolean } = {}) {
    for (const [i, raw] of input.definitions.entries()) {
      const parsed = SceneDefinitionSchema.safeParse(raw);
      if (!parsed.success) {
        const msg = `场景定义 #${i} 不合法: ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
        if (opts.strict) throw new SceneRegistryError(msg);
        this.loadErrors.push(msg);
        continue;
      }
      const def = parsed.data;
      const key = `${def.sceneId}@${def.version}`;
      if (this.entries.has(key)) {
        const msg = `场景 ${key} 重复注册（版本不可变，请发布新版本）`;
        if (opts.strict) throw new SceneRegistryError(msg);
        this.loadErrors.push(msg);
        continue;
      }
      this.entries.set(key, { def, hash: sceneContentHash(def), lockedHash: input.lock?.[key] });
    }
    for (const inv of input.invalidations ?? []) this.invalid.set(`${inv.sceneId}@${inv.version}`, inv);
  }

  private item(e: Entry): SceneCatalogItem {
    const key = `${e.def.sceneId}@${e.def.version}`;
    const inv = this.invalid.get(key);
    const integrity = e.lockedHash === undefined ? "not_locked" : e.lockedHash === e.hash ? "ok" : "hash_mismatch";
    const d = e.def;
    return {
      sceneId: d.sceneId,
      version: d.version,
      title: d.title,
      summary: d.summary,
      task: d.task,
      techTags: d.techTags,
      roles: d.roles.map((r) => ({ roleId: r.roleId, label: r.label, category: r.category, required: r.required, requiredFeatures: r.requiredFeatures })),
      relations: d.relations,
      configSchema: d.configSchema,
      knowledgeScope: d.knowledgeScope,
      competitionEligible: d.competitionEligible,
      isMock: d.isMock,
      status: inv ? "invalidated" : this.isSuperseded(d) ? "deprecated" : "active",
      contentHash: e.hash,
      integrity,
      invalidation: inv,
    };
  }

  private isSuperseded(d: SceneDefinition): boolean {
    for (const e of this.entries.values()) if (e.def.sceneId === d.sceneId && e.def.version > d.version && !this.invalid.has(`${e.def.sceneId}@${e.def.version}`)) return true;
    return false;
  }

  list(opts: { includeAll?: boolean } = {}): SceneCatalogItem[] {
    const all = [...this.entries.values()].map((e) => this.item(e));
    const out = opts.includeAll ? all : all.filter((i) => i.status === "active" && i.integrity !== "hash_mismatch");
    return out.sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.version - b.version);
  }

  get(sceneId: string, version: number): SceneCatalogItem | undefined {
    const e = this.entries.get(`${sceneId}@${version}`);
    return e ? this.item(e) : undefined;
  }

  getDefinition(sceneId: string, version: number): SceneDefinition | undefined {
    return this.entries.get(`${sceneId}@${version}`)?.def;
  }

  latest(sceneId: string): SceneCatalogItem | undefined {
    return [...this.entries.values()]
      .filter((e) => e.def.sceneId === sceneId)
      .map((e) => this.item(e))
      .filter((i) => i.status !== "invalidated" && i.integrity !== "hash_mismatch")
      .sort((a, b) => b.version - a.version)[0];
  }

  /** 生成锁文件内容（发布时由维护者执行并提交）。 */
  buildLock(): Record<string, string> {
    return Object.fromEntries([...this.entries].map(([k, e]) => [k, e.hash]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  }
}
