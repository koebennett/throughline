// Calendar / campaign planner. Planned dates can exist for drafts; SCHEDULED status still requires approval.
import { z } from "zod";
import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, notFound } from "../lib/errors.js";
import { toCsv } from "../lib/csv.js";
import { toIcs } from "../lib/ics.js";
import { audit } from "./audit.js";
import { analyze } from "./analytics.js";

export const CalendarInput = z.object({
  contentItemId: z.string().nullable().optional(),
  title: z.string().max(300).optional(),
  platform: z.string().max(40).optional().default(""),
  scheduledAt: z.string().refine((s) => !isNaN(new Date(s).getTime()), "Invalid date"),
  timezone: z.string().max(64).optional().default("UTC"),
  notes: z.string().max(2000).optional().default(""),
  suggestionBasis: z.enum(["user", "own_history", "hypothesis"]).optional().default("user"),
});

export function addEntry(db: Db, brandId: string, input: z.input<typeof CalendarInput>) {
  const e = CalendarInput.parse(input);
  let title = e.title ?? "";
  let platform = e.platform;
  if (e.contentItemId) {
    const ci = db.get("SELECT title, platform FROM content_items WHERE id = ? AND brand_id = ?", e.contentItemId, brandId);
    if (!ci) throw notFound("Content item");
    title ||= ci.title;
    platform ||= ci.platform;
  }
  if (!title) throw badRequest("A calendar entry needs a title or a content item.");
  const id = newId("cal");
  db.insert("calendar_entries", { id, brand_id: brandId, content_item_id: e.contentItemId ?? null, title, platform, scheduled_at: new Date(e.scheduledAt).toISOString(), timezone: e.timezone, suggestion_basis: e.suggestionBasis, notes: e.notes, created_at: now(), updated_at: now() });
  audit(db, { brandId, entityType: "calendar", entityId: id, action: "planned", detail: { scheduledAt: e.scheduledAt, basis: e.suggestionBasis } });
  return getEntry(db, id);
}

export function getEntry(db: Db, id: string) {
  const r = db.get("SELECT e.*, c.status AS content_status, c.format AS content_format, c.current_variant_id FROM calendar_entries e LEFT JOIN content_items c ON c.id = e.content_item_id WHERE e.id = ?", id);
  if (!r) throw notFound("Calendar entry");
  return dto(r);
}

export function listEntries(db: Db, brandId: string, f: { from?: string; to?: string; platform?: string; status?: string; campaignId?: string } = {}) {
  const where = ["e.brand_id = ?"];
  const p: string[] = [brandId];
  if (f.from) {
    where.push("e.scheduled_at >= ?");
    p.push(f.from);
  }
  if (f.to) {
    where.push("e.scheduled_at < ?");
    p.push(f.to);
  }
  if (f.platform) {
    where.push("e.platform = ?");
    p.push(f.platform);
  }
  if (f.status) {
    where.push("c.status = ?");
    p.push(f.status);
  }
  if (f.campaignId) {
    where.push("c.campaign_id = ?");
    p.push(f.campaignId);
  }
  return dtos(
    db.all(
      `SELECT e.*, c.status AS content_status, c.format AS content_format, c.campaign_id, i.pillar_id, p.name AS pillar_name,
              (SELECT fields_json FROM content_variants v WHERE v.id = c.current_variant_id) AS preview_json
         FROM calendar_entries e LEFT JOIN content_items c ON c.id = e.content_item_id LEFT JOIN ideas i ON i.id = c.idea_id LEFT JOIN pillars p ON p.id = i.pillar_id
        WHERE ${where.join(" AND ")} ORDER BY e.scheduled_at LIMIT 1000`,
      ...p,
    ),
  ).map((e: any) => ({ ...e, preview: e.preview ? { hook: e.preview.hooks?.[0] ?? "", title: e.preview.titleOptions?.[0] ?? "", caption: (e.preview.caption || e.preview.body || "").slice(0, 280) } : null }));
}

