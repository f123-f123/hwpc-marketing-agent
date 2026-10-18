/**
 * 解析产品事实.md 的段落结构，提取变体和配置。
 */
import type { FactSection, VariantBlock, ConfigurationCandidate } from "../types.js";
import * as fs from "node:fs";

/**
 * 解析产品事实.md，返回段落列表。
 */
export function parseProductFacts(factPath: string): FactSection[] {
  const content = fs.readFileSync(factPath, "utf-8");
  const sections: FactSection[] = [];

  // 按 ## 段落标题分割
  const sectionRegex = /^## (.+?)\n([\s\S]*?)(?=^## |\n*$)/gm;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const heading = (match[1] ?? "").trim();
    const body = (match[2] ?? "").trim();

    // 提取变体块（段落内的 "标准版："、"柔光版："、"Windows 版"等）
    const variants = extractVariants(body);

    sections.push({ heading, content: body, variants });
  }

  return sections;
}

/**
 * 从段落内容中提取变体块。
 * 识别模式：
 * - "标准版："、"柔光版："、"Windows 版"（后跟冒号）
 * - 表格形式的对比（暂不解析，留给后续）
 */
function extractVariants(body: string): VariantBlock[] {
  const variants: VariantBlock[] = [];
  const variantRegex = /^([^\n]+?版|[^\n]+?款|Windows|Linux|HarmonyOS)\s*[:：]\s*$/gm;
  const matches = Array.from(body.matchAll(variantRegex));

  if (matches.length === 0) {
    // 无变体标记，整段作为通用内容
    return [{ label: "", content: body }];
  }

  // 按变体标记分段
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const next = matches[i + 1];
    const label = (current[1] ?? "").trim();
    const start = current.index + current[0].length;
    const end = next ? next.index : body.length;
    const content = body.slice(start, end).trim();
    variants.push({ label, content });
  }

  return variants;
}

/**
 * 从产品事实中提取配置候选（内存×存储组合）。
 */
export function extractConfigurations(factPath: string, productId: string): ConfigurationCandidate[] {
  const content = fs.readFileSync(factPath, "utf-8");
  const configs: ConfigurationCandidate[] = [];

  // 提取内存段落
  const memMatch = content.match(/^## 内存\n\n([\s\S]*?)\n\n(?=## |$)/m);
  const stoMatch = content.match(/^## 存储\n\n([\s\S]*?)\n\n(?=## |$)/m);

  if (!memMatch || !stoMatch) return configs;

  const memLine = (memMatch[1] ?? "").trim().split("\n")[0] ?? ""; // 第一行
  const stoLine = (stoMatch[1] ?? "").trim().split("\n")[0] ?? "";

  // 简单提取：16 GB / 24 GB / 32 GB
  const memOptions = memLine.match(/\d+\s*GB/g) || [];
  const stoOptions = stoLine.match(/\d+\s*(GB|TB)/g) || [];

  // 组合
  if (memOptions.length > 0 && stoOptions.length > 0) {
    for (const mem of memOptions) {
      for (const sto of stoOptions) {
        const label = `${mem}/${sto}`;
        const configurationId = `${productId}-${mem.replace(/\s+/g, "").toLowerCase()}-${sto.replace(/\s+/g, "").toLowerCase()}`;
        configs.push({
          configurationId,
          label,
          attributes: { 内存: mem.trim(), 存储: sto.trim() },
        });
      }
    }
  } else if (memOptions.length > 0) {
    for (const mem of memOptions) {
      const configurationId = `${productId}-${mem.replace(/\s+/g, "").toLowerCase()}`;
      configs.push({
        configurationId,
        label: mem,
        attributes: { 内存: mem.trim() },
      });
    }
  } else if (stoOptions.length > 0) {
    for (const sto of stoOptions) {
      const configurationId = `${productId}-${sto.replace(/\s+/g, "").toLowerCase()}`;
      configs.push({
        configurationId,
        label: sto,
        attributes: { 存储: sto.trim() },
      });
    }
  }

  return configs;
}
