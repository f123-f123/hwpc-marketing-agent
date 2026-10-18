import { createHash } from "node:crypto";

/** 稳定序列化（键排序），用于指纹。 */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const hash = (v: unknown): string => createHash("sha256").update(stableStringify(v)).digest("hex").slice(0, 16);

export const clone = <T>(v: T): T => structuredClone(v);

/** 归一化文本：去空白、小写、全角转半角，用于型号/事实比对。 */
export function norm(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .replace(/[【】\[\]()（）]/g, "")
    .toLowerCase();
}

export const uniq = <T>(a: T[]): T[] => [...new Set(a)];

export function nextId(prefix: string, existing: { length: number }): string {
  return `${prefix}-${existing.length + 1}`;
}
