import { useCallback, useEffect, useState } from "react";
import type { User } from "@hwpc/contracts";
import { ApiError } from "../api/client";
import { marketingApi } from "../api/marketing";

/** 登录状态：令牌在 HttpOnly Cookie 里，前端只关心“当前是谁”。 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    marketingApi
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await marketingApi.login(username, password);
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await marketingApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  /** 任意请求返回 401 时调用，回到登录页。 */
  const handleError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setUser(null);
  }, []);

  return { user, checking, login, logout, handleError };
}

export type Auth = ReturnType<typeof useAuth>;