export function moveEntry(db: Db, id: string, scheduledAt: string, timezone?: string) {
  const cur = getEntry(db, id);
  if (isNaN(new Date(scheduledAt).getTime())) throw badRequest("Invalid date");
  db.update("calendar_entries", id, { scheduled_at: new Date(scheduledAt).toISOString(), ...(timezone ? { timezone } : {}), updated_at: now() });
  if (cur.contentItemId && cur.contentStatus === "SCHEDULED") db.update("content_items", cur.contentItemId, { scheduled_at: new Date(scheduledAt).toISOString(), updated_at: now() });
  audit(db, { brandId: cur.brandId, entityType: "calendar", entityId: id, action: "rescheduled", from: cur.scheduledAt, to: scheduledAt });
  return getEntry(db, id);
}

export function updateEntry(db: Db, id: string, patch: { title?: string; notes?: string }) {
  getEntry(db, id);
  db.update("calendar_entries", id, { ...(patch.title ? { title: patch.title.slice(0, 300) } : {}), ...(patch.notes !== undefined ? { notes: patch.notes.slice(0, 2000) } : {}), updated_at: now() });
  return getEntry(db, id);
}

export function deleteEntry(db: Db, id: string) {
  const cur = getEntry(db, id);
  db.run("DELETE FROM calendar_entries WHERE id = ?", id);
  audit(db, { brandId: cur.brandId, entityType: "calendar", entityId: id, action: "removed" });
}

export function exportCsv(db: Db, brandId: string) {
  const rows = listEntries(db, brandId);
  return toCsv(
    ["scheduled_at_utc", "timezone", "platform", "title", "status", "format", "pillar", "basis", "hook", "caption_preview", "notes"],
    rows.map((e: any) => [e.scheduledAt, e.timezone, e.platform, e.title, e.contentStatus ?? "planned", e.contentFormat ?? "", e.pillarName ?? "", e.suggestionBasis, e.preview?.hook ?? "", e.preview?.caption ?? "", e.notes]),
  );
}

export function exportIcs(db: Db, brandId: string, brandName: string) {
  return toIcs(`${brandName} content calendar`, listEntries(db, brandId).map((e: any) => ({ uid: e.id, start: e.scheduledAt, summary: `[${e.platform || "content"}] ${e.title}`, description: `Status: ${e.contentStatus ?? "planned"}${e.notes ? `\n${e.notes}` : ""}` })));
}

/**
 * Suggest publish slots. Uses the brand's own imported analytics (best weekday by median primary metric)
 * when ≥5 posts exist on that platform; otherwise returns evenly spaced slots labelled as hypotheses.
 */
export function suggestSlots(db: Db, brandId: string, platform: string, count: number, startIso: string, hourLocal = 10) {
  const a = analyze(db, brandId, { platform }).platforms[0];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let preferred: number[] = [];
  let basis: "own_history" | "hypothesis" = "hypothesis";
  let rationale = "No/limited own history for this platform — evenly spaced slots. Treat as a hypothesis and adjust to your routine.";
  if (a && a.n >= 5) {
    const ranked = a.segments.weekday.filter((w) => w.n >= 2).slice(0, 3);
    if (ranked.length) {
      preferred = ranked.map((w) => days.indexOf(w.label));
      basis = "own_history";
      rationale = `Based on your ${a.n} imported ${platform} posts: ${ranked.map((w) => `${w.label} (${w.ratio}× median, n=${w.n})`).join(", ")}. Correlation, not proof.`;
    }
  }
  const slots: string[] = [];
  const d = new Date(startIso);
  d.setUTCHours(hourLocal, 0, 0, 0);
  const spacing = Math.max(1, Math.floor(7 / Math.max(1, Math.min(count, 7))));
  for (let i = 0; slots.length < count && i < 120; i++) {
    const day = new Date(d.getTime() + i * 86400000);
    if (preferred.length ? preferred.includes(day.getUTCDay()) : i % spacing === 0) slots.push(day.toISOString());
  }
  return { slots, basis, rationale };
}
