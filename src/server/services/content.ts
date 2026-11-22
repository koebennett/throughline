// Briefs, content items, immutable variants, QA records, approvals and status transitions.
// Approval is bound to a specific variant: any edit creates a new variant and invalidates approval.
import { BriefData, DraftFields, Format, Platform } from "../../shared/schemas.js";
import { canTransition, REQUIRES_APPROVAL, type ContentStatus } from "../../shared/status.js";
import type { Db } from "../db/db.js";
import { newId, now, parseJson } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "./audit.js";
import type { QaCheck, QaResult } from "./qa.js";
import { publishableText } from "./qa.js";

export const EMPTY_FIELDS: DraftFields = {
  titleOptions: [], hooks: [], body: "", caption: "", description: "", chapters: [], slides: [], beats: [], hashtags: [], cta: "",
  thumbnailConcepts: [], visualPrompts: [], pinnedComment: "", seoTitle: "", metaDescription: "", productionNotes: "", targetLength: "", claimsToVerify: [],
};
export const normaliseFields = (f: Partial<DraftFields>): DraftFields => DraftFields.parse({ ...EMPTY_FIELDS, ...f });

// ---------------- Briefs ----------------
export function createBrief(db: Db, brandId: string, data: BriefData, opts: { ideaId?: string | null; generatedBy?: string } = {}) {
  const b = BriefData.parse(data);
  const id = newId("brief");
  const ts = now();
  db.tx(() => {
    db.insert("briefs", { id, brand_id: brandId, idea_id: opts.ideaId ?? null, title: b.workingTitle, data_json: b, status: "draft", version: 1, generated_by: opts.generatedBy ?? "user", created_at: ts, updated_at: ts });
    db.insert("brief_revisions", { id: newId("brev"), brief_id: id, version: 1, data_json: b, created_at: ts });
    if (opts.ideaId) {
      const idea = db.get("SELECT status FROM ideas WHERE id = ?", opts.ideaId);
      if (idea && ["IDEA", "RESEARCHED"].includes(idea.status)) {
        db.update("ideas", opts.ideaId, { status: "BRIEF", updated_at: ts });
        audit(db, { brandId, entityType: "idea", entityId: opts.ideaId, action: "status_changed", from: idea.status, to: "BRIEF" });
      }
    }
    audit(db, { brandId, entityType: "brief", entityId: id, action: "created", detail: { generatedBy: opts.generatedBy ?? "user" } });
  });
  return getBrief(db, id);
}
export function getBrief(db: Db, id: string) {
  const r = db.get("SELECT b.*, i.title AS idea_title FROM briefs b LEFT JOIN ideas i ON i.id = b.idea_id WHERE b.id = ?", id);
  if (!r) throw notFound("Brief");
  return { ...dto(r), revisions: db.all("SELECT version, created_at FROM brief_revisions WHERE brief_id = ? ORDER BY version DESC", id) };
}
export function listBriefs(db: Db, brandId: string) {
  return dtos(db.all("SELECT b.id, b.title, b.status, b.version, b.generated_by, b.idea_id, b.created_at, b.updated_at, (SELECT count(*) FROM content_items c WHERE c.brief_id = b.id) AS content_count FROM briefs b WHERE brand_id = ? ORDER BY updated_at DESC", brandId));
}
export function updateBrief(db: Db, id: string, data: BriefData) {
  const cur = getBrief(db, id);
  const b = BriefData.parse(data);
  const version = cur.version + 1;
  db.tx(() => {
    db.update("briefs", id, { data_json: b, title: b.workingTitle, version, status: "draft", updated_at: now() });
    db.insert("brief_revisions", { id: newId("brev"), brief_id: id, version, data_json: b, created_at: now() });
  });
  return getBrief(db, id);
}
export function setBriefStatus(db: Db, id: string, status: "draft" | "approved") {
  const cur = getBrief(db, id);
  db.update("briefs", id, { status, updated_at: now() });
  audit(db, { brandId: cur.brandId, entityType: "brief", entityId: id, action: status === "approved" ? "approved" : "reopened", from: cur.status, to: status });
  return getBrief(db, id);
}
export function briefRevision(db: Db, id: string, version: number) {
  const r = db.get("SELECT * FROM brief_revisions WHERE brief_id = ? AND version = ?", id, version);
  if (!r) throw notFound("Brief revision");
  return { version: r.version, createdAt: r.created_at, data: parseJson(r.data_json, {}) };
}

