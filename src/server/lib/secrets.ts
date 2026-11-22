// Encrypted secret store (AES-256-GCM). Key from CSA_SECRET_KEY or a generated local key file
// stored next to the database with 0600 permissions. Secret values never leave the server.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "../db/db.js";
import { now } from "../db/db.js";

export class SecretStore {
  private key: Buffer;
  constructor(private db: Db, keyHex: string | undefined, keyFile: string) {
    if (keyHex && /^[0-9a-fA-F]{64}$/.test(keyHex)) this.key = Buffer.from(keyHex, "hex");
    else if (existsSync(keyFile)) this.key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex");
    else {
      this.key = randomBytes(32);
      if (keyFile !== ":memory:") {
        mkdirSync(dirname(keyFile), { recursive: true });
        writeFileSync(keyFile, this.key.toString("hex"), { mode: 0o600 });
      }
    }
  }
  set(name: string, value: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
    this.db.run(
      "INSERT INTO secrets (name, ciphertext, iv, tag, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, tag=excluded.tag, updated_at=excluded.updated_at",
      name, ct.toString("base64"), iv.toString("base64"), c.getAuthTag().toString("base64"), now(),
    );
  }
  get(name: string): string | null {
    const r = this.db.get<{ ciphertext: string; iv: string; tag: string }>("SELECT * FROM secrets WHERE name = ?", name);
    if (!r) return null;
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(r.iv, "base64"));
    d.setAuthTag(Buffer.from(r.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(r.ciphertext, "base64")), d.final()]).toString("utf8");
  }
  has(name: string) {
    return !!this.db.get("SELECT 1 FROM secrets WHERE name = ?", name);
  }
  delete(prefix: string) {
    this.db.run("DELETE FROM secrets WHERE name = ? OR name LIKE ?", prefix, `${prefix}:%`);
  }
}
