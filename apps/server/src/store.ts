import fs from "node:fs";
import path from "node:path";
import { SessionRecordSchema, type SessionRecord } from "@hwpc/contracts";

export class StorageError extends Error {
  constructor(
    message: string,
    /** invalid_id：编号本身不合法（对外按“不存在”处理）；io：文件读写或格式问题。 */
    public readonly kind: "invalid_id" | "io" = "io",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface LoadedSession {
  sessionId: string;
  record?: SessionRecord;
  unreadable?: string;
}

export interface SessionStore {
  readonly persistent: boolean;
  save(record: SessionRecord): void;
  load(sessionId: string): SessionRecord | undefined;
  list(): LoadedSession[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** 内存存储：仅用于测试；重启即丢失。 */
export class MemorySessionStore implements SessionStore {
  readonly persistent = false;
  private map = new Map<string, string>();
  save(record: SessionRecord): void {
    this.map.set(record.sessionId, JSON.stringify(record));
  }
  load(sessionId: string): SessionRecord | undefined {
    const raw = this.map.get(sessionId);
    return raw ? SessionRecordSchema.parse(JSON.parse(raw)) : undefined;
  }
  list(): LoadedSession[] {
    return [...this.map.keys()].map((sessionId) => ({ sessionId, record: this.load(sessionId) }));
  }
}

/**
 * 文件存储：每个会话一个 JSON 文件，写入时先写临时文件再改名（同目录原子替换），
 * 避免进程中途退出留下半个文件。读取时重新校验 schema，损坏文件不会拖垮其他会话。
 * 只有本进程写入；多进程并发写同一目录不受支持。
 */
export class FileSessionStore implements SessionStore {
  readonly persistent = true;

  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new StorageError(`会话 ${id} 不存在`, "invalid_id");
    return path.join(this.dir, `${id}.json`);
  }

  save(record: SessionRecord): void {
    const target = this.file(record.sessionId);
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(record), "utf8");
      fs.renameSync(tmp, target);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* 临时文件可能没创建出来 */
      }
      throw new StorageError(`会话保存失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  load(sessionId: string): SessionRecord | undefined {
    const f = this.file(sessionId);
    if (!fs.existsSync(f)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      throw new StorageError(`会话文件无法解析（可能已损坏）: ${sessionId}`);
    }
    const parsed = SessionRecordSchema.safeParse(raw);
    if (!parsed.success) throw new StorageError(`会话文件不符合当前格式: ${sessionId}（${parsed.error.issues[0]?.message ?? "未知"}）`);
    return parsed.data;
  }

  list(): LoadedSession[] {
    const out: LoadedSession[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const sessionId = name.slice(0, -5);
      if (!SAFE_ID.test(sessionId)) continue;
      try {
        out.push({ sessionId, record: this.load(sessionId) });
      } catch (e) {
        out.push({ sessionId, unreadable: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }
}