// ---------------- Content items & variants ----------------
export function createContentItem(
  db: Db,
  brandId: string,
  input: { title: string; platform: Platform; format: Format; briefId?: string | null; ideaId?: string | null; campaignId?: string | null; timezone?: string },
  firstVariant?: { fields: Partial<DraftFields>; angleLabel?: string; rationale?: string; generatedBy: string },
) {
  const platform = Platform.parse(input.platform);
  const format = Format.parse(input.format);
  const id = newId("ci");
  const ts = now();
  db.tx(() => {
    db.insert("content_items", {
      id, brand_id: brandId, brief_id: input.briefId ?? null, idea_id: input.ideaId ?? null, campaign_id: input.campaignId ?? null,
      title: input.title.slice(0, 300), platform, format, status: "DRAFT", timezone: input.timezone ?? "UTC", created_at: ts, updated_at: ts,
    });
    audit(db, { brandId, entityType: "content", entityId: id, action: "created", to: "DRAFT", detail: { platform, format } });
    if (firstVariant) addVariantInTx(db, id, firstVariant);
  });
  return getContentItem(db, id);
}

function addVariantInTx(db: Db, itemId: string, v: { fields: Partial<DraftFields>; angleLabel?: string; rationale?: string; generatedBy: string; parentVariantId?: string | null; feedback?: string }) {
  const version = (db.get<{ v: number }>("SELECT max(version) AS v FROM content_variants WHERE content_item_id = ?", itemId)?.v ?? 0) + 1;
  const vid = newId("var");
  db.insert("content_variants", {
    id: vid, content_item_id: itemId, version, angle_label: (v.angleLabel ?? "").slice(0, 200), fields_json: normaliseFields(v.fields),
    rationale: v.rationale ?? "", generated_by: v.generatedBy, parent_variant_id: v.parentVariantId ?? null, feedback: v.feedback ?? "", created_at: now(),
  });
  const item = db.get("SELECT * FROM content_items WHERE id = ?", itemId)!;
  const patch: Record<string, unknown> = { current_variant_id: vid, updated_at: now() };
  // Editing approved/scheduled content invalidates the approval.
  if (["APPROVED", "SCHEDULED", "QA", "REVIEW"].includes(item.status)) {
    patch.status = "DRAFT";
    audit(db, { brandId: item.brand_id, entityType: "content", entityId: itemId, action: "status_changed", from: item.status, to: "DRAFT", detail: { reason: "New variant created; previous QA/approval no longer applies." }, actor: "system" });
  }
  db.update("content_items", itemId, patch);
  return vid;
}

export function addVariant(db: Db, itemId: string, v: Parameters<typeof addVariantInTx>[2]) {
  getContentItem(db, itemId);
  return db.tx(() => addVariantInTx(db, itemId, v));
}

export function setCurrentVariant(db: Db, itemId: string, variantId: string) {
  const item = getContentItem(db, itemId);
  if (!item.variants.some((v: any) => v.id === variantId)) throw notFound("Variant");
  db.tx(() => {
    const patch: Record<string, unknown> = { current_variant_id: variantId, updated_at: now() };
    if (["APPROVED", "SCHEDULED", "QA", "REVIEW"].includes(item.status) && item.currentVariantId !== variantId) {
      patch.status = "DRAFT";
      audit(db, { brandId: item.brandId, entityType: "content", entityId: itemId, action: "status_changed", from: item.status, to: "DRAFT", detail: { reason: "Switched variant" }, actor: "system" });
    }
    db.update("content_items", itemId, patch);
  });
  return getContentItem(db, itemId);
}

