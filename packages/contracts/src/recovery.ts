import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common.js";
import { CapabilityReportSchema } from "./capabilities.js";
import { ExperienceRecordSchema, FeedbackRecordSchema } from "./experience.js";
import { NeedConfirmationSchema, NeedVersionRecordSchema } from "./needs.js";
import { PersonalPlanSchema } from "./plan.js";
import { SceneDefinitionSchema, SceneInstanceSchema, sceneContentHash } from "./scenes.js";
import { hashOf } from "./util.js";

/**
 * 版本化方案/恢复包：与传输形式（HTML 文件、JSON、在线页面）无关的数据载荷。
 * 包含方案、对应的已确认需求、冻结的场景定义、证据快照与进度，不含 AI 与最新资料。
 *
 * 完整性哈希只用于发现损坏与意外修改，不是签名，不能防止有意篡改。
 */
export const RecoveryPayloadSchema = z.object({
  /** 来源会话。导入方得到的是独立副本，不会写回该会话。 */
  origin: z.object({ sessionId: IdSchema, exportedAt: IsoDateTimeSchema, sessionRevision: z.number().int().nonnegative() }),
  /** 只读：持有者不能通过恢复包修改原顾客方案。 */
  access: z.literal("read_only_copy"),
  isMock: z.boolean(),
  need: z.object({ record: NeedVersionRecordSchema, confirmation: NeedConfirmationSchema }),
  plan: PersonalPlanSchema,
  sceneDefinitions: z.array(SceneDefinitionSchema),
  instances: z.array(SceneInstanceSchema),
  /** 导出时的进度；离线运行时的新进度只保存在本机，不写回此处。 */
  experiences: z.array(ExperienceRecordSchema),
  feedback: z.array(FeedbackRecordSchema),
  /** 导出时该方案是否仍对应当前需求（stale/needsReview 会写明）。 */
  freshness: z.object({
    planStatus: z.enum(["current", "superseded", "stale"]),
    needsReview: z.boolean(),
    note: z.string().optional(),
    /** 导出时已失效的场景版本。 */
    invalidScenes: z.array(z.object({ sceneId: z.string(), version: z.number().int().positive(), reason: z.string() })),
  }),
  capabilities: CapabilityReportSchema,
  notices: z.array(z.string()),
});
export type RecoveryPayload = z.infer<typeof RecoveryPayloadSchema>;

export const RecoveryPackSchema = z.object({
  format: z.literal("hwpc.recovery.v1"),
  integrity: z.object({ algorithm: z.literal("cyrb53-stable-json"), hash: z.string(), note: z.string() }),
  payload: RecoveryPayloadSchema,
});
export type RecoveryPack = z.infer<typeof RecoveryPackSchema>;

export const INTEGRITY_NOTE = "仅用于发现文件损坏或意外修改，不是数字签名，不能防止有意篡改。";

export function sealRecoveryPack(payload: RecoveryPayload): RecoveryPack {
  return {
    format: "hwpc.recovery.v1",
    integrity: { algorithm: "cyrb53-stable-json", hash: hashOf(payload), note: INTEGRITY_NOTE },
    payload,
  };
}

export interface RecoveryCheck {
  ok: boolean;
  problems: string[];
  /** 可展示的警告，不阻止打开。 */
  warnings: string[];
}

/** 校验恢复包：结构、完整性哈希、场景定义哈希、引用关系。 */
export function verifyRecoveryPack(data: unknown): RecoveryCheck & { pack?: RecoveryPack } {
  const parsed = RecoveryPackSchema.safeParse(data);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), warnings: [] };
  const pack = parsed.data;
  const problems: string[] = [];
  const warnings: string[] = [];
  if (hashOf(pack.payload) !== pack.integrity.hash) problems.push("完整性校验失败：内容与导出时不一致");
  const p = pack.payload;
  const defs = new Map(p.sceneDefinitions.map((d) => [`${d.sceneId}@${d.version}`, d]));
  for (const i of p.instances) {
    const d = defs.get(`${i.sceneId}@${i.sceneVersion}`);
    if (!d) problems.push(`实例 ${i.instanceId} 引用的场景 ${i.sceneId}@${i.sceneVersion} 不在包内`);
    else if (sceneContentHash(d) !== i.definitionHash) problems.push(`场景 ${i.sceneId}@${i.sceneVersion} 与实例记录的哈希不一致`);
  }
  const instanceIds = new Set(p.instances.map((i) => i.instanceId));
  for (const s of p.plan.scenes) if (!instanceIds.has(s.instanceId)) problems.push(`方案引用的实例 ${s.instanceId} 不在包内`);
  if (p.need.confirmation.needVersion !== p.plan.needVersion) problems.push("确认记录与方案的需求版本不一致");
  if (p.need.record.version !== p.plan.needVersion) problems.push("需求记录版本与方案不一致");
  if (p.plan.confirmationId !== p.need.confirmation.confirmationId) problems.push("方案引用的确认记录与包内不一致");
  if (p.freshness.planStatus === "stale") warnings.push("该方案导出时已不对应当前需求，仅供参考");
  if (p.freshness.needsReview) warnings.push("该方案导出时有需求变化尚待复核");
  for (const s of p.freshness.invalidScenes) warnings.push(`场景 ${s.sceneId}@${s.version} 已被标记失效：${s.reason}`);
  if (p.isMock) warnings.push("内含模拟数据（MOCK），不是真实产品资料");
  return { ok: problems.length === 0, problems, warnings, pack };
}
