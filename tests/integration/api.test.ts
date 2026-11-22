import { describe, expect, it } from "vitest";
import { makeApp, PROFILE, waitFor } from "../helpers/setup.js";

async function setupBrand() {
  const t = makeApp();
  const b = await t.call("POST", "/api/brands", PROFILE);
  expect(b.status).toBe(201);
  return { ...t, brandId: b.body.id as string };
}
const runToEnd = async (t: Awaited<ReturnType<typeof setupBrand>>, task: string, input: unknown) => {
  const r = await t.call("POST", `/api/brands/${t.brandId}/agent/runs`, { task, input });
  expect(r.status).toBe(202);
  return waitFor(() => t.call("GET", `/api/agent/runs/${r.body.id}`).then((x) => x.body), (x) => !["queued", "running"].includes(x.status) && !x.running);
};

describe("security middleware", () => {
  it("blocks writes without the CSRF header and foreign Host headers", async () => {
    const t = makeApp();
    const noHeader = await t.app.request("/api/brands", { method: "POST", headers: { host: "127.0.0.1:8787", "content-type": "application/json" }, body: JSON.stringify(PROFILE) });
    expect(noHeader.status).toBe(403);
    const rebinding = await t.app.request("/api/brands", { headers: { host: "evil.example.com" } });
    expect(rebinding.status).toBe(403);
    expect((await t.call("POST", "/api/brands", { name: "" })).status).toBe(400);
    expect((await t.call("GET", "/api/brands/nope")).status).toBe(404);
  });
});

describe("brand profile versioning", () => {
  it("creates new versions on edit and can restore", async () => {
    const t = await setupBrand();
    const u = await t.call("PUT", `/api/brands/${t.brandId}`, { profile: { ...PROFILE, niche: "taxes for creators" }, changeNote: "narrow niche" });
    expect(u.body.version).toBe(2);
    const v = await t.call("GET", `/api/brands/${t.brandId}/versions`);
    expect(v.body.map((x: any) => x.version)).toEqual([2, 1]);
    const r = await t.call("POST", `/api/brands/${t.brandId}/versions/1/restore`);
    expect(r.body).toMatchObject({ version: 3, profile: { niche: PROFILE.niche } });
  });
});

describe("brand brain retrieval & memory", () => {
  it("retrieves cited snippets, honours exclusion, and keeps agent memory proposed", async () => {
    const t = await setupBrand();
    const d = await t.call("POST", `/api/brands/${t.brandId}/documents`, { title: "Offer sheet", kind: "offer", content: "# Pricing\n\nThe course costs $99 and includes tax templates.\n\n# Audience\n\nFreelancers in year one." });
    const s = await t.call("GET", `/api/brands/${t.brandId}/search?q=tax templates price`);
    expect(s.body[0]).toMatchObject({ documentTitle: "Offer sheet", citation: "Offer sheet › Pricing" });
    await t.call("PATCH", `/api/documents/${d.body.id}`, { excluded: true });
    expect((await t.call("GET", `/api/brands/${t.brandId}/search?q=tax templates`)).body).toHaveLength(0);
    const m = await t.call("POST", `/api/brands/${t.brandId}/memory`, { layer: "content", statement: "Tutorials beat opinion pieces on YouTube", sourceType: "analytics" });
    expect(m.body.status).toBe("proposed");
    const u = await t.call("POST", `/api/brands/${t.brandId}/memory`, { layer: "brand", statement: "We never give individual financial advice", sourceType: "user" });
    expect(u.body.status).toBe("approved");
    const conflict = await t.call("POST", `/api/brands/${t.brandId}/memory`, { layer: "content", statement: "Tutorials do not beat opinion pieces on YouTube", sourceType: "analytics" });
    expect(conflict.body.conflictsWith).toBe(m.body.id);
  });
});

