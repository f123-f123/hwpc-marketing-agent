/**
 * ima 模式：调用 ima OpenAPI（接口适配，标注"未验证"）。
 */
import type {
  DataService,
  SourceStatus,
  ProductSearchResult,
  MaterialPack,
  ImageRecord,
  ImageContent,
  MaterialRequest,
} from "@hwpc/contracts";
import { DataServiceError } from "@hwpc/contracts";

export interface ImaDataServiceOptions {
  clientId?: string;
  apiKey?: string;
  kbName: string;
  baseUrl?: string;
}

/**
 * 创建 ima 模式的 DataService。
 *
 * 注意：当前实现为接口适配层，标注"未验证"。
 * 真实验证需要：
 * 1. 提供有效的 clientId 和 apiKey
 * 2. 验证知识库列表、搜索、分页、图片读取等行为
 * 3. 确认返回字段与 skill 文档的一致性
 */
export function createImaDataService(opts: ImaDataServiceOptions): DataService {
  const hasCredentials = !!(opts.clientId && opts.apiKey);

  return {
    async getStatus(): Promise<SourceStatus[]> {
      const status: SourceStatus = {
        origin: "ima",
        state: hasCredentials ? "unverified" : "not_configured",
        enabled: hasCredentials,
        message: hasCredentials
          ? `ima 接口已配置（知识库: ${opts.kbName}），但未经真实凭证验证`
          : "ima 接口未配置 clientId 或 apiKey",
      };
      return [status];
    },

    async searchProducts(query: string, signal?: AbortSignal): Promise<ProductSearchResult> {
      if (!hasCredentials) {
        throw new DataServiceError("not_configured", "ima 接口未配置凭证", "ima");
      }

      // TODO: 调用 ima search_knowledge API
      throw new DataServiceError("not_found", "ima searchProducts 接口待实现（需真实凭证验证）", "ima");
    },

    async getMaterialPack(request: MaterialRequest): Promise<MaterialPack> {
      if (!hasCredentials) {
        throw new DataServiceError("not_configured", "ima 接口未配置凭证", "ima");
      }

      // TODO: 调用 ima get_media_info API
      throw new DataServiceError("not_found", "ima getMaterialPack 接口待实现（需真实凭证验证）", "ima");
    },

    async readImage(image: ImageRecord, signal?: AbortSignal): Promise<ImageContent> {
      if (!hasCredentials) {
        throw new DataServiceError("not_configured", "ima 接口未配置凭证", "ima");
      }

      // TODO: 调用 ima get_media_info 并读取 url_info.cdn
      throw new DataServiceError("not_found", "ima readImage 接口待实现（需真实凭证验证）", "ima");
    },
  };
}
