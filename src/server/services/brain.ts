// Brand Brain: owned documents + memory items, with cheap, citable full-text retrieval (FTS5/BM25).
// Embeddings can be added behind `retrieve()` later without changing callers.
import { z } from "zod";
import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import { chunkText, similarity, tokens, truncate } from "../lib/text.js";
import { notFound } from "../lib/errors.js";
import { dto, dtos } from "../lib/rows.js";
import { audit } from "./audit.js";

export const DocumentInput = z.object({
  title: z.string().min(1).max(300),
  kind: z.enum(["doc", "transcript", "script", "content_export", "offer", "note", "webpage"]).default("doc"),
  sourceRef: z.string().max(2000).optional().default(""),
  content: z.string().min(1).max(500_000),
});

export function addDocument(db: Db, brandId: string, input: z.input<typeof DocumentInput>) {
  const d = DocumentInput.parse(input);
  const id = newId("doc");
  const ts = now();
  db.tx(() => {
    db.insert("documents", { id, brand_id: brandId, title: d.title, kind: d.kind, source_ref: d.sourceRef, content: d.content, created_at: ts, updated_at: ts });
    indexDocument(db, brandId, id, d.content);
    audit(db, { brandId, entityType: "document", entityId: id, action: "added", detail: { title: d.title, kind: d.kind, chars: d.content.length } });
  });
  return getDocument(db, id);
}

function indexDocument(db: Db, brandId: string, docId: string, content: string) {
  const old = db.all<{ id: string }>("SELECT id FROM doc_chunks WHERE document_id = ?", docId);
  for (const c of old) db.run("DELETE FROM chunks_fts WHERE chunk_id = ?", c.id);
  db.run("DELETE FROM doc_chunks WHERE document_id = ?", docId);
  chunkText(content).forEach((c, ord) => {
    const cid = newId("chk");
    db.insert("doc_chunks", { id: cid, document_id: docId, brand_id: brandId, ord, heading: c.heading, text: c.text });
    db.run("INSERT INTO chunks_fts (text, heading, chunk_id, brand_id) VALUES (?, ?, ?, ?)", c.text, c.heading, cid, brandId);
  });
}

export function listDocuments(db: Db, brandId: string) {
  return dtos(
    db.all(
      "SELECT d.id, d.title, d.kind, d.source_ref, d.excluded, d.created_at, d.updated_at, length(d.content) AS chars, (SELECT count(*) FROM doc_chunks c WHERE c.document_id = d.id) AS chunks FROM documents d WHERE brand_id = ? ORDER BY created_at DESC",
      brandId,
    ),
  );
}

export function getDocument(db: Db, id: string) {
  const d = db.get("SELECT * FROM documents WHERE id = ?", id);
  if (!d) throw notFound("Document");
  return dto(d);
}

export function updateDocument(db: Db, id: string, patch: { title?: string; content?: string; excluded?: boolean }) {
  const d = getDocument(db, id);
  db.tx(() => {
    db.update("documents", id, {
      ...(patch.title !== undefined ? { title: patch.title.slice(0, 300) } : {}),
      ...(patch.content !== undefined ? { content: patch.content.slice(0, 500_000) } : {}),
      ...(patch.excluded !== undefined ? { excluded: patch.excluded ? 1 : 0 } : {}),
      updated_at: now(),
    });
    if (patch.content !== undefined) indexDocument(db, d.brandId, id, patch.content);
    audit(db, { brandId: d.brandId, entityType: "document", entityId: id, action: patch.excluded !== undefined ? (patch.excluded ? "excluded" : "included") : "edited" });
  });
  return getDocument(db, id);
}

export function deleteDocument(db: Db, id: string) {
  const d = getDocument(db, id);
  db.tx(() => {
    for (const c of db.all<{ id: string }>("SELECT id FROM doc_chunks WHERE document_id = ?", id)) db.run("DELETE FROM chunks_fts WHERE chunk_id = ?", c.id);
    db.run("DELETE FROM documents WHERE id = ?", id);
    audit(db, { brandId: d.brandId, entityType: "document", entityId: id, action: "deleted", detail: { title: d.title } });
  });
}

export interface Snippet {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  heading: string;
  text: string;
  citation: string; // e.g. "Offer sheet › Pricing"
  rank: number;
}

