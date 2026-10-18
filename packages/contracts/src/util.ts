/** 稳定序列化：对象键排序，保证同一内容得到同一字符串。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * cyrb53 非加密哈希，浏览器与 Node 通用。
 * 只用于变更检测与完整性校验（发现损坏、版本漂移），不是安全签名，不能防篡改。
 */
export function hashString(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export const hashOf = (value: unknown): string => hashString(stableStringify(value));

/** 文本规整：去空白、统一大小写与全半角标点，用于“引用是否出自用户原话”的比较。 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　，。！？、；：“”‘’"'`,.!?;:()（）【】\[\]-]+/g, "");
}