export function getContentItem(db: Db, id: string) {
  const r = db.get("SELECT c.*, b.title AS brief_title, camp.name AS campaign_name FROM content_items c LEFT JOIN briefs b ON b.id = c.brief_id LEFT JOIN campaigns camp ON camp.id = c.campaign_id WHERE c.id = ?", id);
  if (!r) throw notFound("Content item");
  const variants = dtos(db.all("SELECT * FROM content_variants WHERE content_item_id = ? ORDER BY version DESC", id));
  const reviews = db.all("SELECT * FROM qa_reviews WHERE content_item_id = ? ORDER BY created_at DESC, rowid DESC", id).map(qaDto);
  const approvals = dtos(db.all("SELECT * FROM approvals WHERE content_item_id = ? ORDER BY created_at DESC", id));
  const lineage = dtos(db.all("SELECT l.*, a.title AS asset_title, a.rights AS asset_rights, s.title AS source_content_title FROM content_lineage l LEFT JOIN assets a ON a.id = l.source_asset_id LEFT JOIN content_items s ON s.id = l.source_content_item_id WHERE l.derivative_content_item_id = ?", id));
  const calendar = dtos(db.all("SELECT * FROM calendar_entries WHERE content_item_id = ? ORDER BY scheduled_at", id));
  const history = dtos(db.all("SELECT action, from_state, to_state, actor, detail_json, created_at FROM audit_events WHERE entity_type = 'content' AND entity_id = ? ORDER BY created_at DESC, rowid DESC", id));
  return { ...dto(r), variants, reviews, approvals, lineage, calendar, history };
}

export function listContent(db: Db, brandId: string, f: { status?: string; platform?: string; campaignId?: string } = {}) {
  const where = ["c.brand_id = ?"];
  const p: string[] = [brandId];
  if (f.status) {
    where.push("c.status = ?");
    p.push(f.status);
  }
  if (f.platform) {
    where.push("c.platform = ?");
    p.push(f.platform);
  }
  if (f.campaignId) {
    where.push("c.campaign_id = ?");
    p.push(f.campaignId);
  }
  return dtos(
    db.all(
      `SELECT c.*, (SELECT count(*) FROM content_variants v WHERE v.content_item_id = c.id) AS variant_count,
              (SELECT score FROM qa_reviews q WHERE q.content_item_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_qa_score,
              (SELECT passed FROM qa_reviews q WHERE q.content_item_id = c.id AND q.variant_id = c.current_variant_id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS current_qa_passed,
              (SELECT min(scheduled_at) FROM calendar_entries e WHERE e.content_item_id = c.id) AS planned_at
         FROM content_items c WHERE ${where.join(" AND ")} ORDER BY c.updated_at DESC LIMIT 500`,
      ...p,
    ),
  );
}

export function libraryCorpus(db: Db, brandId: string, excludeItemId: string) {
  return db
    .all<{ id: string; fields_json: string }>(
      "SELECT v.id, v.fields_json FROM content_items c JOIN content_variants v ON v.id = c.current_variant_id WHERE c.brand_id = ? AND c.id != ? AND c.status != 'ARCHIVED'",
      brandId, excludeItemId,
    )
    .map((r) => ({ id: r.id, text: publishableText(normaliseFields(parseJson(r.fields_json, {}))) }));
}

// ---------------- QA records ----------------
export interface QaReviewDto {
  id: string;
  contentItemId: string;
  variantId: string;
  score: number;
  dimensions: unknown;
  checks: QaCheck[];
  acknowledged: { checkId: string; note: string; at: string }[];
  blockers: number;
  warnings: number;
  passed: boolean;
  method: string;
  createdAt: string;
}
function qaDto(r: any): QaReviewDto {
  const d = dto(r);
  return { ...d, checks: (d.checks ?? []) as QaCheck[], acknowledged: (d.acknowledged ?? []) as QaReviewDto["acknowledged"] };
}

