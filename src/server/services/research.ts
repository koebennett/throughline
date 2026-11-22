// Research Desk: sources, evidence (fact vs inference vs hypothesis), URL import, and research runs.
import { EvidenceInput, SourceInput, type ResearchSynthesis } from "../../shared/schemas.js";
import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, notFound } from "../lib/errors.js";
import { extractPage, safeFetch, UnsafeUrlError, validatePublicUrl } from "../lib/safeFetch.js";
import { truncate } from "../lib/text.js";
import { audit } from "./audit.js";

export function addSource(db: Db, brandId: string, input: SourceInput, researchRunId: string | null = null) {
  const s = SourceInput.parse(input);
  if (s.url) {
    try {
      validatePublicUrl(s.url);
    } catch (e) {
      throw badRequest(`Source URL rejected: ${(e as Error).message}`);
    }
    const existing = db.get("SELECT id FROM sources WHERE brand_id = ? AND url = ?", brandId, s.url);
    if (existing) return getSource(db, existing.id);
  }
  const id = newId("src");
  db.insert("sources", {
    id, brand_id: brandId, research_run_id: researchRunId, url: s.url ?? "", title: s.title, publisher: s.publisher,
    published_at: s.publishedAt, retrieved_at: s.retrievedAt || now(), provider: s.provider || "manual",
    excerpt: s.excerpt, notes: s.notes, created_at: now(),
  });
  return getSource(db, id);
}

export function getSource(db: Db, id: string) {
  const r = db.get("SELECT * FROM sources WHERE id = ?", id);
  if (!r) throw notFound("Source");
  return dto(r);
}
export function listSources(db: Db, brandId: string) {
  return dtos(db.all("SELECT s.*, (SELECT count(*) FROM evidence_items e WHERE e.source_id = s.id) AS evidence_count FROM sources s WHERE brand_id = ? ORDER BY created_at DESC", brandId));
}
export function deleteSource(db: Db, id: string) {
  const s = getSource(db, id);
  db.run("DELETE FROM sources WHERE id = ?", id);
  audit(db, { brandId: s.brandId, entityType: "source", entityId: id, action: "deleted" });
}

/** Fetch a public page safely and store it as a dated source. Page text is untrusted data. */
export async function importUrl(db: Db, brandId: string, url: string, fetcher = safeFetch) {
  let page;
  try {
    page = await fetcher(url);
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw badRequest(e.message);
    throw badRequest(`Could not fetch the page: ${(e as Error).message}`);
  }
  if (page.status >= 400) throw badRequest(`The page returned HTTP ${page.status}`);
  const meta = extractPage(page.body, page.finalUrl);
  const src = addSource(db, brandId, {
    url: page.finalUrl,
    title: meta.title,
    publisher: meta.publisher,
    publishedAt: meta.publishedAt,
    retrievedAt: now(),
    excerpt: truncate(meta.description ? `${meta.description}\n\n${meta.text}` : meta.text, 8000),
    provider: "webpage",
  });
  db.update("sources", src.id, { url_status: "ok" });
  return getSource(db, src.id);
}

export function addEvidence(db: Db, brandId: string, input: EvidenceInput, createdBy = "user") {
  const e = EvidenceInput.parse(input);
  // Deterministic honesty rule: a "fact" or "observation" must cite a source; otherwise it is downgraded.
  let kind = e.kind;
  let auditNote = "";
  if ((kind === "fact" || kind === "observation") && !e.sourceId) {
    kind = "inference";
    auditNote = `Downgraded from "${e.kind}" to "inference": no source attached.`;
  }
  if (e.sourceId) getSource(db, e.sourceId);
  const id = newId("evd");
  db.insert("evidence_items", {
    id, brand_id: brandId, research_run_id: e.researchRunId ?? null, source_id: e.sourceId ?? null, claim: e.claim, kind,
    confidence: e.confidence, topic: e.topic, quote: e.quote, audit_note: auditNote, created_by: createdBy, created_at: now(),
  });
  return getEvidence(db, id);
}

export function getEvidence(db: Db, id: string) {
  const r = db.get(
    "SELECT e.*, s.url AS source_url, s.title AS source_title, s.publisher AS source_publisher, s.published_at AS source_published_at, s.retrieved_at AS source_retrieved_at FROM evidence_items e LEFT JOIN sources s ON s.id = e.source_id WHERE e.id = ?",
    id,
  );
  if (!r) throw notFound("Evidence");
  return dto(r);
}

