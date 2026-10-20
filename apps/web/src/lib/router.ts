import { useEffect, useState } from "react";

/**
 * 极简 hash 路由：#/advisor、#/posts/<任务编号>、#/hq/campaigns/<编号> ……
 * 用 hash 是为了不改后端与 Vite 配置就能刷新、分享链接。
 */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export function navigate(...parts: string[]): void {
  window.location.hash = `#/${parts.map(encodeURIComponent).join("/")}`;
}

export const href = (...parts: string[]) => `#/${parts.map(encodeURIComponent).join("/")}`;
