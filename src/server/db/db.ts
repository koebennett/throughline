import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { MIGRATIONS } from "./migrations.js";

export type Row = Record<string, any>;

export class Db {
  readonly raw: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON;");
    if (path !== ":memory:") this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }
  /** Insert a row from an object. Keys are trusted column names from code, never user input. */
  insert(table: string, row: Row) {
    const keys = Object.keys(row);
    const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
    return this.run(sql, ...keys.map((k) => toSql(row[k])));
  }
  update(table: string, id: string, patch: Row, idCol = "id") {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE ${idCol} = ?`;
    return this.run(sql, ...keys.map((k) => toSql(patch[k])), id);
  }
  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
  migrate(): number[] {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const applied = new Set(this.all<{ id: number }>("SELECT id FROM schema_migrations").map((r) => r.id));
    const ran: number[] = [];
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)", m.id, m.name, now());
      });
      ran.push(m.id);
    }
    return ran;
  }
  close() {
    this.raw.close();
  }
}

function toSql(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v as SQLInputValue;
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function openDb(path: string): Db {
  const db = new Db(path);
  db.migrate();
  return db;
}
