import type { Db } from "../db/db.js";
import { newId, now, parseJson } from "../db/db.js";

export interface AuditInput {
  brandId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  from?: string;
  to?: string;
  detail?: Record<string, unknown>;
  actor?: string;
}

export function audit(db: Db, e: AuditInput) {
  db.insert("audit_events", {
    id: newId("aud"),
    brand_id: e.brandId ?? null,
    entity_type: e.entityType,
    entity_id: e.entityId,
    action: e.action,
    from_state: e.from ?? "",
    to_state: e.to ?? "",
    detail_json: e.detail ?? {},
    actor: e.actor ?? "user",
    created_at: now(),
  });
}

export function listAudit(db: Db, filter: { brandId?: string; entityId?: string; limit?: number }) {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.brandId) {
    where.push("brand_id = ?");
    params.push(filter.brandId);
  }
  if (filter.entityId) {
    where.push("entity_id = ?");
    params.push(filter.entityId);
  }
  const rows = db.all(
    `SELECT * FROM audit_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, rowid DESC LIMIT ${Math.min(filter.limit ?? 200, 1000)}`,
    ...params,
  );
  return rows.map((r) => ({ ...r, detail: parseJson(r.detail_json, {}) }));
}
