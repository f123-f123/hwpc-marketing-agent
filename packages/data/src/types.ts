/**
 * 内部类型定义，不导出到公共契约。
 */
import type { DataOrigin, ProductIdentity, FactRecord, ImageRecord } from "@hwpc/contracts";

/**
 * 本地知识库的产品模型目录结构。
 */
export interface LocalProductModel {
  /** 目录名（如 "HUAWEI MateBook 14"） */
  dirName: string;
  /** 规范化的产品ID */
  productId: string;
  /** 产品名称（从产品事实.md标题提取） */
  displayName: string;
  /** 操作系统（HarmonyOS / Windows / Linux / 多版本） */
  os: string[];
  /** 产品事实文件路径 */
  factPath: string;
  /** 卖点与限制文件路径 */
  sellPointPath: string;
  /** 图片索引 CSV 路径 */
  imageIndexPath: string | null;
  /** 来源清单 CSV 路径 */
  sourceListPath: string | null;
  /** 图片目录路径 */
  imagesDir: string | null;
}

/**
 * 产品事实的段落结构（解析后）。
 */
export interface FactSection {
  /** 段落标题（如"屏幕"、"处理器"） */
  heading: string;
  /** 段落内容（原始 markdown） */
  content: string;
  /** 段落内的变体标记（如"标准版："、"柔光版："） */
  variants: VariantBlock[];
}

/**
 * 变体块（段落内的分段）。
 */
export interface VariantBlock {
  /** 变体标签（如"标准版"、"Windows 版"、空字符串表示通用） */
  label: string;
  /** 该变体的内容 */
  content: string;
}

/**
 * 配置候选（从产品事实中提取的内存/存储组合）。
 */
export interface ConfigurationCandidate {
  /** 配置ID（如"matebook-14-24gb-512gb"） */
  configurationId: string;
  /** 显示标签（如"24GB/512GB"） */
  label: string;
  /** 属性映射 */
  attributes: Record<string, string>;
}

/**
 * 图片索引行（从图片索引.csv解析）。
 */
export interface ImageIndexRow {
  /** 本地文件名 */
  fileName: string;
  /** 型号 */
  model: string;
  /** 来源页 */
  sourcePage: string;
  /** 原图URL */
  originalUrl: string;
  /** 画面说明 */
  description: string;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 备注 */
  note?: string;
}

/**
 * 适用性判断结果。
 */
export type ApplicabilityStatus = "supported" | "unsupported" | "unknown" | "needs_verification" | "conflict";

export interface ApplicabilityResult {
  /** 适用性状态 */
  status: ApplicabilityStatus;
  /** 原因说明 */
  reason: string;
  /** 证据来源（文件路径、段落标题等） */
  evidence: string[];
  /** 缺失的条件或信息 */
  missingConditions: string[];
  /** 适用条件（如"同一华为账号"、"电脑管家 13.0.2.300及以上"） */
  requiredConditions?: string[];
}

/**
 * 设备关系证据。
 */
export interface DeviceRelationEvidence {
  /** 主设备产品ID */
  primaryProductId: string;
  /** 对端设备类型（如"手机"、"平板"、"打印机"） */
  peerDeviceType: string;
  /** 功能或关系名称（如"超级终端"、"多屏协同"、"华为分享"） */
  featureName: string;
  /** 关系方向（"bidirectional" / "primary_to_peer" / "peer_to_primary"） */
  direction: "bidirectional" | "primary_to_peer" | "peer_to_primary";
  /** 支持状态 */
  applicability: ApplicabilityResult;
  /** 证据来源（产品事实、官方支持条目等） */
  evidenceSource: string[];
}

/**
 * ima 搜索结果条目（映射自 ima API KnowledgeInfo）。
 */
export interface ImaKnowledgeItem {
  mediaId: string;
  title: string;
  parentFolderId: string;
  kbId: string;
  kbName: string;
  mediaType: string;
  /** 搜索时的高亮片段 */
  highlight?: string;
}

/**
 * 本地知识库配置。
 */
export interface LocalKbConfig {
  /** 知识库根目录 */
  rootDir: string;
  /** P1 产品参数库路径 */
  p1Dir: string;
  /** P7 常见问题库路径 */
  p7Dir: string;
}

/**
 * ima 配置。
 */
export interface ImaConfig {
  clientId?: string;
  apiKey?: string;
  kbName: string;
  /** ima API base URL */
  baseUrl?: string;
}

/**
 * 数据源状态（内部使用，最终映射为 DataSourceStatus）。
 */
export interface InternalSourceStatus {
  origin: DataOrigin;
  state: "connected" | "not_configured" | "error" | "not_verified";
  enabled: boolean;
  message: string;
  /** 验证备注（如"ima接口未经真实凭证验证"） */
  verificationNote?: string;
}
