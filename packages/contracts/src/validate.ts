import { MaterialPackSchema, type MaterialPack } from "./material.js";
import { ResultVersionSchema, type ResultVersion } from "./run.js";

/**
 * 跨对象一致性检查（schema 本身表达不了的引用关系）。
 * 返回问题列表；空数组表示通过。
 */
export function checkMaterialPack(pack: MaterialPack): string[] {
  const issues: string[] = [];
  const productIds = new Set(pack.products.map((p) => p.productId));
  const factIds = new Set<string>();
  const imageIds = new Set<string>();

  for (const f of pack.facts) {
    if (factIds.has(f.factId)) issues.push(`重复的 factId: ${f.factId}`);
    factIds.add(f.factId);
    if (!productIds.has(f.productId)) issues.push(`事实 ${f.factId} 引用了不存在的产品 ${f.productId}`);
    checkConfigs(f.factId, f.productId, f.configurationIds, pack, issues);
  }
  for (const im of pack.images) {
    if (imageIds.has(im.imageId)) issues.push(`重复的 imageId: ${im.imageId}`);
    imageIds.add(im.imageId);
    if (!productIds.has(im.productId)) issues.push(`图片 ${im.imageId} 引用了不存在的产品 ${im.productId}`);
    checkConfigs(im.imageId, im.productId, im.configurationIds, pack, issues);
  }
  for (const c of pack.conflicts) {
    for (const id of c.factIds) if (!factIds.has(id)) issues.push(`冲突 ${c.conflictId} 引用了不存在的事实 ${id}`);
  }

  const originsInData = new Set<string>([
    ...pack.products.map((p) => p.origin),
    ...pack.facts.map((f) => f.source.origin),
    ...pack.images.map((i) => i.source.origin),
  ]);
  for (const o of originsInData) if (!pack.origins.includes(o as never)) issues.push(`origins 缺少 ${o}`);
  const hasMock = originsInData.has("mock") || pack.origins.includes("mock");
  if (hasMock !== pack.isMock) issues.push(`isMock(${pack.isMock}) 与数据来源中是否含 mock(${hasMock}) 不一致`);

  for (const im of pack.images) {
    if (im.access.kind === "mock_placeholder" && im.source.origin !== "mock") {
      issues.push(`图片 ${im.imageId} 使用占位图但来源不是 mock`);
    }
    if (im.source.origin === "mock" && im.access.kind !== "mock_placeholder") {
      issues.push(`mock 图片 ${im.imageId} 必须使用 mock_placeholder 访问方式`);
    }
  }
  return issues;
}

function checkConfigs(id: string, productId: string, configIds: string[], pack: MaterialPack, issues: string[]) {
  const product = pack.products.find((p) => p.productId === productId);
  if (!product) return;
  const known = new Set(product.configurations.map((c) => c.configurationId));
  for (const c of configIds) if (!known.has(c)) issues.push(`${id} 引用了产品 ${productId} 不存在的配置 ${c}`);
}

/** 校验图文结果对事实、图片的绑定，以及型号一致性。 */
export function checkResultVersion(rv: ResultVersion): string[] {
  const issues = checkMaterialPack(rv.materialPack);
  const facts = new Map(rv.materialPack.facts.map((f) => [f.factId, f]));
  const images = new Map(rv.materialPack.images.map((i) => [i.imageId, i]));
  const { article } = rv;

  if (article.platform !== rv.strategy.platformPlan.platform) issues.push("文章平台与策略平台不一致");

  article.blocks.forEach((b, idx) => {
    if (b.type === "paragraph") {
      for (const id of b.factIds) if (!facts.has(id)) issues.push(`段落 ${idx} 引用了不存在的事实 ${id}`);
    } else if (!images.has(b.imageId)) {
      issues.push(`图片块 ${idx} 引用了不存在的图片 ${b.imageId}`);
    }
  });
  for (const id of rv.strategy.sellingPointFactIds) if (!facts.has(id)) issues.push(`策略引用了不存在的事实 ${id}`);

  const blockCount = article.blocks.length;
  rv.verification.findings.forEach((f) => {
    if (f.blockIndex !== undefined && f.blockIndex >= blockCount) issues.push(`核验项 ${f.findingId} 的 blockIndex 越界`);
    for (const id of f.factIds) if (!facts.has(id)) issues.push(`核验项 ${f.findingId} 引用了不存在的事实 ${id}`);
    for (const id of f.imageIds) if (!images.has(id)) issues.push(`核验项 ${f.findingId} 引用了不存在的图片 ${id}`);
  });

  // 交付状态与核验项一致：有 pending_user 不得标为可交付；有未解决冲突必须 blocked
  const hasPending = rv.verification.findings.some((f) => f.resolution === "pending_user") || rv.verification.pendingConfirmations.length > 0;
  const status = rv.verification.deliveryStatus;
  if (hasPending && (status === "deliverable" || status === "deliverable_with_notes")) {
    issues.push("存在待确认项，deliveryStatus 不能是 deliverable / deliverable_with_notes");
  }
  if (rv.materialPack.conflicts.some((c) => c.status === "unresolved") && status !== "blocked") {
    issues.push("存在未解决的资料冲突，deliveryStatus 必须为 blocked");
  }
  if (rv.materialPack.isMock && !rv.isMock) issues.push("资料包为 mock，结果版本 isMock 必须为 true");
  return issues;
}

export function parseMaterialPack(data: unknown): MaterialPack {
  const pack = MaterialPackSchema.parse(data);
  const issues = checkMaterialPack(pack);
  if (issues.length) throw new Error(`MaterialPack 不一致:\n- ${issues.join("\n- ")}`);
  return pack;
}

export function parseResultVersion(data: unknown): ResultVersion {
  const rv = ResultVersionSchema.parse(data);
  const issues = checkResultVersion(rv);
  if (issues.length) throw new Error(`ResultVersion 不一致:\n- ${issues.join("\n- ")}`);
  return rv;
}
