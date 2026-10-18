import { z } from "zod";

export const CapabilityIdSchema = z.enum([
  "offline_experience", // 无网络时体验预置场景
  "local_recovery", // 关闭重开后恢复
  "online_ai", // 在线模型对话/生成
  "live_updates", // 获取最新资料
  "cross_device_continuation", // 换设备接着用同一份进度
  "sharing", // 把方案发给别人
]);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const CapabilityStatusSchema = z.enum(["supported", "conditional", "unsupported"]);

/** 验证程度。not_verified 表示实现了但没有在真实环境验证过。 */
export const VerificationLevelSchema = z.enum(["automated_test", "static_check", "not_verified", "not_applicable"]);

export const CapabilityDeclarationSchema = z.object({
  id: CapabilityIdSchema,
  status: CapabilityStatusSchema,
  /** 面向用户的准确描述：能做什么、范围到哪里。 */
  statement: z.string().min(1),
  /** conditional 时必填：满足哪些条件才成立。 */
  requires: z.array(z.string()).default([]),
  /** 明确不包含什么，防止被过度解读。 */
  limits: z.array(z.string()).default([]),
  verification: VerificationLevelSchema,
});
export type CapabilityDeclaration = z.infer<typeof CapabilityDeclarationSchema>;

export const RuntimeProfileSchema = z.enum(["server_local", "offline_pack"]);
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

export const CapabilityReportSchema = z.object({
  profile: RuntimeProfileSchema,
  declarations: z.array(CapabilityDeclarationSchema),
});
export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;

export interface RuntimeFacts {
  /** 模型是否配置且非 mock。 */
  modelConfigured: boolean;
  /** 资料来源是否包含已连接的 ima。 */
  imaConnected: boolean;
  /** 是否使用持久化存储（文件）。 */
  persistent: boolean;
}

/**
 * 按运行环境如实生成能力声明。不支持的能力一律显式 unsupported，不省略。
 * 验证级别只在确有对应测试时标 automated_test（见 apps/server/test）。
 */
export function declareCapabilities(profile: RuntimeProfile, facts: RuntimeFacts): CapabilityReport {
  const d: CapabilityDeclaration[] = [];
  if (profile === "server_local") {
    d.push({
      id: "offline_experience",
      status: "unsupported",
      statement: "本服务模式需要连接后端；离线体验请导出离线包。",
      requires: [],
      limits: [],
      verification: "not_applicable",
    });
    d.push({
      id: "local_recovery",
      status: facts.persistent ? "supported" : "unsupported",
      statement: facts.persistent
        ? "对话、需求版本、确认、方案、场景进度、反馈保存在运行服务的这台电脑上，服务重启后可恢复。"
        : "当前为内存存储，服务重启后丢失。",
      requires: [],
      limits: ["只在同一台机器、同一存储目录内恢复", "不是跨设备续接"],
      verification: facts.persistent ? "automated_test" : "not_applicable",
    });
    d.push({
      id: "online_ai",
      status: facts.modelConfigured ? "conditional" : "unsupported",
      statement: facts.modelConfigured ? "已配置模型服务，对话可调用在线模型。" : "未配置模型服务，当前只有模拟顾问，不是真实 AI 判断。",
      requires: facts.modelConfigured ? ["网络可达模型服务", "模型凭证有效"] : [],
      limits: ["模型只能选择已注册场景并提交受校验的配置，不能生成场景代码"],
      verification: "not_verified",
    });
    d.push({
      id: "live_updates",
      status: facts.imaConnected ? "conditional" : "unsupported",
      statement: facts.imaConnected ? "可从 ima 共享知识库读取最新资料。" : "未连接 ima，资料来自本地副本或模拟数据，不是实时更新。",
      requires: facts.imaConnected ? ["网络可达 ima", "凭证有效"] : [],
      limits: ["已保存方案使用生成时的证据快照，不会自动更新"],
      verification: "not_verified",
    });
    d.push({
      id: "cross_device_continuation",
      status: "unsupported",
      statement: "没有账号体系，进度不会在不同设备之间自动同步或接续。",
      requires: [],
      limits: ["可导出恢复包在另一台设备打开，得到的是独立副本，不是同一份进度"],
      verification: "not_applicable",
    });
    d.push({
      id: "sharing",
      status: "conditional",
      statement: "可导出只读恢复包交给他人查看。",
      requires: ["导出者手动发送文件"],
      limits: ["接收方得到独立只读副本，不能修改原方案", "分享不同步进度"],
      verification: "automated_test",
    });
  } else {
    d.push({
      id: "offline_experience",
      status: "supported",
      statement: "离线包内含已锁定版本的场景定义、方案和证据快照，不依赖网络即可浏览与体验预置场景。",
      requires: [],
      limits: ["只包含导出时已有的方案与场景，不能新增需求或重新推荐"],
      verification: "static_check",
    });
    d.push({
      id: "local_recovery",
      status: "conditional",
      statement: "进度可保存在当前浏览器本机，同一浏览器重开后可接着看。",
      requires: ["同一浏览器与同一文件地址", "未清除站点数据"],
      limits: ["不是跨设备续接", "不能写回原服务端会话"],
      verification: "not_verified",
    });
    d.push({
      id: "online_ai",
      status: "unsupported",
      statement: "离线包不含 AI 对话，不会生成新的推荐。",
      requires: [],
      limits: [],
      verification: "not_applicable",
    });
    d.push({
      id: "live_updates",
      status: "unsupported",
      statement: "离线包的资料是导出时的快照，不包含最新信息。",
      requires: [],
      limits: ["以导出时间为准，购买前请核对最新信息"],
      verification: "not_applicable",
    });
    d.push({
      id: "cross_device_continuation",
      status: "unsupported",
      statement: "进度不会跨设备同步。",
      requires: [],
      limits: [],
      verification: "not_applicable",
    });
    d.push({
      id: "sharing",
      status: "conditional",
      statement: "可把离线包文件发给他人，对方得到只读副本。",
      requires: ["手动发送文件"],
      limits: ["对方的操作不会影响原顾客方案", "不同步进度"],
      verification: "static_check",
    });
  }
  return { profile, declarations: d };
}
