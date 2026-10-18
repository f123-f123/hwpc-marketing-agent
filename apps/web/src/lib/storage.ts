/** localStorage 的安全读写：隐私模式、配额满或内容损坏时静默回退，不让页面崩溃。 */

export const KEYS = {
  session: "hwpc.active-session-id",
  view: "hwpc.showroom-view",
  activeInstance: "hwpc.active-instance",
} as const;

export function readJson<T>(key: string, isValid: (v: unknown) => v is T): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存不下就算了：这些只是界面偏好 */
  }
}

export function readText(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 同上 */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}
