/**
 * 登录与账号。角色：hq（总部）/ store（门店，绑定一个 storeId）。
 * 首次启动且没有任何账号时，创建一个总部账号和一个示例门店账号，并在日志里提示尽快修改口令。
 */
import type { User } from "@hwpc/contracts";
import type { MarketingRepo, UserRecord } from "./repo.js";
import { hashPassword, TokenSigner, verifyPassword } from "./security.js";

export class AuthError extends Error {
  constructor(
    public readonly code: "unauthorized" | "forbidden" | "validation_error" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
const now = () => new Date().toISOString();

export const toUser = (r: UserRecord): User => ({ username: r.username, displayName: r.displayName, role: r.role, ...(r.storeId ? { storeId: r.storeId } : {}) });

export class AuthService {
  constructor(
    private repo: MarketingRepo,
    private signer: TokenSigner,
  ) {}

  /** 没有任何账号时创建初始账号。返回创建的账号说明（用于启动日志）。 */
  seed(initial: { hqPassword: string; storePassword: string }): string[] {
    if (this.repo.users.list().length > 0) return [];
    const t = now();
    this.repo.users.put("hq", { username: "hq", displayName: "总部管理员", role: "hq", passwordHash: hashPassword(initial.hqPassword), passwordVersion: 0, createdAt: t });
    this.repo.stores.put("store001", { storeId: "store001", name: "示例门店", city: "", area: "", audience: "", staffName: "", contactLine: "", activity: "", updatedAt: t });
    this.repo.users.put("store001", { username: "store001", displayName: "示例门店导购", role: "store", storeId: "store001", passwordHash: hashPassword(initial.storePassword), passwordVersion: 0, createdAt: t });
    return ["hq（总部）", "store001（示例门店）"];
  }

  login(username: string, password: string): { token: string; user: User; expiresAt: string } {
    const rec = this.repo.users.get(username);
    // 用户不存在时也做一次散列比较，避免通过响应时间判断账号是否存在。
    const ok = rec ? verifyPassword(password, rec.passwordHash) : (verifyPassword(password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="), false);
    if (!rec || !ok) throw new AuthError("unauthorized", "账号或口令不正确");
    const exp = Date.now() + TOKEN_TTL_MS;
    return { token: this.signer.sign({ u: rec.username, exp, v: rec.passwordVersion }), user: toUser(rec), expiresAt: new Date(exp).toISOString() };
  }

  /** 校验令牌并返回当前用户；口令改过或账号被删的令牌一律无效。 */
  authenticate(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const p = this.signer.verify(token);
    if (!p) return undefined;
    const rec = this.repo.users.get(p.u);
    if (!rec || rec.passwordVersion !== p.v) return undefined;
    return toUser(rec);
  }

  changePassword(username: string, oldPassword: string, newPassword: string): void {
    const rec = this.repo.users.get(username);
    if (!rec || !verifyPassword(oldPassword, rec.passwordHash)) throw new AuthError("unauthorized", "原口令不正确");
    if (newPassword.length < 8) throw new AuthError("validation_error", "新口令至少 8 位");
    this.repo.users.put(rec.username, { ...rec, passwordHash: hashPassword(newPassword), passwordVersion: rec.passwordVersion + 1 });
  }

  /** 总部创建门店及其登录账号（用户名即门店编号）。 */
  createStore(input: { storeId: string; name: string; password: string }): User {
    if (!/^[A-Za-z0-9_\-]{2,40}$/.test(input.storeId)) throw new AuthError("validation_error", "门店编号只能包含字母、数字、下划线和短横线（2–40 位）");
    if (input.password.length < 8) throw new AuthError("validation_error", "口令至少 8 位");
    if (this.repo.users.get(input.storeId) || this.repo.stores.get(input.storeId)) throw new AuthError("conflict", `门店 ${input.storeId} 已存在`);
    const t = now();
    this.repo.stores.put(input.storeId, { storeId: input.storeId, name: input.name, city: "", area: "", audience: "", staffName: "", contactLine: "", activity: "", updatedAt: t });
    const rec: UserRecord = { username: input.storeId, displayName: `${input.name}导购`, role: "store", storeId: input.storeId, passwordHash: hashPassword(input.password), passwordVersion: 0, createdAt: t };
    this.repo.users.put(rec.username, rec);
    return toUser(rec);
  }

  /** 总部重置门店口令。 */
  resetPassword(username: string, password: string): void {
    const rec = this.repo.users.get(username);
    if (!rec) throw new AuthError("validation_error", `账号 ${username} 不存在`);
    if (password.length < 8) throw new AuthError("validation_error", "口令至少 8 位");
    this.repo.users.put(rec.username, { ...rec, passwordHash: hashPassword(password), passwordVersion: rec.passwordVersion + 1 });
  }
}
