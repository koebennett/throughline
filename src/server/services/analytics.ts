// Analytics & Learning Lab: safe CSV import, own-baseline comparison, deterministic postmortems.
// Never compares unlike platform metrics directly; never invents benchmarks.
import { CSV_TEMPLATE_HEADERS, META_COLUMNS, METRICS } from "../../shared/metrics.js";
import { Platform, PLATFORMS } from "../../shared/schemas.js";
import { confidenceFromSample } from "../../shared/scoring.js";
import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import { parseCsv, toCsv } from "../lib/csv.js";
import { dto, dtos } from "../lib/rows.js";
import { badRequest, notFound } from "../lib/errors.js";
import { normalise, similarity } from "../lib/text.js";
import { audit } from "./audit.js";

export type Mapping = Record<string, string>; // csv header -> metric key | meta key | "" (ignore)

export function csvTemplate(): string {
  return toCsv(CSV_TEMPLATE_HEADERS, [
    ["example-1", "youtube", "Example: How I plan a month of videos", "https://youtube.com/watch?v=EXAMPLE", "2026-10-01", "long_video", "Planning", 5400, "", 820, 2900, 212, 41.5, 5.2, 61, 9, 4, "", 22, "", 12, "", ""],
  ]);
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");
export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {};
  for (const h of headers) {
    const n = norm(h);
    const metric = METRICS.find((x) => x.key === n || x.aliases.includes(n));
    const meta = Object.entries(META_COLUMNS).find(([k, al]) => k === n || al.includes(n));
    m[h] = metric ? metric.key : meta ? meta[0] : "";
  }
  return m;
}