/** BM25 full-text retrieval over non-excluded documents of one brand. */
export function retrieve(db: Db, brandId: string, query: string, k = 6): Snippet[] {
  const terms = [...new Set(tokens(query))].slice(0, 24);
  if (!terms.length) return [];
  const match = terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
  const rows = db.all(
    `SELECT f.chunk_id, bm25(chunks_fts) AS rank, c.text, c.heading, c.document_id, d.title
       FROM chunks_fts f JOIN doc_chunks c ON c.id = f.chunk_id JOIN documents d ON d.id = c.document_id
      WHERE chunks_fts MATCH ? AND f.brand_id = ? AND d.excluded = 0
      ORDER BY rank LIMIT ?`,
    match, brandId, k,
  );
  return rows.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.title,
    heading: r.heading,
    text: truncate(r.text, 1200),
    citation: r.heading ? `${r.title} › ${r.heading}` : r.title,
    rank: r.rank,
  }));
}

// ---------------- Memory ----------------
export const MemoryInput = z.object({
  layer: z.enum(["brand", "project", "content", "research", "preference"]),
  statement: z.string().min(3).max(1000),
  sourceType: z.enum(["user", "analytics", "research", "agent"]).default("user"),
  sourceRef: z.string().max(500).optional().default(""),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  status: z.enum(["proposed", "approved", "rejected"]).optional(),
});

/** Agent/analytics-proposed memories start as "proposed" and never become brand truth without user approval. */
export function addMemory(db: Db, brandId: string, input: z.input<typeof MemoryInput>) {
  const m = MemoryInput.parse(input);
  const status = m.status ?? (m.sourceType === "user" ? "approved" : "proposed");
  const existing = db.all<{ id: string; statement: string }>("SELECT id, statement FROM memory_items WHERE brand_id = ? AND status != 'rejected'", brandId);
  const dup = existing.find((e) => similarity(e.statement, m.statement) > 0.8);
  if (dup) return { ...getMemory(db, dup.id), deduplicated: true };
  // Possible contradiction: same subject words but a negation flip. Flag it, never silently merge.
  const conflict = existing.find((e) => similarity(e.statement, m.statement) > 0.45 && hasNegation(e.statement) !== hasNegation(m.statement));
  const id = newId("mem");
  const ts = now();
  db.insert("memory_items", {
    id, brand_id: brandId, layer: m.layer, statement: m.statement, source_type: m.sourceType, source_ref: m.sourceRef,
    confidence: m.confidence, status, conflicts_with: conflict?.id ?? null, created_at: ts, updated_at: ts,
  });
  audit(db, { brandId, entityType: "memory", entityId: id, action: "added", detail: { status, sourceType: m.sourceType }, actor: m.sourceType === "user" ? "user" : "agent" });
  return getMemory(db, id);
}
const hasNegation = (s: string) => /\b(not|never|no|don't|doesn't|avoid|stop|worse|underperform)/i.test(s);

export function getMemory(db: Db, id: string) {
  const r = db.get("SELECT * FROM memory_items WHERE id = ?", id);
  if (!r) throw notFound("Memory item");
  return dto(r);
}
export function listMemory(db: Db, brandId: string) {
  return dtos(db.all("SELECT * FROM memory_items WHERE brand_id = ? ORDER BY status = 'proposed' DESC, updated_at DESC", brandId));
}
export function updateMemory(db: Db, id: string, patch: { statement?: string; status?: "proposed" | "approved" | "rejected"; confidence?: string }) {
  const m = getMemory(db, id);
  db.update("memory_items", id, { ...patch, updated_at: now() });
  audit(db, { brandId: m.brandId, entityType: "memory", entityId: id, action: "updated", from: m.status, to: patch.status ?? m.status });
  return getMemory(db, id);
}
export function deleteMemory(db: Db, id: string) {
  const m = getMemory(db, id);
  db.run("DELETE FROM memory_items WHERE id = ?", id);
  audit(db, { brandId: m.brandId, entityType: "memory", entityId: id, action: "deleted" });
}
export function approvedMemory(db: Db, brandId: string, limit = 25) {
  return db.all<{ statement: string; layer: string; source_type: string; confidence: string }>(
    "SELECT statement, layer, source_type, confidence FROM memory_items WHERE brand_id = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT ?",
    brandId, limit,
  );
}