export function saveQaReview(db: Db, itemId: string, variantId: string, result: QaResult) {
  const item = getContentItem(db, itemId);
  const id = newId("qa");
  db.tx(() => {
    db.insert("qa_reviews", {
      id, content_item_id: itemId, variant_id: variantId, score: result.score, dimensions_json: result.dimensions, checks_json: result.checks,
      blockers: result.blockers, warnings: result.warnings, passed: result.passed ? 1 : 0, method: result.method, created_at: now(),
    });
    if (variantId === item.currentVariantId && ["DRAFT", "QA", "REVIEW"].includes(item.status)) {
      const to: ContentStatus = result.passed ? "REVIEW" : "QA";
      if (item.status !== to) {
        db.update("content_items", itemId, { status: to, updated_at: now() });
        audit(db, { brandId: item.brandId, entityType: "content", entityId: itemId, action: "status_changed", from: item.status, to, detail: { qaReviewId: id, score: result.score, blockers: result.blockers }, actor: "system" });
      }
    }
  });
  return qaDto(db.get("SELECT * FROM qa_reviews WHERE id = ?", id));
}

/** Model-raised blockers may be overridden with a written reason. Rule blockers cannot. */
export function overrideCheck(db: Db, reviewId: string, checkId: string, note: string) {
  const r = db.get("SELECT * FROM qa_reviews WHERE id = ?", reviewId);
  if (!r) throw notFound("QA review");
  const review = qaDto(r);
  const check = review.checks.find((c) => c.id === checkId);
  if (!check) throw notFound("QA check");
  if (!check.overridable) throw forbidden("Rule-based blockers cannot be overridden — fix the draft and re-run QA.");
  if (note.trim().length < 5) throw badRequest("Give a short reason for the override.");
  const acknowledged = [...review.acknowledged.filter((a) => a.checkId !== checkId), { checkId, note: note.slice(0, 1000), at: now() }];
  const openBlockers = review.checks.filter((c) => c.status === "block" && !acknowledged.some((a) => a.checkId === c.id)).length;
  db.tx(() => {
    db.update("qa_reviews", reviewId, { acknowledged_json: acknowledged, passed: openBlockers === 0 ? 1 : 0 });
    audit(db, { entityType: "qa_review", entityId: reviewId, action: "check_overridden", detail: { checkId, note }, brandId: db.get("SELECT brand_id FROM content_items WHERE id = ?", review.contentItemId)?.brand_id });
    const item = getContentItem(db, review.contentItemId);
    if (openBlockers === 0 && item.status === "QA" && item.currentVariantId === review.variantId) {
      db.update("content_items", item.id, { status: "REVIEW", updated_at: now() });
      audit(db, { brandId: item.brandId, entityType: "content", entityId: item.id, action: "status_changed", from: "QA", to: "REVIEW", actor: "system" });
    }
  });
  return qaDto(db.get("SELECT * FROM qa_reviews WHERE id = ?", reviewId));
}

// ---------------- Approval & transitions (deterministic gate) ----------------
export function latestReviewFor(db: Db, itemId: string, variantId: string) {
  const r = db.get("SELECT * FROM qa_reviews WHERE content_item_id = ? AND variant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", itemId, variantId);
  return r ? qaDto(r) : null;
}

export function assertApprovable(db: Db, itemId: string) {
  const item = getContentItem(db, itemId);
  if (!item.currentVariantId) throw conflict("No draft variant to approve.");
  const review = latestReviewFor(db, itemId, item.currentVariantId);
  if (!review) throw conflict("Run QA on the current variant before approving.");
  if (!review.passed) throw conflict("QA has unresolved hard blockers on the current variant.", review.checks.filter((c) => c.status === "block"));
  return { item, review };
}

