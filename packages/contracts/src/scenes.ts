import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { DeviceCapabilitySchema, DeviceRelationSchema, FeatureKeySchema } from "./devices.js";
import { EvidenceRefSchema } from "./evidence.js";
import { DeviceCategorySchema, ProductIdentitySchema, ProductRefSchema } from "./product.js";
import { hashOf } from "./util.js";

export const SceneIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/, "sceneId 须为小写字母、数字、连字符");
export const SceneVersionSchema = z.number().int().positive();

/* ------------------------------ 配置 schema（声明性） ------------------------------ */

const FieldBase = { key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), label: z.string().min(1), required: z.boolean().default(false) };
const OptionSchema = z.object({ value: z.string().min(1), label: z.string().min(1) });

export const SceneConfigFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...FieldBase, type: z.literal("enum"), options: z.array(OptionSchema).min(2).max(12), default: z.string().optional() }),
  z.object({ ...FieldBase, type: z.literal("boolean"), default: z.boolean().optional() }),
  z.object({
    ...FieldBase,
    type: z.literal("number"),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    default: z.number().optional(),
  }),
  z.object({ ...FieldBase, type: z.literal("text"), maxLength: z.number().int().positive().max(200).default(60), default: z.string().optional() }),
]);
export type SceneConfigField = z.infer<typeof SceneConfigFieldSchema>;

export const SceneParamValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type SceneParamValue = z.infer<typeof SceneParamValueSchema>;
export type SceneParams = Record<string, SceneParamValue>;

/* ------------------------------ 设备角色与适用条件 ------------------------------ */

export const SceneRoleSchema = z.object({
  roleId: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: z.string().min(1),
  category: DeviceCategorySchema,
  required: z.boolean().default(true),
  /** 该角色的设备必须具备的功能；任何一项不满足/未知，场景都不能展示为可用。 */
  requiredFeatures: z.array(FeatureKeySchema).default([]),
});
export type SceneRole = z.infer<typeof SceneRoleSchema>;

export const SceneRelationRequirementSchema = z.object({
  feature: FeatureKeySchema,
  /** 参与该关系的角色，至少两个。 */
  roleIds: z.array(z.string()).min(2),
});

/* ------------------------------ 状态、动作、结果 ------------------------------ */

export const SceneStateSchema = z.object({
  stateId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1),
  description: z.string().optional(),
  initial: z.boolean().default(false),
  terminal: z.boolean().default(false),
});

export const SceneActionSchema = z.object({
  actionId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1),
  from: z.array(z.string()).min(1),
  to: z.string(),
  /** 互动只改变展示，不改需求、证据与方案。 */
  effect: z.literal("display_only").default("display_only"),
});

export const SceneOutcomeSchema = z.object({
  outcomeId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1),
  reachedInState: z.string(),
  kind: z.enum(["walkthrough", "comparison", "observation"]),
  /** 达成该结果意味着什么——只能是“看过/走过流程”，不能是设备测试通过。 */
  statement: z.string().min(1),
});

export const DemoBoundarySchema = z.object({
  kind: z.literal("declarative_walkthrough"),
  /** 完成场景不等于真实设备测试通过。恒为 false，不允许场景声明相反。 */
  deviceTested: z.literal(false),
  statement: z.string().min(1),
});

/* ------------------------------ 场景定义（版本不可变） ------------------------------ */

/**
 * 场景定义：预先编写、声明性、按 (sceneId, version) 不可变。
 * 模型只能引用已注册的 (sceneId, version) 并提交通过校验的配置，不能提供场景代码。
 */