export function listEvidence(db: Db, brandId: string, opts: { researchRunId?: string; topic?: string } = {}) {
  const where = ["e.brand_id = ?"];
  const p: string[] = [brandId];
  if (opts.researchRunId) (where.push("e.research_run_id = ?"), p.push(opts.researchRunId));
  if (opts.topic) (where.push("e.topic LIKE ?"), p.push(`%${opts.topic}%`));
  return dtos(
    db.all(
      `SELECT e.*, s.url AS source_url, s.title AS source_title, s.publisher AS source_publisher, s.published_at AS source_published_at, s.retrieved_at AS source_retrieved_at
         FROM evidence_items e LEFT JOIN sources s ON s.id = e.source_id WHERE ${where.join(" AND ")} ORDER BY e.created_at DESC`,
      ...p,
    ),
  );
}

export function updateEvidence(db: Db, id: string, patch: Partial<EvidenceInput>) {
  const cur = getEvidence(db, id);
  const merged = EvidenceInput.parse({ ...cur, ...patch });
  let kind = merged.kind;
  let note = cur.auditNote ?? "";
  if ((kind === "fact" || kind === "observation") && !merged.sourceId) {
    kind = "inference";
    note = `Downgraded from "${merged.kind}" to "inference": no source attached.`;
  }
  db.update("evidence_items", id, { claim: merged.claim, kind, confidence: merged.confidence, topic: merged.topic, source_id: merged.sourceId ?? null, quote: merged.quote, audit_note: note });
  return getEvidence(db, id);
}
export function deleteEvidence(db: Db, id: string) {
  const e = getEvidence(db, id);
  db.run("DELETE FROM evidence_items WHERE id = ?", id);
  audit(db, { brandId: e.brandId, entityType: "evidence", entityId: id, action: "deleted" });
}

export function createResearchRun(db: Db, brandId: string, topic: string, question: string, provider: string, agentRunId?: string) {
  const id = newId("rr");
  db.insert("research_runs", { id, brand_id: brandId, topic, question, provider, status: "running", agent_run_id: agentRunId ?? null, created_at: now(), updated_at: now() });
  return id;
}
export function completeResearchRun(db: Db, id: string, synthesis: ResearchSynthesis | null, status = "complete") {
  db.update("research_runs", id, { synthesis_json: synthesis, status, updated_at: now() });
}
export function listResearchRuns(db: Db, brandId: string) {
  return dtos(
    db.all(
      "SELECT r.*, (SELECT count(*) FROM evidence_items e WHERE e.research_run_id = r.id) AS evidence_count, (SELECT count(*) FROM sources s WHERE s.research_run_id = r.id) AS source_count FROM research_runs r WHERE brand_id = ? ORDER BY created_at DESC",
      brandId,
    ),
  );
}
export function getResearchRun(db: Db, id: string) {
  const r = db.get("SELECT * FROM research_runs WHERE id = ?", id);
  if (!r) throw notFound("Research run");
  return { ...dto(r), evidence: listEvidence(db, r.brand_id, { researchRunId: id }), sources: dtos(db.all("SELECT * FROM sources WHERE research_run_id = ?", id)) };
}

/**
 * Evidence audit (deterministic): drop evidence citing a source that doesn't exist, downgrade uncited facts,
 * flag missing/old publication dates. Returns human-readable audit notes.
 */
export function auditSynthesis(
  synthesis: ResearchSynthesis,
  sources: { url: string; title: string; publishedAt?: string | null }[],
  today = new Date(),
): { synthesis: ResearchSynthesis; notes: string[] } {
  const notes: string[] = [];
  const evidence = synthesis.evidence.flatMap((e) => {
    if (e.sourceIndex !== null && (e.sourceIndex < 0 || e.sourceIndex >= sources.length)) {
      notes.push(`Removed claim citing non-existent source #${e.sourceIndex}: "${truncate(e.claim, 80)}"`);
      return [];
    }
    if ((e.kind === "fact" || e.kind === "observation") && e.sourceIndex === null) {
      notes.push(`Downgraded uncited ${e.kind} to inference: "${truncate(e.claim, 80)}"`);
      return [{ ...e, kind: "inference" as const, confidence: "low" as const }];
    }
    if (e.sourceIndex !== null) {
      const src = sources[e.sourceIndex];
      const d = src.publishedAt ? new Date(src.publishedAt) : null;
      if (!d || isNaN(d.getTime())) notes.push(`Source "${truncate(src.title, 60)}" has no reliable publication date — treat recency claims cautiously.`);
      else if ((today.getTime() - d.getTime()) / 86400000 > 730) notes.push(`Source "${truncate(src.title, 60)}" is over two years old.`);
    }
    return [e];
  });
  return { synthesis: { ...synthesis, evidence }, notes: [...new Set(notes)] };
}
