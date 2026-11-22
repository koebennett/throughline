// YouTube read-only connector: OAuth 2.0 authorization code + PKCE (Desktop-app client, loopback redirect),
// encrypted token storage, refresh, revoke, and Analytics API sync into the Analytics Lab.
// Read-only by design: no upload, no engagement actions, no audiovisual download.
import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "../context.js";
import { newId, now } from "../db/db.js";
import { badRequest, HttpError } from "../lib/errors.js";
import { audit } from "./audit.js";
import { getBrand } from "./brands.js";

export const YT = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  reportsUrl: "https://youtubeanalytics.googleapis.com/v2/reports",
  videosUrl: "https://www.googleapis.com/youtube/v3/videos",
  channelsUrl: "https://www.googleapis.com/youtube/v3/channels",
  scopes: ["https://www.googleapis.com/auth/yt-analytics.readonly", "https://www.googleapis.com/auth/youtube.readonly"],
  /** YouTube API Services policy: stored API data must be refreshed or deleted within 30 days. */
  retentionDays: 30,
};

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Test hook. */
export function setYoutubeFetch(f: Fetch | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
}
interface Pending {
  verifier: string;
  redirectUri: string;
  brandId: string | null;
  expires: number;
}
const pending = new Map<string, Pending>();

export function clientCredentials(ctx: Ctx): { id: string; secret: string } | null {
  const id = ctx.config.youtubeClientId || ctx.secrets.get("youtube:client_id") || "";
  const secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET || ctx.secrets.get("youtube:client_secret") || "";
  return id ? { id, secret } : null;
}

export function saveClient(ctx: Ctx, id: string, secret: string) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id.trim())) throw badRequest("That doesn't look like a Google OAuth client ID (…apps.googleusercontent.com).");
  ctx.secrets.set("youtube:client_id", id.trim());
  if (secret.trim()) ctx.secrets.set("youtube:client_secret", secret.trim());
  audit(ctx.db, { entityType: "integration", entityId: "youtube", action: "client_configured" });
}

export function youtubeStatus(ctx: Ctx) {
  const row = ctx.db.get("SELECT * FROM integrations WHERE id = 'youtube'");
  const client = clientCredentials(ctx);
  if (!client) return { status: "needs_credentials" as const, detail: "Add a Google OAuth client (type: Desktop app) below. Meanwhile, CSV import works fully." };
  if (!ctx.secrets.has("youtube:tokens")) return { status: "needs_oauth" as const, detail: "OAuth client saved. Click “Connect YouTube” to authorize read-only access to your channel." };
  return { status: "connected" as const, detail: `Read-only analytics connected${row?.account_label ? ` for ${row.account_label}` : ""}. Uploads are not enabled.`, account: row?.account_label ?? "" };
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Start the flow: returns the Google consent URL. `origin` is this server's loopback origin (any port is allowed for Desktop clients). */
export function startAuth(ctx: Ctx, origin: string, brandId: string | null) {
  const client = clientCredentials(ctx);
  if (!client) throw badRequest("Configure a Google OAuth client first.");
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) throw badRequest("OAuth redirects must use a loopback address.");
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const redirectUri = `${origin}/api/integrations/youtube/callback`;
  pending.set(state, { verifier, redirectUri, brandId, expires: Date.now() + 10 * 60_000 });
  const params = new URLSearchParams({
    client_id: client.id, redirect_uri: redirectUri, response_type: "code", scope: YT.scopes.join(" "),
    code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent", include_granted_scopes: "true",
  });
  return { authUrl: `${YT.authUrl}?${params}`, state };
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new HttpError(502, `Google OAuth error: ${data.error_description || data.error || res.status}`);
  return data;
}

export async function completeAuth(ctx: Ctx, code: string, state: string) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.expires < Date.now()) throw badRequest("This authorization link has expired or was already used. Start again from Settings.");
  const client = clientCredentials(ctx)!;
  const t = await postForm(YT.tokenUrl, { code, client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}), redirect_uri: p.redirectUri, grant_type: "authorization_code", code_verifier: p.verifier });
  if (!t.refresh_token) throw new HttpError(502, "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.");
  const missing = YT.scopes.filter((s) => !String(t.scope ?? "").split(" ").includes(s));
  if (missing.length) throw badRequest(`Required read-only access was not granted: ${missing.join(", ")}`);
  const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope };
  ctx.secrets.set("youtube:tokens", JSON.stringify(tokens));
  const ch = await apiGet(ctx, `${YT.channelsUrl}?part=snippet&mine=true`);
  const label = ch.items?.[0]?.snippet?.title ?? "your channel";
  ctx.db.run(
    "INSERT INTO integrations (id, status, account_label, scopes_json, connected_at, updated_at) VALUES ('youtube', 'connected', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = 'connected', account_label = excluded.account_label, scopes_json = excluded.scopes_json, connected_at = excluded.connected_at, updated_at = excluded.updated_at",
    label, JSON.stringify(YT.scopes), now(), now(),
  );
  audit(ctx.db, { entityType: "integration", entityId: "youtube", action: "connected", detail: { account: label, scopes: YT.scopes } });
  return { account: label, brandId: p.brandId };
}

async function accessToken(ctx: Ctx): Promise<string> {
  const raw = ctx.secrets.get("youtube:tokens");
  if (!raw) throw badRequest("YouTube is not connected.");
  const t = JSON.parse(raw) as Tokens;
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  const client = clientCredentials(ctx);
  if (!client) throw badRequest("Google OAuth client is missing.");
  const r = await postForm(YT.tokenUrl, { client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}), refresh_token: t.refresh_token, grant_type: "refresh_token" });
  const next: Tokens = { ...t, access_token: r.access_token, expires_at: Date.now() + (r.expires_in ?? 3600) * 1000 };
  ctx.secrets.set("youtube:tokens", JSON.stringify(next));
  return next.access_token;
}