export const SceneDefinitionSchema = z
  .object({
    sceneId: SceneIdSchema,
    version: SceneVersionSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    /** 该场景帮用户完成的任务，用于与需求匹配。 */
    task: z.string().min(1),
    techTags: z.array(z.string().min(1)).default([]),
    roles: z.array(SceneRoleSchema).min(1),
    relations: z.array(SceneRelationRequirementSchema).default([]),
    configSchema: z.array(SceneConfigFieldSchema).default([]),
    states: z.array(SceneStateSchema).min(2),
    actions: z.array(SceneActionSchema).min(1),
    outcomes: z.array(SceneOutcomeSchema).min(1),
    evidence: z.array(EvidenceRefSchema).default([]),
    /**
     * 场景声明所依据的知识范围。
     * pc_knowledge_base：PC 知识库资料支持；
     * outside_pc_knowledge_base：家庭/多设备等，PC 知识库不支持，不得声称有知识库依据；
     */
    knowledgeScope: z.enum(["pc_knowledge_base", "outside_pc_knowledge_base"]),
    /** 能否用于比赛模式输出。仅 pc_knowledge_base 范围内的场景可以为 true。 */
    competitionEligible: z.boolean(),
    demoBoundary: DemoBoundarySchema,
    isMock: z.boolean(),
    /** 渲染器键，由前端 apps/web/src/scenes 解析；服务端不执行。 */
    rendererKey: z.string().min(1),
    /** 本版本相对上一版本的变化说明（version>1 时必填）。 */
    changeNote: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    const add = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });
    const stateIds = new Set(d.states.map((s) => s.stateId));
    if (stateIds.size !== d.states.length) add("stateId 重复", ["states"]);
    if (d.states.filter((s) => s.initial).length !== 1) add("必须恰有一个初始状态", ["states"]);
    if (!d.states.some((s) => s.terminal)) add("至少需要一个终态", ["states"]);
    const roleIds = new Set(d.roles.map((r) => r.roleId));
    if (roleIds.size !== d.roles.length) add("roleId 重复", ["roles"]);
    d.actions.forEach((a, i) => {
      if (!stateIds.has(a.to)) add(`动作 ${a.actionId} 指向未知状态 ${a.to}`, ["actions", i]);
      for (const f of a.from) if (!stateIds.has(f)) add(`动作 ${a.actionId} 的来源状态 ${f} 不存在`, ["actions", i]);
    });
    if (new Set(d.actions.map((a) => a.actionId)).size !== d.actions.length) add("actionId 重复", ["actions"]);
    d.outcomes.forEach((o, i) => {
      if (!stateIds.has(o.reachedInState)) add(`结果 ${o.outcomeId} 引用了未知状态`, ["outcomes", i]);
    });
    // 终态必须可从初始状态到达
    const initial = d.states.find((s) => s.initial)?.stateId;
    if (initial) {
      const seen = new Set([initial]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const a of d.actions) {
          if (a.from.some((f) => seen.has(f)) && !seen.has(a.to)) {
            seen.add(a.to);
            grew = true;
          }
        }
      }
      for (const s of d.states) if (s.terminal && !seen.has(s.stateId)) add(`终态 ${s.stateId} 无法到达`, ["states"]);
      for (const o of d.outcomes) if (!seen.has(o.reachedInState)) add(`结果 ${o.outcomeId} 所在状态无法到达`, ["outcomes"]);
    }
    d.relations.forEach((r, i) => {
      for (const id of r.roleIds) if (!roleIds.has(id)) add(`关系 ${r.feature} 引用了未知角色 ${id}`, ["relations", i]);
    });
    const keys = d.configSchema.map((f) => f.key);
    if (new Set(keys).size !== keys.length) add("配置字段 key 重复", ["configSchema"]);
    for (const [i, f] of d.configSchema.entries()) {
      if (f.type === "enum" && f.default !== undefined && !f.options.some((o) => o.value === f.default)) add(`字段 ${f.key} 默认值不在选项内`, ["configSchema", i]);
      if (f.type === "number") {
        if (f.min > f.max) add(`字段 ${f.key} min>max`, ["configSchema", i]);
        if (f.default !== undefined && (f.default < f.min || f.default > f.max)) add(`字段 ${f.key} 默认值越界`, ["configSchema", i]);
      }
    }
    // 知识范围与证据
    if (d.competitionEligible && d.knowledgeScope !== "pc_knowledge_base") {
      add("非 PC 知识库范围的场景不能用于比赛模式（competitionEligible 必须为 false）", ["competitionEligible"]);
    }
    if (d.knowledgeScope === "pc_knowledge_base" && d.evidence.length === 0) add("pc_knowledge_base 范围的场景必须带证据", ["evidence"]);
    for (const [i, e] of d.evidence.entries()) {
      if (d.knowledgeScope === "outside_pc_knowledge_base" && (e.source.origin === "local" || e.source.origin === "ima")) {
        add("outside_pc_knowledge_base 的场景不得把 PC 知识库资料当作其证据", ["evidence", i]);
      }
      if (d.isMock && e.source.origin !== "mock") add("mock 场景的证据来源必须是 mock", ["evidence", i]);
      if (!d.isMock && e.source.origin === "mock") add("非 mock 场景不得引用 mock 证据", ["evidence", i]);
    }
    if (d.isMock && !d.sceneId.startsWith("mock-")) add("mock 场景的 sceneId 必须以 mock- 开头", ["sceneId"]);
    if (!d.isMock && d.sceneId.startsWith("mock-")) add("以 mock- 开头的 sceneId 必须标记 isMock", ["isMock"]);
    if (d.version > 1 && !d.changeNote) add("version>1 必须写 changeNote", ["changeNote"]);
  });
