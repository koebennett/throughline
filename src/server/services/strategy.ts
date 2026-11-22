// Strategy Studio: versioned strategies, deterministic validation, and approval that materialises pillars,
// topic clusters and series. Core positioning/pillars/cadence change only through explicit user approval.
import { z } from "zod";
import { StrategyDraft, type BrandProfile } from "../../shared/schemas.js";
import type { Db } from "../db/db.js";
import { newId, now, parseJson } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, notFound } from "../lib/errors.js";
import { audit } from "./audit.js";
import { findGuaranteeLanguage } from "./qa.js";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

export function validateStrategy(s: StrategyDraft, profile: BrandProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (s.pillars.length < 3 || s.pillars.length > 7) issues.push({ level: "error", message: `Strategy has ${s.pillars.length} pillars; 3–7 keeps focus without fragmenting effort.` });
  s.pillars.forEach((p) => {
    if (!p.boundaries.trim()) issues.push({ level: "warning", message: `Pillar "${p.name}" has no boundaries — define what it excludes.` });
    if (!p.clusters.length) issues.push({ level: "warning", message: `Pillar "${p.name}" has no topic clusters.` });
  });
  s.recommendations.forEach((r) => {
    if (!r.successMetric.trim()) issues.push({ level: "error", message: `Recommendation "${r.title}" has no measurable success metric.` });
    if (!r.evidence.trim()) issues.push({ level: "warning", message: `Recommendation "${r.title}" cites no evidence — it is an assumption.` });
  });
  const planned = s.cadence.perWeek.reduce((a, b) => a + (b.count || 0), 0);
  const target = profile.capacity?.postsPerWeekTarget;
  if (target !== undefined && planned > target * 1.25 + 0.5)
    issues.push({ level: "warning", message: `Cadence plans ${planned} pieces/week but stated capacity is ~${target}. Unsustainable cadence erodes quality.` });
  const hits = findGuaranteeLanguage(JSON.stringify(s));
  if (hits.length) issues.push({ level: "error", message: `Strategy contains guarantee language: ${hits.slice(0, 3).join(", ")}.` });
  const markers = (JSON.stringify(s).match(/\[insert:/gi) ?? []).length;
  if (markers) issues.push({ level: "warning", message: `${markers} field(s) still contain “[insert: …]” markers — fill them in so the strategy reflects your own knowledge.` });
  if (!s.experiments.length) issues.push({ level: "warning", message: "No experiments defined — the plan has no built-in learning loop." });
  return issues;
}

export function saveStrategyDraft(db: Db, brandId: string, data: StrategyDraft, generatedBy: string, profile: BrandProfile, agentRunId?: string) {
  const parsed = StrategyDraft.parse(data);
  const version = (db.get<{ v: number }>("SELECT max(version) AS v FROM strategy_versions WHERE brand_id = ?", brandId)?.v ?? 0) + 1;
  const id = newId("strat");
  db.insert("strategy_versions", {
    id, brand_id: brandId, version, status: "draft", data_json: parsed, generated_by: generatedBy, agent_run_id: agentRunId ?? null,
    validation_json: validateStrategy(parsed, profile), created_at: now(),
  });
  audit(db, { brandId, entityType: "strategy", entityId: id, action: "draft_created", to: "draft", detail: { version, generatedBy }, actor: agentRunId ? "agent" : "user" });
  return getStrategy(db, id);
}

export function updateStrategyDraft(db: Db, id: string, data: StrategyDraft, profile: BrandProfile) {
  const cur = getStrategy(db, id);
  if (cur.status !== "draft") throw badRequest("Only draft strategies can be edited. Duplicate it to make changes.");
  const parsed = StrategyDraft.parse(data);
  db.update("strategy_versions", id, { data_json: parsed, validation_json: validateStrategy(parsed, profile) });
  return getStrategy(db, id);
}

export function getStrategy(db: Db, id: string) {
  const r = db.get("SELECT * FROM strategy_versions WHERE id = ?", id);
  if (!r) throw notFound("Strategy");
  return dto(r);
}
export function listStrategies(db: Db, brandId: string) {
  return db
    .all("SELECT id, version, status, generated_by, created_at, approved_at, validation_json FROM strategy_versions WHERE brand_id = ? ORDER BY version DESC", brandId)
    .map((r) => ({ ...dto(r), validation: parseJson(r.validation_json, []) }));
}
export function activeStrategy(db: Db, brandId: string) {
  const r = db.get("SELECT * FROM strategy_versions WHERE brand_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1", brandId);
  return r ? dto(r) : null;
}

/** Approve: supersede the previous strategy, deactivate its pillars, materialise new pillars/clusters/series. */
export function approveStrategy(db: Db, id: string, opts: { acknowledgeWarnings?: boolean } = {}) {
  const s = getStrategy(db, id);
  if (s.status !== "draft") throw badRequest(`Strategy is already ${s.status}.`);
  const errors = (s.validation as ValidationIssue[]).filter((i) => i.level === "error");
  if (errors.length) throw badRequest("Fix validation errors before approving.", errors);
  const warnings = (s.validation as ValidationIssue[]).filter((i) => i.level === "warning");
  if (warnings.length && !opts.acknowledgeWarnings) throw badRequest("Acknowledge the validation warnings to approve.", warnings);
  const data = s.data as StrategyDraft;
  const ts = now();
  db.tx(() => {
    db.run("UPDATE strategy_versions SET status = 'superseded' WHERE brand_id = ? AND status = 'approved'", s.brandId);
    db.run("UPDATE pillars SET active = 0 WHERE brand_id = ?", s.brandId);
    db.update("strategy_versions", id, { status: "approved", approved_at: ts });
    data.pillars.forEach((p, ord) => {
      const pid = newId("pil");
      db.insert("pillars", { id: pid, brand_id: s.brandId, strategy_version_id: id, name: p.name, purpose: p.purpose, audience_need: p.audienceNeed, proof: p.proof, boundaries: p.boundaries, ord, active: 1, created_at: ts });
      for (const c of p.clusters)
        db.insert("topic_clusters", { id: newId("tc"), brand_id: s.brandId, pillar_id: pid, name: c.name, pillar_topic: c.pillarTopic, subtopics_json: c.subtopics, search_intent: c.searchIntent, created_at: ts });
    });
    for (const se of data.series) {
      if (db.get("SELECT 1 FROM series WHERE brand_id = ? AND lower(name) = lower(?)", s.brandId, se.name)) continue;
      db.insert("series", { id: newId("ser"), brand_id: s.brandId, name: se.name, premise: se.premise, format: se.format, cadence: se.cadence, created_at: ts });
    }
    audit(db, { brandId: s.brandId, entityType: "strategy", entityId: id, action: "approved", from: "draft", to: "approved", detail: { warningsAcknowledged: warnings.length } });
  });
  return getStrategy(db, id);
}

export function duplicateStrategy(db: Db, id: string, profile: BrandProfile) {
  const s = getStrategy(db, id);
  return saveStrategyDraft(db, s.brandId, s.data as StrategyDraft, "user (copy of v" + s.version + ")", profile);
}

// ---------------- Pillars / clusters / series / campaigns ----------------
export const PillarInput = z.object({
  name: z.string().min(1).max(200),
  purpose: z.string().max(2000).default(""),
  audienceNeed: z.string().max(2000).default(""),
  proof: z.string().max(2000).default(""),
  boundaries: z.string().max(2000).default(""),
});

export function listPillars(db: Db, brandId: string, includeInactive = false) {
  const pillars = dtos(db.all(`SELECT * FROM pillars WHERE brand_id = ? ${includeInactive ? "" : "AND active = 1"} ORDER BY ord`, brandId));
  const clusters = dtos(db.all("SELECT * FROM topic_clusters WHERE brand_id = ? ORDER BY created_at", brandId));
  return pillars.map((p) => ({ ...p, clusters: clusters.filter((c) => c.pillarId === p.id) }));
}
export function addPillar(db: Db, brandId: string, input: z.input<typeof PillarInput>) {
  const p = PillarInput.parse(input);
  const id = newId("pil");
  const ord = (db.get<{ m: number }>("SELECT max(ord) AS m FROM pillars WHERE brand_id = ?", brandId)?.m ?? -1) + 1;
  db.insert("pillars", { id, brand_id: brandId, name: p.name, purpose: p.purpose, audience_need: p.audienceNeed, proof: p.proof, boundaries: p.boundaries, ord, active: 1, created_at: now() });
  audit(db, { brandId, entityType: "pillar", entityId: id, action: "created" });
  return dto(db.get("SELECT * FROM pillars WHERE id = ?", id));
}
export function updatePillar(db: Db, id: string, input: Partial<z.input<typeof PillarInput>> & { active?: boolean }) {
  const cur = db.get("SELECT * FROM pillars WHERE id = ?", id);
  if (!cur) throw notFound("Pillar");
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.slice(0, 200);
  if (input.purpose !== undefined) patch.purpose = input.purpose;
  if (input.audienceNeed !== undefined) patch.audience_need = input.audienceNeed;
  if (input.proof !== undefined) patch.proof = input.proof;
  if (input.boundaries !== undefined) patch.boundaries = input.boundaries;
  if (input.active !== undefined) patch.active = input.active ? 1 : 0;
  db.update("pillars", id, patch);
  audit(db, { brandId: cur.brand_id, entityType: "pillar", entityId: id, action: "updated" });
  return dto(db.get("SELECT * FROM pillars WHERE id = ?", id));
}
export function addCluster(db: Db, brandId: string, input: { pillarId: string; name: string; pillarTopic?: string; subtopics?: string[]; searchIntent?: string }) {
  if (!db.get("SELECT 1 FROM pillars WHERE id = ? AND brand_id = ?", input.pillarId, brandId)) throw notFound("Pillar");
  const id = newId("tc");
  db.insert("topic_clusters", { id, brand_id: brandId, pillar_id: input.pillarId, name: input.name.slice(0, 200), pillar_topic: input.pillarTopic ?? "", subtopics_json: (input.subtopics ?? []).slice(0, 50), search_intent: input.searchIntent ?? "", created_at: now() });
  return dto(db.get("SELECT * FROM topic_clusters WHERE id = ?", id));
}
export function deleteCluster(db: Db, id: string) {
  db.run("DELETE FROM topic_clusters WHERE id = ?", id);
}

export function listSeries(db: Db, brandId: string) {
  return dtos(db.all("SELECT s.*, (SELECT count(*) FROM ideas i WHERE i.series_id = s.id) AS idea_count FROM series s WHERE brand_id = ? ORDER BY created_at", brandId));
}
export function addSeries(db: Db, brandId: string, input: { name: string; premise?: string; format?: string; cadence?: string; pillarId?: string | null }) {
  const id = newId("ser");
  db.insert("series", { id, brand_id: brandId, name: input.name.slice(0, 200), premise: input.premise ?? "", format: input.format ?? "", cadence: input.cadence ?? "", pillar_id: input.pillarId ?? null, created_at: now() });
  return dto(db.get("SELECT * FROM series WHERE id = ?", id));
}

export const CampaignInput = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(2000).default(""),
  kpi: z.string().max(500).default(""),
  startDate: z.string().max(20).default(""),
  endDate: z.string().max(20).default(""),
  status: z.enum(["planned", "active", "complete", "cancelled"]).default("planned"),
  notes: z.string().max(4000).default(""),
});
export function listCampaigns(db: Db, brandId: string) {
  return dtos(db.all("SELECT c.*, (SELECT count(*) FROM content_items ci WHERE ci.campaign_id = c.id) AS content_count FROM campaigns c WHERE brand_id = ? ORDER BY start_date DESC, created_at DESC", brandId));
}
export function upsertCampaign(db: Db, brandId: string, input: z.input<typeof CampaignInput>, id?: string) {
  const c = CampaignInput.parse(input);
  const row = { name: c.name, goal: c.goal, kpi: c.kpi, start_date: c.startDate, end_date: c.endDate, status: c.status, notes: c.notes, updated_at: now() };
  if (id) {
    if (!db.get("SELECT 1 FROM campaigns WHERE id = ? AND brand_id = ?", id, brandId)) throw notFound("Campaign");
    db.update("campaigns", id, row);
  } else {
    id = newId("camp");
    db.insert("campaigns", { id, brand_id: brandId, ...row, created_at: now() });
  }
  return dto(db.get("SELECT * FROM campaigns WHERE id = ?", id));
}
