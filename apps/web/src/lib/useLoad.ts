import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 页面数据加载：返回数据、加载中、错误与重新加载。
 * onError 用于把 401 交给登录状态处理。
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], onError?: (e: unknown) => void) {
  const [data, setData] = useState<T | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRef = useRef(load);
  loadRef.current = load;
  const errRef = useRef(onError);
  errRef.current = onError;

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadRef.current());
    } catch (e) {
      errRef.current?.(e);
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps);
  return { data, setData, loading, error, reload };
}

/** 包装一次用户操作：执行期间 busy，失败时给出可读错误。 */
export function useAction(onError?: (e: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError("");
      try {
        return await fn();
      } catch (e) {
        onError?.(e);
        setError(e instanceof Error ? e.message : "操作失败");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [onError],
  );
  return { busy, error, setError, run };
}