async function apiGet(ctx: Ctx, url: string) {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${await accessToken(ctx)}` } });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new HttpError(502, `YouTube API error ${res.status}: ${data?.error?.message ?? "unknown"}`);
  return data;
}

const METRICS: [string, string][] = [
  ["views", "views"], ["estimatedMinutesWatched", "watch_time_minutes"], ["averageViewDuration", "avg_view_duration_seconds"],
  ["averageViewPercentage", "avg_percent_viewed"], ["likes", "likes"], ["comments", "comments"], ["shares", "shares"], ["subscribersGained", "followers_gained"],
];

/** Pull per-video analytics for the last `days` days into the Analytics Lab (replaces the previous API import for this brand). */
export async function syncAnalytics(ctx: Ctx, brandId: string, days = 90) {
  getBrand(ctx.db, brandId);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const q = new URLSearchParams({ ids: "channel==MINE", startDate: ymd(start), endDate: ymd(end), metrics: METRICS.map((m) => m[0]).join(","), dimensions: "video", sort: "-views", maxResults: "200" });
  const report = await apiGet(ctx, `${YT.reportsUrl}?${q}`);
  const headers: string[] = (report.columnHeaders ?? []).map((h: any) => h.name);
  const rows: any[][] = report.rows ?? [];
  const ids = rows.map((r) => String(r[headers.indexOf("video")]));
  const meta = new Map<string, { title: string; publishedAt: string; shorts: boolean }>();
  for (let i = 0; i < ids.length; i += 50) {
    const v = await apiGet(ctx, `${YT.videosUrl}?part=snippet,contentDetails&id=${ids.slice(i, i + 50).map(encodeURIComponent).join(",")}`);
    for (const it of v.items ?? []) {
      const dur = String(it.contentDetails?.duration ?? "");
      const secs = (Number(dur.match(/(\d+)H/)?.[1] ?? 0) * 3600) + (Number(dur.match(/(\d+)M/)?.[1] ?? 0) * 60) + Number(dur.match(/(\d+)S/)?.[1] ?? 0);
      meta.set(it.id, { title: it.snippet?.title ?? it.id, publishedAt: it.snippet?.publishedAt ?? "", shorts: secs > 0 && secs <= 180 });
    }
  }
  const account = ctx.db.get("SELECT account_label FROM integrations WHERE id = 'youtube'")?.account_label ?? "";
  const importId = newId("imp");
  const ts = now();
  ctx.db.tx(() => {
    ctx.db.run("DELETE FROM analytics_imports WHERE brand_id = ? AND source = 'api:youtube'", brandId);
    ctx.db.insert("analytics_imports", { id: importId, brand_id: brandId, filename: `YouTube Analytics API (${ymd(start)} → ${ymd(end)})`, platform: "youtube", account, source: "api:youtube", row_count: rows.length, mapping_json: { source: "YouTube Analytics API v2", metrics: METRICS.map((m) => m[0]) }, window_start: start.toISOString(), window_end: end.toISOString(), created_at: ts });
    for (const r of rows) {
      const vid = String(r[headers.indexOf("video")]);
      const m = meta.get(vid);
      const metrics: Record<string, number> = {};
      for (const [api, key] of METRICS) {
        const v = r[headers.indexOf(api)];
        if (typeof v === "number") metrics[key] = v;
      }
      ctx.db.insert("analytics_snapshots", {
        id: newId("snap"), brand_id: brandId, import_id: importId, platform: m?.shorts ? "youtube_shorts" : "youtube", post_ref: vid, title: m?.title ?? vid,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`, published_at: m?.publishedAt ?? "", format: m?.shorts ? "short_video" : "long_video", pillar: "", metrics_json: metrics, created_at: ts,
      });
    }
    ctx.db.run("UPDATE integrations SET last_sync_at = ?, updated_at = ? WHERE id = 'youtube'", ts, ts);
    audit(ctx.db, { brandId, entityType: "analytics_import", entityId: importId, action: "synced", detail: { source: "api:youtube", videos: rows.length, days } });
  });
  return { importId, videos: rows.length, window: { start: ymd(start), end: ymd(end) } };
}

/** Revoke at Google (best effort) and delete tokens + all API-sourced data. */
export async function disconnectYoutube(ctx: Ctx) {
  const raw = ctx.secrets.get("youtube:tokens");
  let revoked = false;
  if (raw) {
    try {
      const t = JSON.parse(raw) as Tokens;
      const res = await fetchImpl(`${YT.revokeUrl}?token=${encodeURIComponent(t.refresh_token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } });
      revoked = res.ok;
    } catch {
      revoked = false;
    }
  }
  ctx.secrets.delete("youtube:tokens");
  const removed = Number(ctx.db.run("DELETE FROM analytics_imports WHERE source = 'api:youtube'").changes);
  return { revoked, removedImports: removed };
}

/** Delete API-sourced YouTube data older than the policy window. Run at startup and before analysis. */
export function enforceRetention(ctx: Ctx) {
  const cutoff = new Date(Date.now() - YT.retentionDays * 86400000).toISOString();
  return Number(ctx.db.run("DELETE FROM analytics_imports WHERE source = 'api:youtube' AND created_at < ?", cutoff).changes);
}
