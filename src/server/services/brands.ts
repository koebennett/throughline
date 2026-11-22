import { BrandProfile, type BrandProfileInput } from "../../shared/schemas.js";
import type { Db } from "../db/db.js";
import { newId, now, parseJson } from "../db/db.js";
import { notFound } from "../lib/errors.js";
import { audit } from "./audit.js";

export function ensureWorkspace(db: Db): string {
  const ws = db.get<{ id: string }>("SELECT id FROM workspaces ORDER BY created_at LIMIT 1");
  if (ws) return ws.id;
  const id = newId("ws");
  db.insert("workspaces", { id, name: "My workspace", created_at: now() });
  return id;
}

export function listBrands(db: Db) {
  return db
    .all("SELECT id, name, is_demo, current_version, created_at, updated_at FROM brands WHERE deleted_at IS NULL ORDER BY is_demo, created_at")
    .map((b) => ({ id: b.id, name: b.name, isDemo: !!b.is_demo, version: b.current_version, createdAt: b.created_at, updatedAt: b.updated_at }));
}

export function createBrand(db: Db, input: BrandProfileInput, opts: { isDemo?: boolean; actor?: string } = {}) {
  const profile = BrandProfile.parse(input);
  const id = newId("brand");
  const ts = now();
  db.tx(() => {
    db.insert("brands", { id, workspace_id: ensureWorkspace(db), name: profile.name, is_demo: opts.isDemo ? 1 : 0, current_version: 1, created_at: ts, updated_at: ts });
    db.insert("brand_profile_versions", { id: newId("bpv"), brand_id: id, version: 1, profile_json: profile, change_note: "Initial profile", created_by: opts.actor ?? "user", created_at: ts });
    audit(db, { brandId: id, entityType: "brand", entityId: id, action: "created", detail: { demo: !!opts.isDemo }, actor: opts.actor });
  });
  return getBrand(db, id);
}

export function getBrand(db: Db, id: string) {
  const b = db.get("SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL", id);
  if (!b) throw notFound("Brand");
  const v = db.get("SELECT * FROM brand_profile_versions WHERE brand_id = ? AND version = ?", id, b.current_version);
  return {
    id: b.id as string,
    name: b.name as string,
    isDemo: !!b.is_demo,
    version: b.current_version as number,
    profile: BrandProfile.parse(parseJson(v?.profile_json, { name: b.name })),
    updatedAt: b.updated_at as string,
  };
}

/** Every edit creates a new immutable version; nothing is silently overwritten. */
export function updateProfile(db: Db, id: string, input: BrandProfileInput, changeNote = "", actor = "user") {
  const current = getBrand(db, id);
  const profile = BrandProfile.parse(input);
  const version = current.version + 1;
  const ts = now();
  db.tx(() => {
    db.insert("brand_profile_versions", { id: newId("bpv"), brand_id: id, version, profile_json: profile, change_note: changeNote.slice(0, 500), created_by: actor, created_at: ts });
    db.update("brands", id, { current_version: version, name: profile.name, updated_at: ts });
    audit(db, { brandId: id, entityType: "brand", entityId: id, action: "profile_updated", from: String(current.version), to: String(version), detail: { changeNote }, actor });
  });
  return getBrand(db, id);
}

export function listProfileVersions(db: Db, id: string) {
  return db
    .all("SELECT version, change_note, created_by, created_at, profile_json FROM brand_profile_versions WHERE brand_id = ? ORDER BY version DESC", id)
    .map((r) => ({ version: r.version, changeNote: r.change_note, createdBy: r.created_by, createdAt: r.created_at, profile: parseJson(r.profile_json, {}) }));
}

export function restoreProfileVersion(db: Db, id: string, version: number) {
  const v = db.get("SELECT profile_json FROM brand_profile_versions WHERE brand_id = ? AND version = ?", id, version);
  if (!v) throw notFound("Profile version");
  return updateProfile(db, id, parseJson(v.profile_json, {}) as BrandProfileInput, `Restored version ${version}`);
}

/** Hard-delete a brand and all its data (user deletion request). Records a workspace-level audit event. */
export function deleteBrand(db: Db, id: string) {
  const b = getBrand(db, id);
  db.tx(() => {
    db.run("INSERT INTO settings (key, value_json, updated_at) VALUES ('__audit_purge_brand', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json", id, now());
    db.run("DELETE FROM chunks_fts WHERE brand_id = ?", id);
    db.run("DELETE FROM usage_records WHERE brand_id = ?", id);
    db.run("DELETE FROM audit_events WHERE brand_id = ?", id);
    db.run("DELETE FROM settings WHERE key = '__audit_purge_brand'");
    db.run("DELETE FROM brands WHERE id = ?", id);
    audit(db, { brandId: null, entityType: "brand", entityId: id, action: "deleted", detail: { demo: b.isDemo } });
  });
  // Flush deleted pages out of the WAL so removed data doesn't linger on disk.
  try {
    db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    /* in-memory DB */
  }
}
