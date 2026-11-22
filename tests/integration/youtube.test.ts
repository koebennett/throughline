import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, PROFILE } from "../helpers/setup.js";
import { setYoutubeFetch, enforceRetention } from "../../src/server/services/youtube.js";

const CLIENT = "123-abc.apps.googleusercontent.com";
function fakeGoogle() {
  const calls: { url: string; body?: string; auth?: string }[] = [];
  let tokenN = 0;
  const f = (async (input: any, init: any = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body, auth: init.headers?.authorization });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      tokenN++;
      const p = new URLSearchParams(init.body);
      if (p.get("grant_type") === "refresh_token") return json({ access_token: `at-${tokenN}`, expires_in: 3600 });
      return json({ access_token: `at-${tokenN}`, refresh_token: "rt-1", expires_in: 3600, scope: "https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly" });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
    if (url.includes("/youtube/v3/channels")) return json({ items: [{ snippet: { title: "Test Channel" } }] });
    if (url.includes("youtubeanalytics.googleapis.com/v2/reports"))
      return json({ columnHeaders: ["video", "views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "likes", "comments", "shares", "subscribersGained"].map((name) => ({ name })), rows: [["vid1", 1000, 500, 120, 45.5, 50, 5, 3, 7], ["vid2", 300, 40, 35, 60, 10, 1, 0, 1]] });
    if (url.includes("/youtube/v3/videos")) return json({ items: [{ id: "vid1", snippet: { title: "Long video", publishedAt: "2026-10-01T00:00:00Z" }, contentDetails: { duration: "PT12M3S" } }, { id: "vid2", snippet: { title: "A short", publishedAt: "2026-10-05T00:00:00Z" }, contentDetails: { duration: "PT45S" } }] });
    return json({ error: { message: "unexpected" } }, 404);
  }) as typeof fetch;
  setYoutubeFetch(f);
  return calls;
}
afterEach(() => setYoutubeFetch(null));

describe("YouTube read-only connector", () => {
  it("runs PKCE OAuth, syncs analytics, refreshes tokens, and revokes + deletes on disconnect", async () => {
    const calls = fakeGoogle();
    const t = makeApp();
    const b = (await t.call("POST", "/api/brands", PROFILE)).body.id;
    const st = (s: string) => t.call("GET", "/api/integrations").then((r) => r.body.find((i: any) => i.id === "youtube").status === s);
    expect(await st("needs_credentials")).toBe(true);
    expect((await t.call("POST", "/api/integrations/youtube/client", { clientId: "not-a-client" })).status).toBe(400);
    await t.call("POST", "/api/integrations/youtube/client", { clientId: CLIENT, clientSecret: "shh" });
    expect(await st("needs_oauth")).toBe(true);

    const start = (await t.call("POST", "/api/integrations/youtube/connect", { brandId: b })).body;
    const u = new URL(start.authUrl);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1(:\d+)?\/api\/integrations\/youtube\/callback$/);
    expect(u.searchParams.get("scope")).not.toMatch(/upload|force-ssl|youtube($| )/);
    const state = u.searchParams.get("state")!;

    // Unknown state is rejected; the real callback succeeds once and only once.
    expect((await t.call("GET", `/api/integrations/youtube/callback?code=x&state=forged`)).body).toMatch(/expired or was already used/);
    expect((await t.call("GET", `/api/integrations/youtube/callback?code=good&state=${state}`)).body).toMatch(/YouTube connected/);
    expect((await t.call("GET", `/api/integrations/youtube/callback?code=good&state=${state}`)).body).toMatch(/already used/);
    const tokenReq = new URLSearchParams(calls.find((c) => c.url.includes("/token"))!.body);
    const verifier = tokenReq.get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(u.searchParams.get("code_challenge"));
    expect(await st("connected")).toBe(true);
    // Tokens are encrypted at rest and never returned by the API.
    expect(JSON.stringify((await t.call("GET", "/api/integrations")).body)).not.toContain("rt-1");
    expect(t.db.get("SELECT ciphertext FROM secrets WHERE name = 'youtube:tokens'")!.ciphertext).not.toContain("rt-1");

    const sync = await t.call("POST", `/api/brands/${b}/integrations/youtube/sync`, { days: 30 });
    expect(sync.body.videos).toBe(2);
    const a = (await t.call("GET", `/api/brands/${b}/analytics`)).body;
    const plats = a.platforms.map((p: any) => p.platform).sort();
    expect(plats).toEqual(["youtube", "youtube_shorts"]);
    const longPost = a.platforms.find((p: any) => p.platform === "youtube").posts[0];
    expect(longPost).toMatchObject({ title: "Long video", metrics: { views: 1000, watch_time_minutes: 500, avg_percent_viewed: 45.5, followers_gained: 7 } });
    expect((await t.call("GET", `/api/brands/${b}/analytics/imports`)).body[0].source).toBe("api:youtube");

    // Expired access token is refreshed before the next API call.
    const tok = JSON.parse(t.ctx.secrets.get("youtube:tokens")!);
    t.ctx.secrets.set("youtube:tokens", JSON.stringify({ ...tok, expires_at: 0 }));
    await t.call("POST", `/api/brands/${b}/integrations/youtube/sync`, { days: 30 });
    expect(calls.some((c) => c.body && new URLSearchParams(c.body).get("grant_type") === "refresh_token")).toBe(true);
    expect((await t.call("GET", `/api/brands/${b}/analytics/imports`)).body).toHaveLength(1); // replaced, not duplicated

    // Retention: API data older than 30 days is deleted.
    t.db.run("UPDATE analytics_imports SET created_at = '2020-01-01T00:00:00Z'");
    expect(enforceRetention(t.ctx)).toBe(1);

    await t.call("POST", `/api/brands/${b}/integrations/youtube/sync`, { days: 30 });
    const d = await t.call("POST", "/api/integrations/youtube/disconnect");
    expect(d.body.disconnected).toBe(true);
    expect(calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect(t.db.get("SELECT count(*) AS n FROM analytics_imports WHERE source = 'api:youtube'")!.n).toBe(0);
    expect(t.ctx.secrets.has("youtube:tokens")).toBe(false);
  });
});
