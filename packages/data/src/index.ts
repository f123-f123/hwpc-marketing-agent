/**
 * packages/data —— 资料层入口。
 *
 * 三种模式：
 *   - local：读取本地知识库（默认 code/local-data/华为PC全板块深度知识库_v7）。
 *   - ima：调用 ima OpenAPI（凭证只经配置传入，不进入任何返回值）。
 *   - auto：ima 可用则用 ima，否则用本地；两者都不可用时抛 not_configured，不静默降级成 mock。
 *   - mock：仅在显式指定时使用，所有响应带 MOCK 标记。
 *
 * 知识服务（设备能力与关系）由 devices.ts 基于同一份 DataService 取证，
 * 查不到就是 unknown，不根据品牌名或常识补兼容性。
 */
import type { DataService, DeviceKnowledgeService, SourceStatus } from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";
import { createMockDataService } from "@hwpc/fixtures";
import { createLocalDataService } from "./local/index.js";
import { createImaDataService, type ImaConfig } from "./ima.js";
import { defaultLocalRoot } from "./local.js";
import { createKnowledgeService } from "./devices.js";

export interface DataServiceConfig {
  mode: "auto" | "mock" | "local" | "ima";
  localKbDir?: string;
  ima: ImaConfig;
}

export function createDataService(config: DataServiceConfig): DataService {
  const mock = createMockDataService();
  const localRoot = config.localKbDir ?? defaultLocalRoot();
  const local = createLocalDataService({ rootDir: localRoot });
  const ima = createImaDataService(config.ima, local);

  /** 当前实际用于取数的来源。auto 下每次重新判断，避免启动时的瞬时状态被永久固化。 */
  const pick = async (signal?: AbortSignal): Promise<DataService> => {
    if (config.mode === "mock") return mock;
    if (config.mode === "local") return local;
    if (config.mode === "ima") return ima;
    const imaState = (await ima.getStatus(signal))[0];
    if (imaState?.state === "connected") return ima;
    const localState = (await local.getStatus(signal))[0];
    if (localState?.state === "connected") return local;
    throw new DataServiceError("not_configured", "ima 与本地知识库均不可用；请配置资料来源", "local");
  };

  return {
    async getStatus(signal) {
      // local / mock 模式不查询 ima：共享知识库调用次数有限，不为状态展示消耗
      const imaStatus = config.mode === "auto" || config.mode === "ima"
        ? ima.getStatus(signal)
        : Promise.resolve<SourceStatus[]>([{ origin: "ima", state: "not_configured", enabled: false, message: `未启用（DATA_SOURCE_MODE=${config.mode}）`, knowledgeBase: { name: config.ima.kbName, found: false } }]);
      const settled = await Promise.allSettled([imaStatus, local.getStatus(signal)]);
      const statuses: SourceStatus[] = settled.flatMap((result, i) =>
        result.status === "fulfilled"
          ? result.value
          : [
              {
                origin: i === 0 ? "ima" : "local",
                state: "error" as const,
                enabled: true,
                message: result.reason instanceof Error ? result.reason.message : "资料检查失败",
              },
            ],
      );
      statuses.push({
        origin: "mock",
        enabled: config.mode === "mock",
        state: config.mode === "mock" ? "connected" : "not_configured",
        message: "仅供显式模拟模式使用",
      });
      return statuses;
    },

    async searchProducts(query, signal) {
      return (await pick(signal)).searchProducts(query, signal);
    },
    async getMaterialPack(request) {
      // auto 下按型号来源分发：ima 接入前创建的任务仍是本地型号，继续读本地资料（资料包标记 local），不送去 ima
      if (config.mode === "auto") return (request.product.productId.startsWith("ima-") ? ima : local).getMaterialPack(request);
      return (await pick(request.signal)).getMaterialPack(request);
    },
    async readImage(image, signal) {
      // 图片按自身来源读取，与当前活动来源无关
      if (image.source.origin === "mock") return mock.readImage(image, signal);
      if (config.mode === "auto") return (image.source.origin === "ima" ? ima : local).readImage(image, signal);
      return (await pick(signal)).readImage(image, signal);
    },
  };
}

/** 设备能力与关系取证服务（基于同一份 DataService）。 */
export function createDeviceKnowledgeService(data: DataService): DeviceKnowledgeService {
  return createKnowledgeService(data);
}

export { readPlatformGuide } from "./guides.js";
export { createLocalLibrary, tokenize } from "./library.js";