export type SceneDefinition = z.infer<typeof SceneDefinitionSchema>;

/** 定义内容哈希：用于锁定版本与发现被悄悄修改。 */
export const sceneContentHash = (def: SceneDefinition): string => hashOf(def);

/* ------------------------------ 配置校验 ------------------------------ */

export interface ConfigValidation {
  ok: boolean;
  values: SceneParams;
  errors: string[];
}

const UNSAFE_TEXT = /[<>]|javascript:|\bon\w+\s*=/i;

/** 校验并规整场景配置：未知键、类型、范围、选项、必填项；缺省值回填。 */
export function validateSceneConfig(def: Pick<SceneDefinition, "configSchema">, params: unknown): ConfigValidation {
  const errors: string[] = [];
  const values: SceneParams = {};
  const input = params === undefined || params === null ? {} : params;
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, values, errors: ["配置必须是对象"] };
  const raw = input as Record<string, unknown>;
  const known = new Set(def.configSchema.map((f) => f.key));
  for (const k of Object.keys(raw)) if (!known.has(k)) errors.push(`未知配置项 ${k}`);
  for (const f of def.configSchema) {
    let v = raw[f.key];
    if (v === undefined) {
      if (f.default !== undefined) v = f.default;
      else if (f.required) {
        errors.push(`缺少必填配置 ${f.key}`);
        continue;
      } else continue;
    }
    switch (f.type) {
      case "enum":
        if (typeof v !== "string" || !f.options.some((o) => o.value === v)) errors.push(`${f.key} 不在可选项内`);
        else values[f.key] = v;
        break;
      case "boolean":
        if (typeof v !== "boolean") errors.push(`${f.key} 必须是布尔值`);
        else values[f.key] = v;
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v) || v < f.min || v > f.max) errors.push(`${f.key} 必须是 ${f.min}~${f.max} 的数字`);
        else values[f.key] = v;
        break;
      case "text":
        if (typeof v !== "string" || v.length > f.maxLength || UNSAFE_TEXT.test(v)) errors.push(`${f.key} 必须是不含标签的文本（≤${f.maxLength} 字）`);
        else values[f.key] = v;
        break;
    }
  }
  return { ok: errors.length === 0, values, errors };
}

/* ------------------------------ 注册表条目与目录 ------------------------------ */