export function approve(db: Db, itemId: string, note = "", decision: "approved" | "changes_requested" = "approved") {
  const item = getContentItem(db, itemId);
  if (decision === "changes_requested") {
    db.tx(() => {
      db.insert("approvals", { id: newId("appr"), content_item_id: itemId, variant_id: item.currentVariantId ?? "", qa_review_id: "", decision, note, created_at: now() });
      if (item.status !== "DRAFT") db.update("content_items", itemId, { status: "DRAFT", updated_at: now() });
      audit(db, { brandId: item.brandId, entityType: "content", entityId: itemId, action: "changes_requested", from: item.status, to: "DRAFT", detail: { note } });
    });
    return getContentItem(db, itemId);
  }
  const { review } = assertApprovable(db, itemId);
  if (item.status !== "REVIEW") throw conflict(`Content must be in REVIEW to approve (currently ${item.status}).`);
  db.tx(() => {
    db.insert("approvals", { id: newId("appr"), content_item_id: itemId, variant_id: item.currentVariantId, qa_review_id: review.id, decision, note, created_at: now() });
    db.update("content_items", itemId, { status: "APPROVED", updated_at: now() });
    audit(db, { brandId: item.brandId, entityType: "content", entityId: itemId, action: "approved", from: "REVIEW", to: "APPROVED", detail: { variantId: item.currentVariantId, qaReviewId: review.id, qaScore: review.score, note } });
  });
  return getContentItem(db, itemId);
}

export function currentApproval(db: Db, itemId: string) {
  const item = getContentItem(db, itemId);
  return db.get("SELECT * FROM approvals WHERE content_item_id = ? AND variant_id = ? AND decision = 'approved' ORDER BY created_at DESC LIMIT 1", itemId, item.currentVariantId ?? "") ?? null;
}

export function transition(db: Db, itemId: string, to: ContentStatus, detail: Record<string, unknown> = {}) {
  const item = getContentItem(db, itemId);
  const from = item.status as ContentStatus;
  if (from === to) return item;
  if (to === "APPROVED") return approve(db, itemId, String(detail.note ?? ""));
  if (!canTransition(from, to)) throw conflict(`Cannot move from ${from} to ${to}.`);
  if (REQUIRES_APPROVAL.includes(to) && !currentApproval(db, itemId)) throw forbidden("This content's current variant has not been approved.");
  if (to === "QA" || to === "REVIEW") throw badRequest("QA/REVIEW states are set by running QA.");
  if (to === "PUBLISHED" && !detail.publishedUrl && !detail.viaConnector) throw badRequest("Record the published URL when marking content as published manually.");
  db.tx(() => {
    const patch: Record<string, unknown> = { status: to, updated_at: now() };
    if (to === "PUBLISHED" && detail.publishedUrl) patch.published_url = String(detail.publishedUrl).slice(0, 2000);
    if (to === "SCHEDULED" && detail.scheduledAt) patch.scheduled_at = String(detail.scheduledAt);
    db.update("content_items", itemId, patch);
    audit(db, { brandId: item.brandId, entityType: "content", entityId: itemId, action: "status_changed", from, to, detail });
  });
  return getContentItem(db, itemId);
}

export function updateContentMeta(db: Db, itemId: string, patch: { title?: string; campaignId?: string | null; timezone?: string }) {
  getContentItem(db, itemId);
  const row: Record<string, unknown> = { updated_at: now() };
  if (patch.title !== undefined) row.title = patch.title.slice(0, 300);
  if (patch.campaignId !== undefined) row.campaign_id = patch.campaignId;
  if (patch.timezone !== undefined) row.timezone = patch.timezone.slice(0, 64);
  db.update("content_items", itemId, row);
  return getContentItem(db, itemId);
}