describe("research honesty", () => {
  it("downgrades uncited facts and rejects unsafe source URLs", async () => {
    const t = await setupBrand();
    const e = await t.call("POST", `/api/brands/${t.brandId}/evidence`, { claim: "Most freelancers under-save for tax", kind: "fact", confidence: "high" });
    expect(e.body).toMatchObject({ kind: "inference" });
    expect(e.body.auditNote).toMatch(/Downgraded/);
    const bad = await t.call("POST", `/api/brands/${t.brandId}/sources`, { title: "x", url: "http://169.254.169.254/latest/meta-data" });
    expect(bad.status).toBe(400);
    const imp = await t.call("POST", `/api/brands/${t.brandId}/sources/import-url`, { url: "http://localhost:8787/api/brands" });
    expect(imp.status).toBe(400);
    const src = await t.call("POST", `/api/brands/${t.brandId}/sources`, { title: "Survey 2026", url: "https://example.com/survey", publishedAt: "2026-03-01" });
    const f = await t.call("POST", `/api/brands/${t.brandId}/evidence`, { claim: "Survey says X", kind: "fact", sourceId: src.body.id });
    expect(f.body).toMatchObject({ kind: "fact", sourceTitle: "Survey 2026" });
  });
});

describe("offline vertical slice: strategy → ideas → brief → drafts → QA → approval → calendar", () => {
  it("runs end to end with deterministic gates", async () => {
    const t = await setupBrand();
    // Strategy run pauses at the approval gate; nothing is activated before approval.
    const strat = await runToEnd(t, "build_strategy", { goal: "newsletter sign-ups" });
    expect(strat.status).toBe("awaiting_approval");
    expect((await t.call("GET", `/api/brands/${t.brandId}/pillars`)).body).toHaveLength(0);
    const approved = await t.call("POST", `/api/agent/runs/${strat.id}/decision`, { decision: "approve" });
    expect(approved.body.status).toBe("succeeded");
    const pillars = (await t.call("GET", `/api/brands/${t.brandId}/pillars`)).body;
    expect(pillars.length).toBeGreaterThanOrEqual(3);

    const ideasRun = await runToEnd(t, "generate_ideas", { count: 5 });
    expect(ideasRun.status).toBe("succeeded");
    const ideas = (await t.call("GET", `/api/brands/${t.brandId}/ideas`)).body;
    expect(ideas.length).toBeGreaterThan(0);
    expect(ideas[0].scoring.note).toMatch(/not a prediction/);
    expect(ideas[0].pillarId).toBeTruthy();

    const briefRun = await runToEnd(t, "create_brief", { ideaId: ideas[0].id });
    const briefId = briefRun.output.briefId;
    expect((await t.call("GET", `/api/ideas/${ideas[0].id}`)).body.status).toBe("BRIEF");

    const draftRun = await runToEnd(t, "create_drafts", { briefId, targets: [{ platform: "youtube" }, { platform: "linkedin" }], options: { variants: 2 } });
    expect(draftRun.status).toBe("succeeded");
    expect(draftRun.output.items).toHaveLength(2);
    const itemId = draftRun.output.items[1].contentItemId;
    let item = (await t.call("GET", `/api/content/${itemId}`)).body;
    expect(item.variants.length).toBe(2);
    expect(item.status).toBe("QA"); // scaffold placeholders are hard blockers
    expect((await t.call("POST", `/api/content/${itemId}/approve`, {})).status).toBe(409);

    // Human edit → new variant → QA passes → approve.
    const edit = await t.call("POST", `/api/content/${itemId}/variants`, { angleLabel: "My edit", fields: { hooks: ["Irregular income breaks normal budgets."], body: "Irregular income breaks normal budgets.\nHere's the buffer account system I've used for 8 years:\n1. Pay everything into one buffer account.\n2. Pay yourself a fixed monthly salary from it.\n3. Move 30% of every invoice to a tax pot the day it lands.\nIt turns feast or famine into a steady paycheck.", cta: "Join the newsletter for the spreadsheet.", titleOptions: ["The buffer account system for irregular income"] } });
    expect(edit.body.status).toBe("DRAFT");
    const qa = await t.call("POST", `/api/content/${itemId}/qa`, { useModel: false });
    expect(qa.body.passed).toBe(true);
    item = (await t.call("GET", `/api/content/${itemId}`)).body;
    expect(item.status).toBe("REVIEW");
    // Scheduling or publishing before approval is refused deterministically.
    expect((await t.call("POST", `/api/content/${itemId}/transition`, { to: "SCHEDULED" })).status).toBe(409);
    const ap = await t.call("POST", `/api/content/${itemId}/approve`, { note: "looks good" });
    expect(ap.body.status).toBe("APPROVED");
    // Editing after approval invalidates the approval.
    await t.call("POST", `/api/content/${itemId}/variants`, { fields: { ...item.variants[0].fields, cta: "Join the newsletter today." } });
    expect((await t.call("GET", `/api/content/${itemId}`)).body.status).toBe("DRAFT");
    expect((await t.call("POST", `/api/content/${itemId}/transition`, { to: "PUBLISHED", publishedUrl: "https://x.com/1" })).status).toBe(409);

    // Calendar planning run requires approval before writing entries.
    const plan = await runToEnd(t, "plan_calendar", { weeks: 2 });
    expect(plan.status).toBe("awaiting_approval");
    expect((await t.call("GET", `/api/brands/${t.brandId}/calendar`)).body).toHaveLength(0);
    await t.call("POST", `/api/agent/runs/${plan.id}/decision`, { decision: "approve" });
    const cal = (await t.call("GET", `/api/brands/${t.brandId}/calendar`)).body;
    expect(cal.length).toBeGreaterThan(0);
    expect(cal[0].suggestionBasis).toBe("hypothesis");
    const moved = await t.call("POST", `/api/calendar/${cal[0].id}/move`, { scheduledAt: "2027-01-05T09:00:00Z" });
    expect(moved.body.scheduledAt).toBe("2027-01-05T09:00:00.000Z");
    const csv = await t.call("GET", `/api/brands/${t.brandId}/calendar.csv`);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.body).toMatch(/scheduled_at_utc/);
    const ics = await t.call("GET", `/api/brands/${t.brandId}/calendar.ics`);
    expect(ics.body).toMatch(/BEGIN:VEVENT/);

    // Status history is immutable and inspectable.
    const hist = (await t.call("GET", `/api/content/${itemId}`)).body.history;
    expect(hist.some((h: any) => h.action === "approved")).toBe(true);
    expect(() => t.db.run("UPDATE audit_events SET action = 'x'")).toThrow(/append-only/);
    expect(() => t.db.run("DELETE FROM audit_events")).toThrow(/append-only/);
  });
});

