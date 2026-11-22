import { IdeaInput, OPPORTUNITY_DIMENSIONS, type OpportunityDimension, type OpportunityRatings } from "../../shared/schemas.js";
import { scoreOpportunity } from "../../shared/scoring.js";
import type { Db } from "../db/db.js";
import { newId, now, parseJson } from "../db/db.js";
import { dto } from "../lib/rows.js";
import { notFound } from "../lib/errors.js";
import { findNearDuplicates } from "../lib/text.js";
import { audit } from "./audit.js";
import type { Settings } from "./settings.js";

/** Corpus the brand already has: other ideas + content titles. Used for near-duplicate detection. */
function corpus(db: Db, brandId: string, excludeId?: string) {
  const ideas = db.all<{ id: string; text: string }>("SELECT id, title || ' ' || angle AS text FROM ideas WHERE brand_id = ? AND id != ? AND status != 'ARCHIVED'", brandId, excludeId ?? "");
  const content = db.all<{ id: string; text: string }>("SELECT id, title AS text FROM content_items WHERE brand_id = ?", brandId);
  const analytics = db.all<{ id: string; text: string }>("SELECT id, title AS text FROM analytics_snapshots WHERE brand_id = ? AND title != ''", brandId);
  return [...ideas, ...content, ...analytics];
}

export function scoreIdeaRow(row: { ratings_json: string; rating_reasons_json: string; evidence_ids_json: string }, weights: Settings["opportunityWeights"]) {
  const ratings = parseJson<Partial<OpportunityRatings>>(row.ratings_json, {});
  const evidence = parseJson<string[]>(row.evidence_ids_json, []);
  // Deterministic: with no linked evidence and no explicit rating, demand evidence is unknown (penalised).
  if (ratings.demandEvidence === undefined || ratings.demandEvidence === null) ratings.demandEvidence = evidence.length ? Math.min(5, 2 + evidence.length) : null;
  return scoreOpportunity(ratings, weights as Record<OpportunityDimension, number>, parseJson(row.rating_reasons_json, {}));
}

export function createIdea(db: Db, brandId: string, input: IdeaInput, settings: Settings, actor = "user") {
  const i = IdeaInput.parse(input);
  const id = newId("idea");
  const ts = now();
  const dups = findNearDuplicates(`${i.title} ${i.angle}`, corpus(db, brandId), 0.55);
  const ratings: Record<string, number | null> = {};
  for (const d of OPPORTUNITY_DIMENSIONS) ratings[d] = i.ratings?.[d] ?? null;
  const row = {
    id, brand_id: brandId, title: i.title, angle: i.angle, rationale: i.rationale, pillar_id: i.pillarId ?? null, series_id: i.seriesId ?? null,
    campaign_id: i.campaignId ?? null, audience: i.audience, platform: i.platform ?? null, format: i.format ?? null, funnel_stage: i.funnelStage ?? null,
    effort: i.effort, source: i.source, evidence_ids_json: i.evidenceIds, ratings_json: ratings, rating_reasons_json: i.ratingReasons ?? {},
    notes: i.notes, user_rating: i.userRating ?? null, duplicate_of: dups[0]?.id ?? null, duplicate_similarity: dups[0]?.similarity ?? null,
    status: "IDEA", created_at: ts, updated_at: ts,
  };
  const s = scoreIdeaRow({ ratings_json: JSON.stringify(ratings), rating_reasons_json: JSON.stringify(row.rating_reasons_json), evidence_ids_json: JSON.stringify(i.evidenceIds) }, settings.opportunityWeights);
  db.insert("ideas", { ...row, score: s.score, score_confidence: s.confidence });
  audit(db, { brandId, entityType: "idea", entityId: id, action: "created", to: "IDEA", detail: { source: i.source }, actor });
  return getIdea(db, id, settings);
}

export function getIdea(db: Db, id: string, settings: Settings) {
  const r = db.get(
    "SELECT i.*, p.name AS pillar_name, s.name AS series_name, d.title AS duplicate_title FROM ideas i LEFT JOIN pillars p ON p.id = i.pillar_id LEFT JOIN series s ON s.id = i.series_id LEFT JOIN ideas d ON d.id = i.duplicate_of WHERE i.id = ?",
    id,
  );
  if (!r) throw notFound("Idea");
  return { ...dto(r), scoring: scoreIdeaRow(r as any, settings.opportunityWeights), revisions: db.all("SELECT id, created_at FROM idea_revisions WHERE idea_id = ? ORDER BY created_at DESC", id).length };
}