/** "1,234" → 1234 ; "12.5%" → 12.5 ; "$4.20" → 4.2 ; "0:03:12" → 192 ; "" → null ; junk → NaN */
export function parseNumber(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s || s === "-" || s.toLowerCase() === "n/a") return null;
  if (/^\d{1,3}(:\d{2}){1,2}$/.test(s)) return s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
  const cleaned = s.replace(/[,\s$€£%]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function previewCsv(text: string) {
  if (text.length > 10_000_000) throw badRequest("CSV is larger than 10 MB.");
  const rows = parseCsv(text);
  if (rows.length < 2) throw badRequest("CSV needs a header row and at least one data row.");
  const headers = rows[0].map((h) => h.trim()).slice(0, 100);
  const mapping = autoMap(headers);
  const mappedMetrics = Object.values(mapping).filter((v) => METRICS.some((m) => m.key === v));
  const warnings: string[] = [];
  if (!mappedMetrics.length) warnings.push("No metric columns recognised. Map at least one column to a metric.");
  if (!Object.values(mapping).includes("title") && !Object.values(mapping).includes("post_ref")) warnings.push("No title or post id column recognised.");
  const dupHeaders = headers.filter((h, i) => headers.indexOf(h) !== i);
  if (dupHeaders.length) warnings.push(`Duplicate headers: ${[...new Set(dupHeaders)].join(", ")} — only the first is used.`);
  return { headers, mapping, rowCount: rows.length - 1, sample: rows.slice(1, 6), warnings, unmapped: headers.filter((h) => !mapping[h]) };
}

export function importCsv(db: Db, brandId: string, input: { filename: string; text: string; platform: string; account?: string; mapping?: Mapping }) {
  const platform = Platform.safeParse(input.platform);
  if (!platform.success) throw badRequest(`Unknown platform "${input.platform}".`);
  const rows = parseCsv(input.text);
  if (rows.length < 2) throw badRequest("CSV needs a header row and at least one data row.");
  const headers = rows[0].map((h) => h.trim());
  const mapping = { ...autoMap(headers), ...(input.mapping ?? {}) };
  const valid = new Set([...METRICS.map((m) => m.key), ...Object.keys(META_COLUMNS), ""]);
  for (const [h, v] of Object.entries(mapping)) if (!valid.has(v)) throw badRequest(`Invalid mapping for "${h}": ${v}`);
  const metricCols = headers.map((h, i) => ({ h, i, key: mapping[h] })).filter((c) => METRICS.some((m) => m.key === c.key));
  if (!metricCols.length) throw badRequest("Map at least one column to a metric.");
  const col = (key: string) => headers.findIndex((h) => mapping[h] === key);
  const iTitle = col("title"), iRef = col("post_ref"), iUrl = col("url"), iPub = col("published_at"), iFormat = col("format"), iPillar = col("pillar"), iPlat = col("platform");
  if (iTitle < 0 && iRef < 0) throw badRequest("Map a title or post id column so posts can be identified.");

  const warnings: string[] = [];
  const warn = (w: string) => warnings.length < 50 && warnings.push(w);
  const importId = newId("imp");
  const content = db.all<{ id: string; title: string; published_url: string }>("SELECT id, title, published_url FROM content_items WHERE brand_id = ?", brandId);
  const ts = now();
  let imported = 0, skipped = 0;
  const dates: string[] = [];
  db.tx(() => {
    db.insert("analytics_imports", { id: importId, brand_id: brandId, filename: input.filename.slice(0, 200), platform: platform.data, account: (input.account ?? "").slice(0, 200), source: "csv", row_count: 0, mapping_json: mapping, created_at: ts });
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      const title = iTitle >= 0 ? (r[iTitle] ?? "").trim() : "";
      const ref = iRef >= 0 ? (r[iRef] ?? "").trim() : "";
      if (/^(total|totals|summary)$/i.test(title || ref)) return void skipped++;
      if (!title && !ref) return (skipped++, warn(`Row ${line}: no title or id — skipped.`));
      const metrics: Record<string, number> = {};
      for (const c of metricCols) {
        const n = parseNumber(r[c.i] ?? "");
        if (n === null) continue;
        if (Number.isNaN(n) || n < 0) {
          warn(`Row ${line}: "${c.h}" value "${String(r[c.i]).slice(0, 30)}" is not a valid number — ignored.`);
          continue;
        }
        if (c.key === "watch_time_hours") metrics.watch_time_minutes = Math.round(n * 60 * 10) / 10;
        else metrics[c.key] = n;
      }
      if (!Object.keys(metrics).length) return (skipped++, warn(`Row ${line}: no usable metric values — skipped.`));
      const rowPlatformRaw = iPlat >= 0 ? normalise(r[iPlat] ?? "").replace(/ /g, "_") : "";
      const rowPlatform = (PLATFORMS as readonly string[]).includes(rowPlatformRaw) ? rowPlatformRaw : platform.data;
      let published = iPub >= 0 ? (r[iPub] ?? "").trim() : "";
      if (published) {
        const d = new Date(published);
        if (isNaN(d.getTime())) {
          warn(`Row ${line}: unrecognised date "${published.slice(0, 30)}".`);
          published = "";
        } else {
          published = d.toISOString();
          dates.push(published);
        }
      }
      const rawUrl = iUrl >= 0 ? (r[iUrl] ?? "").trim().slice(0, 2000) : "";
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
      if (rawUrl && !url) warn(`Row ${line}: URL ignored (only http/https links are kept).`);
      const match = content.find((c) => (url && c.published_url === url) || (title && similarity(c.title, title) > 0.85));
      db.insert("analytics_snapshots", {
        id: newId("snap"), brand_id: brandId, import_id: importId, content_item_id: match?.id ?? null, platform: rowPlatform, post_ref: ref.slice(0, 200),
        title: title.slice(0, 500), url, published_at: published, format: iFormat >= 0 ? (r[iFormat] ?? "").trim().slice(0, 50) : "",
        pillar: iPillar >= 0 ? (r[iPillar] ?? "").trim().slice(0, 100) : "", metrics_json: metrics, created_at: ts,
      });
      imported++;
    });
    dates.sort();
    db.update("analytics_imports", importId, { row_count: imported, skipped, warnings_json: warnings, window_start: dates[0] ?? "", window_end: dates[dates.length - 1] ?? "" });
    audit(db, { brandId, entityType: "analytics_import", entityId: importId, action: "imported", detail: { rows: imported, skipped, filename: input.filename } });
  });
  if (!imported) throw badRequest("No valid rows were found in this CSV.", warnings);
  return { ...dto(db.get("SELECT * FROM analytics_imports WHERE id = ?", importId)), warnings };
}

export function listImports(db: Db, brandId: string) {
  return dtos(db.all("SELECT * FROM analytics_imports WHERE brand_id = ? ORDER BY created_at DESC", brandId));
}
export function deleteImport(db: Db, id: string) {
  const r = db.get("SELECT brand_id FROM analytics_imports WHERE id = ?", id);
  if (!r) throw notFound("Import");
  db.run("DELETE FROM analytics_imports WHERE id = ?", id);
  audit(db, { brandId: r.brand_id, entityType: "analytics_import", entityId: id, action: "deleted" });
}