describe("analytics import", () => {
  it("validates headers, skips bad rows safely, and compares against own baseline", async () => {
    const t = await setupBrand();
    const noMetric = await t.call("POST", `/api/brands/${t.brandId}/analytics/import`, { platform: "youtube", text: "title,foo\nA,1\n" });
    expect(noMetric.status).toBe(400);
    const csv = "Video title,Views,Average percentage viewed (%),Video publish time\nTotal,9999,50,\nA,1000,40,2026-10-01\nB,abc,45,2026-10-02\nC,3000,55,not a date\nD,900,30,2026-10-08\n,5,5,\nE,1100,42,2026-10-09\n";
    const prev = await t.call("POST", `/api/brands/${t.brandId}/analytics/preview`, { text: csv });
    expect(prev.body.mapping).toMatchObject({ "Video title": "title", Views: "views" });
    const imp = await t.call("POST", `/api/brands/${t.brandId}/analytics/import`, { platform: "youtube", text: csv, filename: "studio.csv" });
    expect(imp.status).toBe(201);
    expect(imp.body.rowCount).toBe(5);
    expect(imp.body.warnings.join(" ")).toMatch(/not a valid number/);
    expect(imp.body.warnings.join(" ")).toMatch(/unrecognised date/);
    const a = (await t.call("GET", `/api/brands/${t.brandId}/analytics`)).body;
    const yt = a.platforms[0];
    expect(yt.baseline.views.median).toBe(1050);
    expect(yt.posts.find((p: any) => p.title === "C").verdict).toBe("outperformed");
    const pm = await t.call("GET", `/api/analytics/snapshots/${yt.posts.find((p: any) => p.title === "C").id}/postmortem`);
    expect(pm.body.known[0]).toMatch(/Data window/);
    expect(pm.body.note).toMatch(/not causation/);
    const tpl = await t.call("GET", "/api/analytics/template.csv");
    expect(tpl.body.split("\r\n")[0]).toMatch(/^post_id,platform,title/);
  });
});

