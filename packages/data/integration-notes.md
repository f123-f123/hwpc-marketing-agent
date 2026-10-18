# packages/data 集成说明（A → 主 Agent）

## 当前生效的结构

```
src/
├── index.ts          # createDataService：auto/local/ima/mock 分派 + 状态聚合 + createDeviceKnowledgeService
├── local/index.ts    # local 模式 DataService（扫描 P1-产品参数库，按契约返回）
├── local/scanner.ts  # 型号目录扫描（productId = 型号目录 slug + 分组序号）
├── local/material.ts # 组装 MaterialPack（事实/图片复用 src/local.ts 的解析器）
├── local/parser.ts   # 产品事实段落 / 配置提取
├── local/image.ts    # 本地图片读取（限制在知识库目录内）
├── local.ts          # 解析与检索工具（parseFacts / parseImages / stableId / searchResult）+ 旧字符串入参服务
├── ima.ts            # ima OpenAPI 适配（真实实现；无凭证时如实 not_configured）
├── ima/index.ts      # ima 重构草稿（当前未接入，见下）
├── devices.ts        # 设备能力与关系取证（只返回有原文依据的；查不到=unknown）
└── types.ts          # 内部类型（不进入公共契约）
```

## 本轮修了什么

- `index.ts` 恢复为可用的分派：`auto` 依次尝试 ima、本地，都不可用时报 `not_configured`，不静默用 mock。
- 本地知识库根目录在未配置 `LOCAL_KB_DIR` 时使用 `defaultLocalRoot()`（`code/local-data/华为PC全板块深度知识库_v7`）。
- `local/*` 新模块原本按另一套字段书写（`content` / `url` / `localPath` / `width,height` 等），已映射回公共契约：
  - `FactRecord`：`field/value/category/qualifiers/source/reviewStatus`；
  - `ImageRecord`：`role/description/access=local_file/mimeType`；
  - `SourceRef`：`origin/title/locator/officialUrl`（不再自造 `url`、`localPath`）；
  - `MaterialPack`：`packId/products/facts/images/conflicts/gaps/origins/isMock/createdAt`。
- 修掉两处真实缺陷：配置提取正则里的 `\Z` 在 JS 中不表示结尾，导致配置永远提取不到；`match[1]` 未判空会抛异常。
- 图片读取增加路径穿越检查，并且只返回磁盘上真实存在、仍在知识库目录内的图片。

## 需要主 Agent 知道的两点

1. **两套本地实现并存**：`src/local.ts` 的 `createLocalDataService(rootDir?: string)` 仍在（被 `data.test.ts` 与 `ima.ts` 的本地回退使用）；运行入口使用的是 `src/local/index.ts`。两者 productId 方案不同（旧的是哈希，新的是目录 slug + 分组号），旧会话里若存了旧 productId 需要重新检索。
2. **`src/ima/index.ts` 是未完成的重构桩**，`searchProducts/getMaterialPack/readImage` 全部抛"待实现"。它没有被 `src/index.ts` 引用；真实 ima 能力仍由 `src/ima.ts` 提供。完成前不要切到它。

## 证据缺口（会影响服务端场景适用性）

`devices.ts` 目前只能从产品事实文本里匹配"多屏协同 / 文件互传 / 星闪 / 超级终端"四类功能，且关系需要成对设备身份（PC + 手机 / 显示器）。本地库只有 PC 侧产品身份，因此：

- 单设备场景可能得到 `supported`（有原文时）或 `unknown`；
- 跨设备场景的关系恒为 `unknown` → 服务端会跳过该场景并写明原因（预期行为）。

要真正支撑多设备场景，需要补充：对端设备（手机/平板/显示器）的身份与型号、关系的方向与参与方、系统/软件/账号/配件条件及原文位置。
