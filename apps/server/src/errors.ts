import type { ApiErrorCode } from "@hwpc/contracts";

/** 会话层业务错误，直接映射为 HTTP 错误码。details 可带最新快照等机器可读信息。 */
export class SessionError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SessionError";
  }
}