// ---------------- Analysis ----------------
export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const PRIMARY_ORDER = ["views", "impressions", "reach", "watch_time_minutes", "likes"];

export interface PostAnalysis {
  id: string;
  title: string;
  platform: string;
  format: string;
  pillar: string;
  publishedAt: string;
  url: string;
  contentItemId: string | null;
  metrics: Record<string, number>;
  vsBaseline: Record<string, number | null>; // ratio to platform median
  verdict: "outperformed" | "underperformed" | "typical" | "insufficient_data";
}

export function analyze(db: Db, brandId: string, opts: { platform?: string } = {}) {
  const snaps = dtos(db.all(`SELECT * FROM analytics_snapshots WHERE brand_id = ? ${opts.platform ? "AND platform = ?" : ""} ORDER BY published_at DESC`, ...(opts.platform ? [brandId, opts.platform] : [brandId])));
  const byPlatform = new Map<string, any[]>();
  snaps.forEach((s) => byPlatform.set(s.platform, [...(byPlatform.get(s.platform) ?? []), s]));
  const platforms = [...byPlatform.entries()].map(([platform, posts]) => {
    const metricKeys = [...new Set(posts.flatMap((p) => Object.keys(p.metrics)))];
    const baseline: Record<string, { median: number | null; n: number }> = {};
    for (const k of metricKeys) {
      const vals = posts.map((p) => p.metrics[k]).filter((v) => typeof v === "number");
      baseline[k] = { median: median(vals), n: vals.length };
    }
    const primary = PRIMARY_ORDER.find((k) => baseline[k]?.n) ?? metricKeys[0];
    const analysed: PostAnalysis[] = posts.map((p) => {
      const vs: Record<string, number | null> = {};
      for (const k of metricKeys) {
        const b = baseline[k].median;
        vs[k] = typeof p.metrics[k] === "number" && b ? Math.round((p.metrics[k] / b) * 100) / 100 : null;
      }
      const r = vs[primary];
      const verdict = posts.length < 3 || r === null || r === undefined ? "insufficient_data" : r >= 1.5 ? "outperformed" : r <= 0.67 ? "underperformed" : "typical";
      return { id: p.id, title: p.title || p.postRef, platform, format: p.format, pillar: p.pillar, publishedAt: p.publishedAt, url: p.url, contentItemId: p.contentItemId, metrics: p.metrics, vsBaseline: vs, verdict };
    });
    const groupBy = (key: "format" | "pillar" | "weekday") => {
      const g = new Map<string, number[]>();
      posts.forEach((p) => {
        const label = key === "weekday" ? (p.publishedAt ? new Date(p.publishedAt).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) : "") : p[key];
        if (!label || typeof p.metrics[primary] !== "number") return;
        g.set(label, [...(g.get(label) ?? []), p.metrics[primary]]);
      });
      const overall = baseline[primary]?.median ?? 0;
      return [...g.entries()]
        .map(([label, vals]) => ({ label, n: vals.length, median: median(vals), ratio: overall ? Math.round(((median(vals) ?? 0) / overall) * 100) / 100 : null, confidence: confidenceFromSample(vals.length) }))
        .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
    };
    const segments = { format: groupBy("format"), pillar: groupBy("pillar"), weekday: groupBy("weekday") };
    const insights = buildInsights(platform, primary, posts.length, segments, analysed);
    const dates = posts.map((p) => p.publishedAt).filter(Boolean).sort();
    return { platform, posts: analysed, baseline, primaryMetric: primary, n: posts.length, window: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "" }, segments, insights, confidence: confidenceFromSample(posts.length) };
  });
  return { platforms, note: "Each post is compared with the median of the same platform's imported posts. Ratios are descriptive, not causal." };
}

