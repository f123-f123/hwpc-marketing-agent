/**
 * 安全原语：口令散列（scrypt）、登录令牌（HMAC-SHA256 签名）、平台密钥加密（AES-256-GCM）。
 * 主密钥来自环境变量 AUTH_SECRET；未设置时在数据目录生成并保存一份，保证重启后令牌与已加密密钥仍可用。
 * 公网部署必须显式设置 AUTH_SECRET，并保护好数据目录。
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function loadMasterSecret(dataDir: string, fromEnv: string | undefined): { secret: Buffer; generated: boolean } {
  if (fromEnv && fromEnv.length >= 16) return { secret: Buffer.from(fromEnv, "utf8"), generated: false };
  const file = path.join(dataDir, "master.key");
  if (fs.existsSync(file)) return { secret: Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64"), generated: false };
  const secret = randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret.toString("base64"), { encoding: "utf8", mode: 0o600 });
  return { secret, generated: true };
}

/* ------------------------------ 口令 ------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/* ------------------------------ 令牌 ------------------------------ */

const b64url = (b: Buffer) => b.toString("base64url");

export interface TokenPayload {
  /** 用户名 */
  u: string;
  /** 到期时间（毫秒） */
  exp: number;
  /** 口令版本：改口令后旧令牌失效 */
  v: number;
}

export class TokenSigner {
  private key: Buffer;
  constructor(master: Buffer) {
    this.key = createHmac("sha256", master).update("hwpc-token-v1").digest();
  }
  sign(payload: TokenPayload): string {
    const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    return `${body}.${b64url(createHmac("sha256", this.key).update(body).digest())}`;
  }
  verify(token: string): TokenPayload | undefined {
    const [body, sig] = token.split(".");
    if (!body || !sig) return undefined;
    const expected = createHmac("sha256", this.key).update(body).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
    try {
      const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
      return typeof p.u === "string" && typeof p.exp === "number" && p.exp > Date.now() ? p : undefined;
    } catch {
      return undefined;
    }
  }
}

/* ------------------------------ 密钥加密 ------------------------------ */

export class SecretBox {
  private key: Buffer;
  constructor(master: Buffer) {
    this.key = createHmac("sha256", master).update("hwpc-secretbox-v1").digest();
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `v1.${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(data)}`;
  }
  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || !data) throw new Error("密文格式不正确");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}