describe("repurposing with lineage and rights", () => {
  it("creates derivatives linked to timestamps and blocks approval when rights are unknown", async () => {
    const t = await setupBrand();
    const a = await t.call("POST", `/api/brands/${t.brandId}/assets`, { kind: "transcript", title: "Ep 1", rights: "unknown", textContent: "[00:00] Why do freelancers run out of money in month three? Here's the reason most people never see coming.\n\n[01:30] The biggest mistake is paying yourself whatever lands in your account. Never do that; use a buffer.\n\n[03:00] Lesson from 8 years: move 30% of each invoice to a tax pot the same day." });
    const run = await runToEnd(t, "repurpose_transcript", { assetId: a.body.id, maxMoments: 2 });
    expect(run.status).toBe("succeeded");
    const ids = run.output.contentItemIds;
    expect(ids).toHaveLength(2);
    const item = (await t.call("GET", `/api/content/${ids[0]}`)).body;
    expect(item.lineage[0]).toMatchObject({ sourceAssetId: a.body.id, assetRights: "unknown" });
    expect(item.lineage[0].segmentStart).toMatch(/\d\d:\d\d/);
    expect(item.reviews[0].checks.find((c: any) => c.id === "rights").status).toBe("block");
    await t.call("PATCH", `/api/assets/${a.body.id}/rights`, { rights: "owned", note: "my podcast" });
    const lin = (await t.call("GET", `/api/brands/${t.brandId}/lineage`)).body;
    expect(lin).toHaveLength(2);
  });
});

describe("deletion", () => {
  it("deletes a brand and its data on explicit confirmation", async () => {
    const t = await setupBrand();
    await t.call("POST", `/api/brands/${t.brandId}/documents`, { title: "d", content: "hello world content" });
    expect((await t.call("DELETE", `/api/brands/${t.brandId}`, { confirmName: "wrong" })).status).toBe(400);
    expect((await t.call("DELETE", `/api/brands/${t.brandId}`, { confirmName: "Test Brand" })).status).toBe(200);
    expect(t.db.get("SELECT count(*) AS n FROM documents")!.n).toBe(0);
    expect(t.db.get("SELECT count(*) AS n FROM audit_events WHERE brand_id = ?", t.brandId)!.n).toBe(0);
    expect(t.db.get("SELECT count(*) AS n FROM audit_events WHERE entity_id = ? AND action = 'deleted'", t.brandId)!.n).toBe(1);
  });
});

describe("approval gate defence in depth", () => {
  it("refuses approval when the latest QA on the current variant failed, even if status says REVIEW", async () => {
    const t = await setupBrand();
    const item = await t.call("POST", `/api/brands/${t.brandId}/content`, { title: "P", platform: "linkedin", format: "text_post", fields: { body: "This is guaranteed to double your income in a week, every single time you try it." } });
    expect((await t.call("POST", `/api/content/${item.body.id}/approve`, {})).body.error).toMatch(/Run QA/);
    const qa = await t.call("POST", `/api/content/${item.body.id}/qa`, { useModel: false });
    expect(qa.body.passed).toBe(false);
    t.db.update("content_items", item.body.id, { status: "REVIEW" }); // simulate a corrupted/forced state
    const r = await t.call("POST", `/api/content/${item.body.id}/approve`, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/hard blockers/);
    // Rule-based blockers can never be overridden.
    const ov = await t.call("POST", `/api/qa/${qa.body.id}/override`, { checkId: "no_guarantees", note: "I insist on this" });
    expect(ov.status).toBe(403);
  });
});