export function listIdeas(db: Db, brandId: string, settings: Settings, f: { status?: string; pillarId?: string; platform?: string; seriesId?: string } = {}) {
  const where = ["i.brand_id = ?"];
  const p: string[] = [brandId];
  if (f.status) (where.push("i.status = ?"), p.push(f.status));
  else where.push("i.status != 'ARCHIVED'");
  if (f.pillarId) (where.push("i.pillar_id = ?"), p.push(f.pillarId));
  if (f.platform) (where.push("i.platform = ?"), p.push(f.platform));
  if (f.seriesId) (where.push("i.series_id = ?"), p.push(f.seriesId));
  return db
    .all(
      `SELECT i.*, p.name AS pillar_name, s.name AS series_name, d.title AS duplicate_title FROM ideas i LEFT JOIN pillars p ON p.id = i.pillar_id LEFT JOIN series s ON s.id = i.series_id LEFT JOIN ideas d ON d.id = i.duplicate_of
        WHERE ${where.join(" AND ")} ORDER BY i.created_at DESC LIMIT 500`,
      ...p,
    )
    .map((r) => ({ ...dto(r), scoring: scoreIdeaRow(r as any, settings.opportunityWeights) }))
    .sort((a, b) => b.scoring.score - a.scoring.score);
}

export function updateIdea(db: Db, id: string, patch: Partial<IdeaInput> & { status?: string }, settings: Settings) {
  const cur = db.get("SELECT * FROM ideas WHERE id = ?", id);
  if (!cur) throw notFound("Idea");
  db.insert("idea_revisions", { id: newId("irev"), idea_id: id, snapshot_json: cur, created_at: now() });
  const ratings = { ...parseJson<Record<string, number | null>>(cur.ratings_json, {}), ...(patch.ratings ?? {}) };
  const reasons = { ...parseJson<Record<string, string>>(cur.rating_reasons_json, {}), ...(patch.ratingReasons ?? {}) };
  const row: Record<string, unknown> = { updated_at: now(), ratings_json: ratings, rating_reasons_json: reasons };
  const map: Record<string, string> = { title: "title", angle: "angle", rationale: "rationale", pillarId: "pillar_id", seriesId: "series_id", campaignId: "campaign_id", audience: "audience", platform: "platform", format: "format", funnelStage: "funnel_stage", effort: "effort", notes: "notes", userRating: "user_rating", status: "status" };
  for (const [k, col] of Object.entries(map)) if ((patch as any)[k] !== undefined) row[col] = (patch as any)[k];
  if (patch.evidenceIds) row.evidence_ids_json = patch.evidenceIds;
  if (patch.title || patch.angle) {
    const dups = findNearDuplicates(`${patch.title ?? cur.title} ${patch.angle ?? cur.angle}`, corpus(db, cur.brand_id, id), 0.55);
    row.duplicate_of = dups[0]?.id ?? null;
    row.duplicate_similarity = dups[0]?.similarity ?? null;
  }
  db.update("ideas", id, row);
  const updated = db.get("SELECT * FROM ideas WHERE id = ?", id)!;
  const s = scoreIdeaRow(updated as any, settings.opportunityWeights);
  db.update("ideas", id, { score: s.score, score_confidence: s.confidence });
  if (patch.status && patch.status !== cur.status) audit(db, { brandId: cur.brand_id, entityType: "idea", entityId: id, action: "status_changed", from: cur.status, to: patch.status });
  return getIdea(db, id, settings);
}

export function ideaHistory(db: Db, id: string) {
  return db.all("SELECT id, snapshot_json, created_at FROM idea_revisions WHERE idea_id = ? ORDER BY created_at DESC", id).map((r) => ({ id: r.id, createdAt: r.created_at, snapshot: dto(parseJson(r.snapshot_json, {})) }));
}

/** Re-score all ideas after weights change (scores are cached for sorting/filtering in SQL). */
export function rescoreAll(db: Db, brandId: string, settings: Settings) {
  for (const r of db.all("SELECT * FROM ideas WHERE brand_id = ?", brandId)) {
    const s = scoreIdeaRow(r as any, settings.opportunityWeights);
    db.update("ideas", r.id, { score: s.score, score_confidence: s.confidence });
  }
}
