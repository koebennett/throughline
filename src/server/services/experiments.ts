import { ExperimentInput } from "../../shared/schemas.js";
import type { z } from "zod";
import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { notFound } from "../lib/errors.js";
import { audit } from "./audit.js";

export function listExperiments(db: Db, brandId: string) {
  return dtos(db.all("SELECT * FROM experiments WHERE brand_id = ? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, created_at DESC", brandId));
}
export function upsertExperiment(db: Db, brandId: string, input: z.input<typeof ExperimentInput>, id?: string) {
  const e = ExperimentInput.parse(input);
  const row = { hypothesis: e.hypothesis, variable: e.variable, target_metric: e.targetMetric, success_threshold: e.successThreshold, start_date: e.startDate, end_date: e.endDate, status: e.status, result: e.result, decision: e.decision, content_item_ids_json: e.contentItemIds, updated_at: now() };
  if (id) {
    const cur = db.get("SELECT status FROM experiments WHERE id = ? AND brand_id = ?", id, brandId);
    if (!cur) throw notFound("Experiment");
    db.update("experiments", id, row);
    if (cur.status !== e.status) audit(db, { brandId, entityType: "experiment", entityId: id, action: "status_changed", from: cur.status, to: e.status });
  } else {
    id = newId("exp");
    db.insert("experiments", { id, brand_id: brandId, ...row, created_at: now() });
    audit(db, { brandId, entityType: "experiment", entityId: id, action: "created" });
  }
  return dto(db.get("SELECT * FROM experiments WHERE id = ?", id));
}
export function deleteExperiment(db: Db, id: string) {
  db.run("DELETE FROM experiments WHERE id = ?", id);
}