export const SceneStatusSchema = z.enum(["active", "deprecated", "invalidated"]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SceneInvalidationSchema = z.object({
  sceneId: SceneIdSchema,
  version: SceneVersionSchema,
  reason: z.string().min(1),
  at: IsoDateTimeSchema,
  /** 建议迁移到的版本（需用户确认，不自动迁移）。 */
  replacedByVersion: SceneVersionSchema.optional(),
});
export type SceneInvalidation = z.infer<typeof SceneInvalidationSchema>;

export const SceneIntegritySchema = z.enum(["ok", "not_locked", "hash_mismatch"]);

/** 对外目录条目：只含元数据，不含渲染实现。供 B 通过注入接口查询。 */
export const SceneCatalogItemSchema = z.object({
  sceneId: SceneIdSchema,
  version: SceneVersionSchema,
  title: z.string(),
  summary: z.string(),
  task: z.string(),
  techTags: z.array(z.string()),
  roles: z.array(SceneRoleSchema.pick({ roleId: true, label: true, category: true, required: true, requiredFeatures: true })),
  relations: z.array(SceneRelationRequirementSchema),
  configSchema: z.array(SceneConfigFieldSchema),
  knowledgeScope: z.enum(["pc_knowledge_base", "outside_pc_knowledge_base"]),
  competitionEligible: z.boolean(),
  isMock: z.boolean(),
  status: SceneStatusSchema,
  contentHash: z.string(),
  integrity: SceneIntegritySchema,
  invalidation: SceneInvalidationSchema.optional(),
});
export type SceneCatalogItem = z.infer<typeof SceneCatalogItemSchema>;

/** 场景目录接口（服务端实现，注入 Agent B）。B 不得导入前端代码。 */
export interface SceneCatalog {
  /** 返回最新 active 版本的元数据；includeAll=true 返回全部版本。 */
  list(opts?: { includeAll?: boolean }): SceneCatalogItem[];
  get(sceneId: string, version: number): SceneCatalogItem | undefined;
  getDefinition(sceneId: string, version: number): SceneDefinition | undefined;
  /** 当前可用的最新版本（status=active 且完整性正常）。 */
  latest(sceneId: string): SceneCatalogItem | undefined;
}

/* ------------------------------ 场景实例 ------------------------------ */

export const ApplicabilityResultKindSchema = z.enum([
  "applicable", // 全部角色、功能、关系均有证据且无待满足条件
  "conditional", // 有证据，但仍有未确认的使用条件
  "not_applicable", // 有证据表明某项不满足
  "unknown", // 缺角色、缺配置或缺证据
  "illustrative", // 通用说明性浏览，没有绑定任何设备
]);
export type ApplicabilityKind = z.infer<typeof ApplicabilityResultKindSchema>;

export const ApplicabilityReasonSchema = z.object({
  code: z.enum([
    "role_unbound",
    "category_mismatch",
    "category_unknown",
    "configuration_unspecified",
    "feature_unsupported",
    "feature_unknown",
    "relation_unsupported",
    "relation_unknown",
    "condition_open",
    "scene_invalid",
    "illustrative_only",
  ]),
  text: z.string(),
  roleId: z.string().optional(),
  feature: z.string().optional(),
});

export const ApplicabilitySchema = z
  .object({
    result: ApplicabilityResultKindSchema,
    /** 能否向用户呈现为“这套设备组合可用”。只有 applicable 为 true。 */
    presentAsAvailable: z.boolean(),
    reasons: z.array(ApplicabilityReasonSchema),
    openConditions: z.array(z.object({ conditionKey: z.string(), text: z.string(), satisfied: z.boolean() })),
    isMock: z.boolean(),
  })
  .superRefine((a, ctx) => {
    if (a.presentAsAvailable !== (a.result === "applicable")) {
      ctx.addIssue({ code: "custom", message: "presentAsAvailable 只能在 result=applicable 时为 true", path: ["presentAsAvailable"] });
    }
  });
export type Applicability = z.infer<typeof ApplicabilitySchema>;

/** 实例中冻结的证据快照：当时用到的能力与关系副本，保证离线与追溯。 */
export const InstanceEvidenceSnapshotSchema = z.object({
  snapshotId: IdSchema,
  takenAt: IsoDateTimeSchema,
  capabilities: z.array(DeviceCapabilitySchema),
  relations: z.array(DeviceRelationSchema),
  /** 冻结时的设备身份（含类别），使适用性可离线重算。 */
  products: z.array(ProductIdentitySchema),
  isMock: z.boolean(),
});

export const SceneInstanceSchema = z
  .object({
    instanceId: IdSchema,
    sceneId: SceneIdSchema,
    sceneVersion: SceneVersionSchema,
    /** 创建时的定义哈希：版本锁定的依据。 */
    definitionHash: z.string().min(1),
    /** exploratory：说明性浏览，帮助理解需求；personal：基于已确认需求纳入个人方案。 */
    mode: z.enum(["exploratory", "personal"]),
    planVersion: z.number().int().positive().optional(),
    bindings: z.record(z.string(), ProductRefSchema),
    params: z.record(z.string(), SceneParamValueSchema),
    confirmedConditionKeys: z.array(z.string()).default([]),
    evidenceSnapshot: InstanceEvidenceSnapshotSchema,
    applicability: ApplicabilitySchema,
    status: z.enum(["active", "superseded", "invalid"]),
    invalidReason: z.string().optional(),
    createdAt: IsoDateTimeSchema,
    /** exploratory 恒为 true：不是个性化推荐。 */
    illustrativeOnly: z.boolean(),
  })
  .superRefine((i, ctx) => {
    if (i.mode === "personal" && i.planVersion === undefined) {
      ctx.addIssue({ code: "custom", message: "personal 实例必须属于某个方案版本", path: ["planVersion"] });
    }
    if (i.mode === "exploratory" && (!i.illustrativeOnly || i.planVersion !== undefined)) {
      ctx.addIssue({ code: "custom", message: "exploratory 实例必须 illustrativeOnly 且不属于方案", path: ["mode"] });
    }
    if (i.mode === "personal" && i.illustrativeOnly) {
      ctx.addIssue({ code: "custom", message: "personal 实例不能是 illustrativeOnly", path: ["illustrativeOnly"] });
    }
  });
export type SceneInstance = z.infer<typeof SceneInstanceSchema>;
