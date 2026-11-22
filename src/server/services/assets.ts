// User-owned / licensed assets and content lineage. No third-party media is downloaded or re-hosted.
import { z } from "zod";
import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { notFound } from "../lib/errors.js";
import { audit } from "./audit.js";

export const RIGHTS = ["owned", "licensed", "public_domain", "permissioned", "unknown"] as const;
export const AssetInput = z.object({
  kind: z.enum(["video", "audio", "image", "transcript", "document"]),
  title: z.string().min(1).max(300),
  rights: z.enum(RIGHTS).default("unknown"),
  rightsNote: z.string().max(2000).optional().default(""),
  sourceUrl: z.string().max(2000).optional().default(""),
  filename: z.string().max(300).optional().default(""),
  mime: z.string().max(100).optional().default(""),
  sizeBytes: z.number().int().min(0).optional().default(0),
  textContent: z.string().max(1_000_000).optional().default(""),
});

export function addAsset(db: Db, brandId: string, input: z.input<typeof AssetInput>) {
  const a = AssetInput.parse(input);
  const id = newId("ast");
  db.insert("assets", { id, brand_id: brandId, kind: a.kind, title: a.title, rights: a.rights, rights_note: a.rightsNote, source_url: a.sourceUrl, filename: a.filename, mime: a.mime, size_bytes: a.sizeBytes, text_content: a.textContent, created_at: now() });
  audit(db, { brandId, entityType: "asset", entityId: id, action: "added", detail: { kind: a.kind, rights: a.rights } });
  return getAsset(db, id);
}
export function getAsset(db: Db, id: string) {
  const r = db.get("SELECT * FROM assets WHERE id = ?", id);
  if (!r) throw notFound("Asset");
  return { ...dto(r), derivatives: dtos(db.all("SELECT l.*, c.title AS derivative_title, c.platform, c.status FROM content_lineage l JOIN content_items c ON c.id = l.derivative_content_item_id WHERE l.source_asset_id = ? ORDER BY l.created_at", id)) };
}
export function listAssets(db: Db, brandId: string) {
  return dtos(db.all("SELECT id, kind, title, rights, rights_note, source_url, filename, mime, size_bytes, length(text_content) AS text_chars, created_at, (SELECT count(*) FROM content_lineage l WHERE l.source_asset_id = a.id) AS derivative_count FROM assets a WHERE brand_id = ? ORDER BY created_at DESC", brandId));
}
export function updateAssetRights(db: Db, id: string, rights: (typeof RIGHTS)[number], note: string) {
  const a = getAsset(db, id);
  db.update("assets", id, { rights, rights_note: note.slice(0, 2000) });
  audit(db, { brandId: a.brandId, entityType: "asset", entityId: id, action: "rights_changed", from: a.rights, to: rights, detail: { note } });
  return getAsset(db, id);
}
export function deleteAsset(db: Db, id: string) {
  const a = getAsset(db, id);
  db.run("DELETE FROM assets WHERE id = ?", id);
  audit(db, { brandId: a.brandId, entityType: "asset", entityId: id, action: "deleted" });
}
export function addLineage(db: Db, brandId: string, l: { sourceAssetId?: string | null; sourceContentItemId?: string | null; derivativeContentItemId: string; segmentStart?: string; segmentEnd?: string; quote?: string; note?: string }) {
  db.insert("content_lineage", { id: newId("lin"), brand_id: brandId, source_asset_id: l.sourceAssetId ?? null, source_content_item_id: l.sourceContentItemId ?? null, derivative_content_item_id: l.derivativeContentItemId, segment_start: l.segmentStart ?? "", segment_end: l.segmentEnd ?? "", quote: (l.quote ?? "").slice(0, 2000), note: (l.note ?? "").slice(0, 1000), created_at: now() });
}
export function lineageMap(db: Db, brandId: string) {
  return dtos(db.all("SELECT l.*, a.title AS asset_title, a.rights AS asset_rights, d.title AS derivative_title, d.platform AS derivative_platform, d.status AS derivative_status FROM content_lineage l LEFT JOIN assets a ON a.id = l.source_asset_id JOIN content_items d ON d.id = l.derivative_content_item_id WHERE l.brand_id = ? ORDER BY l.created_at", brandId));
}
export function rightsForItem(db: Db, itemId: string) {
  return db.all<{ title: string; rights: string }>("SELECT a.title, a.rights FROM content_lineage l JOIN assets a ON a.id = l.source_asset_id WHERE l.derivative_content_item_id = ?", itemId);
}
export function sourceTextsForItem(db: Db, itemId: string) {
  return db.all<{ t: string }>("SELECT a.text_content AS t FROM content_lineage l JOIN assets a ON a.id = l.source_asset_id WHERE l.derivative_content_item_id = ? AND a.text_content != ''", itemId).map((r) => r.t);
}