function buildInsights(platform: string, primary: string, n: number, segments: Record<string, { label: string; n: number; ratio: number | null; confidence: string }[]>, posts: PostAnalysis[]) {
  const out: { kind: "observation" | "hypothesis"; text: string; confidence: string }[] = [];
  if (n < 5) out.push({ kind: "observation", text: `Only ${n} ${platform} post(s) imported — patterns below are weak signals. Import more history before changing strategy.`, confidence: "low" });
  for (const [dim, groups] of Object.entries(segments)) {
    const top = groups.find((g) => g.n >= 2 && (g.ratio ?? 0) >= 1.3);
    if (top) out.push({ kind: "hypothesis", text: `${dim === "weekday" ? "Posts published on" : `${cap(dim)}`} “${top.label}” ${dim === "weekday" ? "" : "content "}had a median ${primary.replace(/_/g, " ")} ${top.ratio}× this platform's overall median (n=${top.n}). Worth testing deliberately — not yet proof of cause.`, confidence: top.confidence });
    const low = [...groups].reverse().find((g) => g.n >= 2 && (g.ratio ?? 1) <= 0.7);
    if (low) out.push({ kind: "hypothesis", text: `${cap(dim)} “${low.label}” trailed at ${low.ratio}× median ${primary.replace(/_/g, " ")} (n=${low.n}).`, confidence: low.confidence });
  }
  const outliers = posts.filter((p) => p.verdict === "outperformed");
  if (outliers.length) out.push({ kind: "observation", text: `${outliers.length} post(s) beat 1.5× the median ${primary.replace(/_/g, " ")}: ${outliers.slice(0, 3).map((p) => `“${p.title.slice(0, 50)}”`).join(", ")}.`, confidence: confidenceFromSample(n) });
  return out;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function postmortem(db: Db, snapshotId: string) {
  const s = db.get("SELECT * FROM analytics_snapshots WHERE id = ?", snapshotId);
  if (!s) throw notFound("Snapshot");
  const a = analyze(db, s.brand_id, { platform: s.platform }).platforms[0];
  const post = a.posts.find((p) => p.id === snapshotId)!;
  const whatHappened = Object.entries(post.metrics).map(([k, v]) => {
    const r = post.vsBaseline[k];
    const def = METRICS.find((m) => m.key === k);
    return `${def?.label ?? k}: ${fmt(v)}${r ? ` (${r}× the ${s.platform} median of ${fmt(a.baseline[k].median ?? 0)})` : ""}`;
  });
  const fmtSeg = (dim: "format" | "pillar", label: string) => a.segments[dim].find((g) => g.label === label);
  const hypotheses: string[] = [];
  const fSeg = post.format ? fmtSeg("format", post.format) : undefined;
  if (fSeg && fSeg.n >= 2) hypotheses.push(`Format “${post.format}” runs at ${fSeg.ratio}× median across ${fSeg.n} posts — format may be a factor.`);
  const pSeg = post.pillar ? fmtSeg("pillar", post.pillar) : undefined;
  if (pSeg && pSeg.n >= 2) hypotheses.push(`Pillar “${post.pillar}” runs at ${pSeg.ratio}× median across ${pSeg.n} posts — topic demand may be a factor.`);
  if (post.vsBaseline.ctr_percent && post.vsBaseline.avg_percent_viewed) {
    if (post.vsBaseline.ctr_percent >= 1.2 && post.vsBaseline.avg_percent_viewed <= 0.85) hypotheses.push("Packaging attracted clicks but retention lagged — the content may not have delivered on the title/thumbnail promise.");
    if (post.vsBaseline.ctr_percent <= 0.85 && post.vsBaseline.avg_percent_viewed >= 1.15) hypotheses.push("Viewers who clicked stayed — packaging (title/thumbnail) may be under-selling strong content.");
  }
  if (!hypotheses.length) hypotheses.push("Not enough tagged history (format/pillar) to form a specific hypothesis. Tag posts with format and pillar on import.");
  const repeat = post.verdict === "outperformed" ? ["Repeat the topic/angle with a fresh, distinct example.", "Reuse the structure (hook → payoff order) in the next piece."] : [];
  const change = post.verdict === "underperformed" ? ["Test a different packaging angle for this topic before abandoning it.", "Check whether the hook delivered the core payoff within the first seconds/lines."] : [];
  return {
    post,
    whatHappened,
    known: [`Data window: ${a.window.start.slice(0, 10) || "unknown"} → ${a.window.end.slice(0, 10) || "unknown"}; ${a.n} ${s.platform} post(s) in the baseline.`, `Verdict vs own baseline: ${post.verdict.replace(/_/g, " ")}.`],
    hypotheses,
    repeat,
    change,
    nextExperiment: { hypothesis: hypotheses[0], variable: post.vsBaseline.ctr_percent ? "Title/thumbnail packaging" : "Hook (first line / first 3 seconds)", metric: a.primaryMetric, threshold: `≥1.2× current median ${a.primaryMetric.replace(/_/g, " ")} over 3+ posts` },
    confidence: a.confidence,
    note: "Postmortems separate measured facts from hypotheses. Correlation in a small sample is not causation.",
  };
}
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100));
