// HTTP API. Local-first: binds to 127.0.0.1 by default and has no login, so it defends against
// cross-site requests (custom header required on writes) and DNS rebinding (Host allow-list).
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import {
  AGENT_TASK_LABELS, BriefData, BrandProfile, DraftFields, EvidenceInput, ExperimentInput, IdeaInput, PLATFORM_LABELS, SourceInput, StrategyDraft,
  type DraftFields as DraftFieldsT,
} from "../shared/schemas.js";
import { PLATFORM_SPECS, FORMAT_LABELS } from "../shared/platforms.js";
import { METRICS } from "../shared/metrics.js";
import type { Ctx } from "./context.js";
import type { WorkflowEngine } from "./agent/engine.js";
import { HttpError, badRequest, notFound } from "./lib/errors.js";
import { log } from "./lib/log.js";
import { toCsv } from "./lib/csv.js";
import { ingestFile, safeFilename } from "./lib/assetProcessor.js";
import { fenceUntrusted } from "./lib/text.js";
import { AnthropicProvider } from "./providers/model/anthropic.js";
import { ModelOutputError, ModelRefusalError } from "./providers/model/types.js";
import * as brands from "./services/brands.js";
import * as brain from "./services/brain.js";
import * as research from "./services/research.js";
import * as strategy from "./services/strategy.js";
import * as ideas from "./services/ideas.js";
import * as content from "./services/content.js";
import * as calendar from "./services/calendar.js";
import * as assets from "./services/assets.js";
import * as analytics from "./services/analytics.js";
import * as experiments from "./services/experiments.js";
import * as publishing from "./services/publishing.js";
import { commandCenter } from "./services/home.js";
import { getSettings, Settings, updateSettings } from "./services/settings.js";
import { usageSummary } from "./services/usage.js";
import { audit, listAudit } from "./services/audit.js";
import { integrationStatuses, getConnector } from "./connectors/registry.js";
import { reviewVariant, directGenerate, draftText } from "./agent/review.js";
import { profileSummary } from "./agent/context.js";
import { system } from "./agent/prompts.js";
import { seedDemo } from "./demo.js";

const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function createApp(ctx: Ctx, engine: WorkflowEngine, opts: { allowAnyHost?: boolean } = {}) {
  const app = new Hono();
  const { db } = ctx;

  // ---------------- security middleware ----------------
  app.use("/api/*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    if (!opts.allowAnyHost && !ALLOWED_HOSTS.test(host)) return c.json({ error: "Host not allowed" }, 403);
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("x-throughline") !== "1")
      return c.json({ error: "Missing X-Throughline header (cross-site request blocked)" }, 403);
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });
  app.use("/api/*", bodyLimit({ maxSize: 12 * 1024 * 1024, onError: (c) => c.json({ error: "Request body too large (12 MB max)" }, 413) }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status as any);
    if (err instanceof ZodError) return c.json({ error: "Validation failed", details: err.issues.slice(0, 20) }, 400);
    if (err instanceof ModelRefusalError || err instanceof ModelOutputError) return c.json({ error: err.message }, 422);
    if (err instanceof Anthropic.AuthenticationError) return c.json({ error: "The Claude API key was rejected. Update it in Settings → Integrations." }, 502);
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: "Claude API rate limit reached — try again shortly." }, 503);
    if (err instanceof Anthropic.APIError) return c.json({ error: `Claude API error (${err.status ?? "network"}).` }, 502);
    if (err instanceof SyntaxError && /JSON/.test(err.message)) return c.json({ error: "Malformed JSON body" }, 400);
    log.error("unhandled", { path: c.req.path, error: err.message, stack: err.stack?.split("\n").slice(0, 4).join(" | ") });
    return c.json({ error: "Internal error — see server log." }, 500);
  });

  const json = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => schema.parse(await c.req.json().catch(() => { throw badRequest("Malformed JSON body"); }));
  const brandOf = (c: Context) => {
    const id = c.req.param("b")!;
    brands.getBrand(db, id);
    return id;
  };
  const csv = (c: Context, name: string, body: string) => c.body(body, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` });

  // ---------------- meta ----------------
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/meta", (c) => {
    const m = ctx.model();
    return c.json({
      version: "0.1.0",
      model: { live: m.live, id: m.id, label: m.label, models: m.models },
      platforms: Object.entries(PLATFORM_LABELS).map(([id, label]) => ({ id, label, spec: PLATFORM_SPECS[id as keyof typeof PLATFORM_SPECS] })),
      formats: FORMAT_LABELS,
      tasks: AGENT_TASK_LABELS,
      metrics: METRICS,
      settings: getSettings(db),
    });
  });

  // ---------------- brands ----------------
  app.get("/api/brands", (c) => c.json(brands.listBrands(db)));
  app.post("/api/brands", async (c) => c.json(brands.createBrand(db, await json(c, BrandProfile)), 201));
  app.get("/api/brands/:b", (c) => c.json(brands.getBrand(db, c.req.param("b"))));
  app.put("/api/brands/:b", async (c) => {
    const body = await json(c, z.object({ profile: BrandProfile, changeNote: z.string().max(500).default("") }));
    return c.json(brands.updateProfile(db, brandOf(c), body.profile, body.changeNote));
  });
  app.delete("/api/brands/:b", async (c) => {
    const body = await json(c, z.object({ confirmName: z.string() }));
    const b = brands.getBrand(db, c.req.param("b"));
    if (body.confirmName !== b.name) throw badRequest("Type the brand name exactly to confirm deletion.");
    brands.deleteBrand(db, b.id);
    return c.json({ deleted: true });
  });
  app.get("/api/brands/:b/versions", (c) => c.json(brands.listProfileVersions(db, brandOf(c))));
  app.post("/api/brands/:b/versions/:v/restore", (c) => c.json(brands.restoreProfileVersion(db, brandOf(c), Number(c.req.param("v")))));
  app.get("/api/brands/:b/home", (c) => c.json(commandCenter(ctx, brandOf(c))));
  app.post("/api/demo/seed", async (c) => c.json(await seedDemo(ctx, engine), 201));

  // ---------------- brand brain ----------------
  app.get("/api/brands/:b/documents", (c) => c.json(brain.listDocuments(db, brandOf(c))));
  app.post("/api/brands/:b/documents", async (c) => c.json(brain.addDocument(db, brandOf(c), await json(c, brain.DocumentInput)), 201));
  app.post("/api/brands/:b/documents/upload", async (c) => {
    const b = brandOf(c);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Attach a file in the 'file' field.");
    const ing = ingestFile(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!ing.text.trim()) throw badRequest("Only text documents can be added to the Brand Brain (txt, md, srt, vtt, csv, json).");
    const kind = String(form.get("kind") || (ing.kind === "transcript" ? "transcript" : "doc"));
    return c.json(brain.addDocument(db, b, { title: String(form.get("title") || safeFilename(file.name)), kind: kind as any, sourceRef: safeFilename(file.name), content: ing.text }), 201);
  });
  app.get("/api/documents/:id", (c) => c.json(brain.getDocument(db, c.req.param("id"))));
  app.patch("/api/documents/:id", async (c) => c.json(brain.updateDocument(db, c.req.param("id"), await json(c, z.object({ title: z.string().max(300).optional(), content: z.string().max(500_000).optional(), excluded: z.boolean().optional() })))));
  app.delete("/api/documents/:id", (c) => (brain.deleteDocument(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/brands/:b/search", (c) => c.json(brain.retrieve(db, brandOf(c), c.req.query("q") ?? "", 10)));
  app.get("/api/brands/:b/memory", (c) => c.json(brain.listMemory(db, brandOf(c))));
  app.post("/api/brands/:b/memory", async (c) => c.json(brain.addMemory(db, brandOf(c), await json(c, brain.MemoryInput)), 201));
  app.patch("/api/memory/:id", async (c) => c.json(brain.updateMemory(db, c.req.param("id"), await json(c, z.object({ statement: z.string().min(3).max(1000).optional(), status: z.enum(["proposed", "approved", "rejected"]).optional(), confidence: z.enum(["low", "medium", "high"]).optional() })))));
  app.delete("/api/memory/:id", (c) => (brain.deleteMemory(db, c.req.param("id")), c.json({ deleted: true })));

  // ---------------- research ----------------
  app.get("/api/brands/:b/sources", (c) => c.json(research.listSources(db, brandOf(c))));
  app.post("/api/brands/:b/sources", async (c) => c.json(research.addSource(db, brandOf(c), await json(c, SourceInput)), 201));
  app.post("/api/brands/:b/sources/import-url", async (c) => c.json(await research.importUrl(db, brandOf(c), (await json(c, z.object({ url: z.string().max(2000) }))).url), 201));
  app.delete("/api/sources/:id", (c) => (research.deleteSource(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/brands/:b/evidence", (c) => c.json(research.listEvidence(db, brandOf(c), { researchRunId: c.req.query("run"), topic: c.req.query("topic") })));
  app.post("/api/brands/:b/evidence", async (c) => c.json(research.addEvidence(db, brandOf(c), await json(c, EvidenceInput)), 201));
  app.patch("/api/evidence/:id", async (c) => c.json(research.updateEvidence(db, c.req.param("id"), await json(c, EvidenceInput.partial()))));
  app.delete("/api/evidence/:id", (c) => (research.deleteEvidence(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/brands/:b/research-runs", (c) => c.json(research.listResearchRuns(db, brandOf(c))));
  app.get("/api/research-runs/:id", (c) => c.json(research.getResearchRun(db, c.req.param("id"))));

  // ---------------- strategy ----------------
  app.get("/api/brands/:b/strategies", (c) => c.json(strategy.listStrategies(db, brandOf(c))));
  app.post("/api/brands/:b/strategies", async (c) => {
    const b = brandOf(c);
    return c.json(strategy.saveStrategyDraft(db, b, await json(c, StrategyDraft), "user", brands.getBrand(db, b).profile), 201);
  });
  app.get("/api/strategies/:id", (c) => c.json(strategy.getStrategy(db, c.req.param("id"))));
  app.put("/api/strategies/:id", async (c) => {
    const s = strategy.getStrategy(db, c.req.param("id"));
    return c.json(strategy.updateStrategyDraft(db, s.id, await json(c, StrategyDraft), brands.getBrand(db, s.brandId).profile));
  });
  app.post("/api/strategies/:id/approve", async (c) => c.json(strategy.approveStrategy(db, c.req.param("id"), await json(c, z.object({ acknowledgeWarnings: z.boolean().default(false) })))));
  app.post("/api/strategies/:id/duplicate", (c) => {
    const s = strategy.getStrategy(db, c.req.param("id"));
    return c.json(strategy.duplicateStrategy(db, s.id, brands.getBrand(db, s.brandId).profile), 201);
  });
  app.get("/api/brands/:b/pillars", (c) => c.json(strategy.listPillars(db, brandOf(c), c.req.query("all") === "1")));
  app.post("/api/brands/:b/pillars", async (c) => c.json(strategy.addPillar(db, brandOf(c), await json(c, strategy.PillarInput)), 201));
  app.patch("/api/pillars/:id", async (c) => c.json(strategy.updatePillar(db, c.req.param("id"), await json(c, strategy.PillarInput.partial().extend({ active: z.boolean().optional() })))));
  app.post("/api/brands/:b/clusters", async (c) => c.json(strategy.addCluster(db, brandOf(c), await json(c, z.object({ pillarId: z.string(), name: z.string().min(1).max(200), pillarTopic: z.string().max(300).optional(), subtopics: z.array(z.string().max(200)).max(50).optional(), searchIntent: z.string().max(200).optional() }))), 201));
  app.delete("/api/clusters/:id", (c) => (strategy.deleteCluster(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/brands/:b/series", (c) => c.json(strategy.listSeries(db, brandOf(c))));
  app.post("/api/brands/:b/series", async (c) => c.json(strategy.addSeries(db, brandOf(c), await json(c, z.object({ name: z.string().min(1).max(200), premise: z.string().max(2000).optional(), format: z.string().max(50).optional(), cadence: z.string().max(100).optional(), pillarId: z.string().nullable().optional() }))), 201));
  app.get("/api/brands/:b/campaigns", (c) => c.json(strategy.listCampaigns(db, brandOf(c))));
  app.post("/api/brands/:b/campaigns", async (c) => c.json(strategy.upsertCampaign(db, brandOf(c), await json(c, strategy.CampaignInput)), 201));
  app.put("/api/brands/:b/campaigns/:id", async (c) => c.json(strategy.upsertCampaign(db, brandOf(c), await json(c, strategy.CampaignInput), c.req.param("id"))));

  // ---------------- ideas ----------------
  app.get("/api/brands/:b/ideas", (c) => c.json(ideas.listIdeas(db, brandOf(c), ctx.settings(), { status: c.req.query("status"), pillarId: c.req.query("pillar"), platform: c.req.query("platform"), seriesId: c.req.query("series") })));
  app.post("/api/brands/:b/ideas", async (c) => c.json(ideas.createIdea(db, brandOf(c), await json(c, IdeaInput), ctx.settings()), 201));
  app.get("/api/ideas/:id", (c) => c.json(ideas.getIdea(db, c.req.param("id"), ctx.settings())));
  app.patch("/api/ideas/:id", async (c) => c.json(ideas.updateIdea(db, c.req.param("id"), await json(c, IdeaInput.partial().extend({ status: z.enum(["IDEA", "RESEARCHED", "BRIEF", "ARCHIVED"]).optional() })), ctx.settings())));
  app.get("/api/ideas/:id/history", (c) => c.json(ideas.ideaHistory(db, c.req.param("id"))));
  app.post("/api/brands/:b/ideas/rescore", (c) => (ideas.rescoreAll(db, brandOf(c), ctx.settings()), c.json({ ok: true })));
  app.get("/api/brands/:b/ideas.csv", (c) => {
    const list = ideas.listIdeas(db, brandOf(c), ctx.settings());
    return csv(c, "ideas.csv", toCsv(["title", "angle", "pillar", "series", "platform", "format", "funnel_stage", "effort", "status", "score", "confidence", "coverage", "rationale"], list.map((i: any) => [i.title, i.angle, i.pillarName ?? "", i.seriesName ?? "", i.platform ?? "", i.format ?? "", i.funnelStage ?? "", i.effort, i.status, i.scoring.score, i.scoring.confidence, i.scoring.coverage, i.rationale])));
  });

  // ---------------- briefs ----------------
  app.get("/api/brands/:b/briefs", (c) => c.json(content.listBriefs(db, brandOf(c))));
  app.post("/api/brands/:b/briefs", async (c) => {
    const body = await json(c, z.object({ data: BriefData, ideaId: z.string().nullable().optional() }));
    return c.json(content.createBrief(db, brandOf(c), body.data, { ideaId: body.ideaId }), 201);
  });
  app.get("/api/briefs/:id", (c) => c.json(content.getBrief(db, c.req.param("id"))));
  app.put("/api/briefs/:id", async (c) => c.json(content.updateBrief(db, c.req.param("id"), await json(c, BriefData))));
  app.post("/api/briefs/:id/status", async (c) => c.json(content.setBriefStatus(db, c.req.param("id"), (await json(c, z.object({ status: z.enum(["draft", "approved"]) }))).status)));
  app.get("/api/briefs/:id/revisions/:v", (c) => c.json(content.briefRevision(db, c.req.param("id"), Number(c.req.param("v")))));

  // ---------------- content ----------------
  app.get("/api/brands/:b/content", (c) => c.json(content.listContent(db, brandOf(c), { status: c.req.query("status"), platform: c.req.query("platform"), campaignId: c.req.query("campaign") })));
  app.post("/api/brands/:b/content", async (c) => {
    const body = await json(c, z.object({ title: z.string().min(1).max(300), platform: z.string(), format: z.string(), briefId: z.string().nullable().optional(), campaignId: z.string().nullable().optional(), fields: DraftFields.partial().optional() }));
    const b = brandOf(c);
    return c.json(content.createContentItem(db, b, body as any, body.fields ? { fields: body.fields, angleLabel: "Manual draft", generatedBy: "user" } : undefined), 201);
  });
  app.get("/api/content/:id", (c) => c.json(content.getContentItem(db, c.req.param("id"))));
  app.patch("/api/content/:id", async (c) => c.json(content.updateContentMeta(db, c.req.param("id"), await json(c, z.object({ title: z.string().max(300).optional(), campaignId: z.string().nullable().optional(), timezone: z.string().max(64).optional() })))));
  app.post("/api/content/:id/variants", async (c) => {
    const body = await json(c, z.object({ fields: DraftFields.partial(), angleLabel: z.string().max(200).default("Edited"), parentVariantId: z.string().nullable().optional(), feedback: z.string().max(2000).default("") }));
    content.addVariant(db, c.req.param("id"), { fields: body.fields, angleLabel: body.angleLabel, generatedBy: "user", parentVariantId: body.parentVariantId, feedback: body.feedback });
    return c.json(content.getContentItem(db, c.req.param("id")), 201);
  });
  app.post("/api/content/:id/current-variant", async (c) => c.json(content.setCurrentVariant(db, c.req.param("id"), (await json(c, z.object({ variantId: z.string() }))).variantId)));
  app.post("/api/content/:id/qa", async (c) => {
    const body = await json(c, z.object({ variantId: z.string().optional(), useModel: z.boolean().default(true) }));
    const { review } = await reviewVariant(ctx, c.req.param("id"), body.variantId, { useModel: body.useModel });
    return c.json(review);
  });
  app.post("/api/qa/:reviewId/override", async (c) => {
    const body = await json(c, z.object({ checkId: z.string(), note: z.string().max(1000) }));
    return c.json(content.overrideCheck(db, c.req.param("reviewId"), body.checkId, body.note));
  });
  app.post("/api/content/:id/approve", async (c) => {
    const body = await json(c, z.object({ decision: z.enum(["approved", "changes_requested"]).default("approved"), note: z.string().max(2000).default("") }));
    return c.json(content.approve(db, c.req.param("id"), body.note, body.decision));
  });
  app.post("/api/content/:id/transition", async (c) => {
    const body = await json(c, z.object({ to: z.enum(["IDEA", "RESEARCHED", "BRIEF", "DRAFT", "QA", "REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ANALYZED", "ARCHIVED"]), publishedUrl: z.string().url().max(2000).optional(), scheduledAt: z.string().optional(), note: z.string().max(1000).optional() }));
    return c.json(content.transition(db, c.req.param("id"), body.to, { publishedUrl: body.publishedUrl, scheduledAt: body.scheduledAt, note: body.note }));
  });
  app.get("/api/content/:id/handoff", (c) => c.json(publishing.handoffPackage(ctx, c.req.param("id"))));
  // Regenerate one selected field of the current variant, producing a NEW variant (history preserved).
  app.post("/api/content/:id/regenerate", async (c) => {
    const body = await json(c, z.object({ field: z.enum(["titleOptions", "hooks", "body", "caption", "description", "cta", "thumbnailConcepts", "hashtags", "pinnedComment"]), instruction: z.string().max(1000).default("") }));
    if (!ctx.model().live) throw badRequest("Regenerating a section needs a Claude API key (Settings → Integrations). You can still edit it by hand.");
    const item = content.getContentItem(db, c.req.param("id"));
    const v = item.variants.find((x: any) => x.id === item.currentVariantId);
    const fields = content.normaliseFields(v.fields);
    const brief = item.briefId ? content.getBrief(db, item.briefId).data : null;
    const isList = Array.isArray(fields[body.field as keyof DraftFieldsT]);
    const schema = z.object({ value: isList ? z.array(z.string()) : z.string(), note: z.string() });
    const res = await directGenerate(ctx, item.brandId)({
      purpose: "draft.regenerate_section", tier: "strong", system: system("draft"), maxTokens: 6000, schema: schema as z.ZodType<{ value: string | string[]; note: string }>,
      prompt: `${profileSummary(brands.getBrand(db, item.brandId).profile)}\nPLATFORM: ${item.platform}/${item.format}\nBRIEF: ${brief ? JSON.stringify(brief) : "(none)"}\n\nCURRENT DRAFT:\n${fenceUntrusted("draft", draftText(fields), 20000)}\n\nRewrite ONLY the "${body.field}" field. ${body.instruction ? `User instruction: ${body.instruction}` : "Make it stronger and more specific."} Keep everything consistent with the rest of the draft.`,
      offline: () => { throw new Error("unreachable"); },
    });
    content.addVariant(db, item.id, { fields: { ...fields, [body.field]: res.data.value }, angleLabel: `${v.angleLabel} · ${body.field} regenerated`, rationale: res.data.note, generatedBy: res.model, parentVariantId: v.id, feedback: body.instruction });
    return c.json(content.getContentItem(db, item.id));
  });

  // ---------------- publishing (gated) ----------------
  app.get("/api/content/:id/publish-preview", (c) => c.json(publishing.publishPreview(ctx, c.req.param("id"), c.req.query("connector") ?? "", (c.req.query("privacy") as any) ?? "private")));
  app.post("/api/content/:id/publish", async (c) => c.json(await publishing.publish(ctx, c.req.param("id"), await json(c, z.object({ connectorId: z.string(), previewHash: z.string(), confirm: z.boolean(), privacy: z.enum(["private", "unlisted", "public"]).default("private") })))));
  app.get("/api/brands/:b/publish-jobs", (c) => c.json(publishing.listPublishJobs(ctx, brandOf(c))));
  app.post("/api/publish-jobs/:id/check", async (c) => c.json(await publishing.checkJobStatus(ctx, c.req.param("id"))));

  // ---------------- calendar ----------------
  app.get("/api/brands/:b/calendar", (c) => c.json(calendar.listEntries(db, brandOf(c), { from: c.req.query("from"), to: c.req.query("to"), platform: c.req.query("platform"), status: c.req.query("status"), campaignId: c.req.query("campaign") })));
  app.post("/api/brands/:b/calendar", async (c) => c.json(calendar.addEntry(db, brandOf(c), await json(c, calendar.CalendarInput)), 201));
  app.patch("/api/calendar/:id", async (c) => c.json(calendar.updateEntry(db, c.req.param("id"), await json(c, z.object({ title: z.string().max(300).optional(), notes: z.string().max(2000).optional() })))));
  app.post("/api/calendar/:id/move", async (c) => {
    const body = await json(c, z.object({ scheduledAt: z.string(), timezone: z.string().max(64).optional() }));
    return c.json(calendar.moveEntry(db, c.req.param("id"), body.scheduledAt, body.timezone));
  });
  app.delete("/api/calendar/:id", (c) => (calendar.deleteEntry(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/brands/:b/calendar.csv", (c) => csv(c, "content-calendar.csv", calendar.exportCsv(db, brandOf(c))));
  app.get("/api/brands/:b/calendar.ics", (c) => {
    const b = brands.getBrand(db, c.req.param("b"));
    return c.body(calendar.exportIcs(db, b.id, b.name), 200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="content-calendar.ics"' });
  });
  app.post("/api/brands/:b/calendar/suggest", async (c) => {
    const body = await json(c, z.object({ platform: z.string(), count: z.number().int().min(1).max(30), start: z.string(), hourUtc: z.number().int().min(0).max(23).default(15) }));
    return c.json(calendar.suggestSlots(db, brandOf(c), body.platform, body.count, body.start, body.hourUtc));
  });

  // ---------------- assets / repurposing ----------------
  app.get("/api/brands/:b/assets", (c) => c.json(assets.listAssets(db, brandOf(c))));
  app.post("/api/brands/:b/assets", async (c) => c.json(assets.addAsset(db, brandOf(c), await json(c, assets.AssetInput)), 201));
  app.post("/api/brands/:b/assets/upload", async (c) => {
    const b = brandOf(c);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Attach a file in the 'file' field.");
    let ing;
    try {
      ing = ingestFile(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const rights = assets.RIGHTS.includes(String(form.get("rights")) as any) ? (String(form.get("rights")) as (typeof assets.RIGHTS)[number]) : "unknown";
    return c.json(assets.addAsset(db, b, { kind: ing.kind, title: String(form.get("title") || safeFilename(file.name)), rights, rightsNote: String(form.get("rightsNote") ?? ""), filename: safeFilename(file.name), mime: file.type.slice(0, 100), sizeBytes: file.size, textContent: ing.text }), 201);
  });
  app.get("/api/assets/:id", (c) => c.json(assets.getAsset(db, c.req.param("id"))));
  app.patch("/api/assets/:id/rights", async (c) => {
    const body = await json(c, z.object({ rights: z.enum(assets.RIGHTS), note: z.string().max(2000).default("") }));
    return c.json(assets.updateAssetRights(db, c.req.param("id"), body.rights, body.note));
  });
  app.delete("/api/assets/:id", (c) => (assets.deleteAsset(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/brands/:b/lineage", (c) => c.json(assets.lineageMap(db, brandOf(c))));

  // ---------------- analytics / experiments ----------------
  app.get("/api/analytics/template.csv", (c) => csv(c, "throughline-analytics-template.csv", analytics.csvTemplate()));
  app.post("/api/brands/:b/analytics/preview", async (c) => (brandOf(c), c.json(analytics.previewCsv((await json(c, z.object({ text: z.string().max(10_000_000) }))).text))));
  app.post("/api/brands/:b/analytics/import", async (c) => c.json(analytics.importCsv(db, brandOf(c), await json(c, z.object({ filename: z.string().max(200).default("import.csv"), text: z.string().max(10_000_000), platform: z.string(), account: z.string().max(200).optional(), mapping: z.record(z.string(), z.string()).optional() }))), 201));
  app.get("/api/brands/:b/analytics", (c) => c.json(analytics.analyze(db, brandOf(c), { platform: c.req.query("platform") })));
  app.get("/api/brands/:b/analytics/imports", (c) => c.json(analytics.listImports(db, brandOf(c))));
  app.delete("/api/analytics/imports/:id", (c) => (analytics.deleteImport(db, c.req.param("id")), c.json({ deleted: true })));
  app.get("/api/analytics/snapshots/:id/postmortem", (c) => c.json(analytics.postmortem(db, c.req.param("id"))));
  app.get("/api/brands/:b/experiments", (c) => c.json(experiments.listExperiments(db, brandOf(c))));
  app.post("/api/brands/:b/experiments", async (c) => c.json(experiments.upsertExperiment(db, brandOf(c), await json(c, ExperimentInput)), 201));
  app.put("/api/brands/:b/experiments/:id", async (c) => c.json(experiments.upsertExperiment(db, brandOf(c), await json(c, ExperimentInput), c.req.param("id"))));
  app.delete("/api/experiments/:id", (c) => (experiments.deleteExperiment(db, c.req.param("id")), c.json({ deleted: true })));

  // ---------------- agent ----------------
  app.get("/api/agent/tasks", (c) => c.json(engine.taskNames().map((t) => ({ task: t, label: AGENT_TASK_LABELS[t as keyof typeof AGENT_TASK_LABELS] }))));
  app.post("/api/brands/:b/agent/runs", async (c) => {
    const body = await json(c, z.object({ task: z.string(), input: z.unknown().default({}) }));
    const id = engine.start(body.task, body.input ?? {}, brandOf(c));
    return c.json(engine.get(id), 202);
  });
  app.get("/api/brands/:b/agent/runs", (c) => c.json(engine.list(brandOf(c))));
  app.get("/api/agent/runs/:id", (c) => c.json(engine.get(c.req.param("id"))));
  app.post("/api/agent/runs/:id/pause", (c) => c.json(engine.pause(c.req.param("id"))));
  app.post("/api/agent/runs/:id/cancel", (c) => c.json(engine.cancel(c.req.param("id"))));
  app.post("/api/agent/runs/:id/resume", (c) => c.json(engine.resume(c.req.param("id"))));
  app.post("/api/agent/runs/:id/decision", async (c) => {
    const body = await json(c, z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(1000).default("") }));
    return c.json(await engine.decide(c.req.param("id"), body.decision, body.note));
  });

  // ---------------- integrations / settings / data ----------------
  app.get("/api/integrations", (c) => c.json(integrationStatuses(ctx)));
  app.post("/api/integrations/anthropic/key", async (c) => {
    const { apiKey } = await json(c, z.object({ apiKey: z.string().min(20).max(300).regex(/^[\x21-\x7e]+$/, "Invalid key format") }));
    const probe = new AnthropicProvider({ apiKey, baseURL: ctx.config.anthropicBaseURL, strongModel: ctx.config.strongModel, fastModel: ctx.config.fastModel });
    try {
      await probe.ping();
    } catch (e) {
      throw badRequest(e instanceof Anthropic.AuthenticationError ? "Anthropic rejected this key." : `Could not verify the key: ${(e as Error).message}`);
    }
    ctx.secrets.set("anthropic:api_key", apiKey);
    db.run("INSERT INTO integrations (id, status, connected_at, updated_at) VALUES ('anthropic', 'connected', ?, ?) ON CONFLICT(id) DO UPDATE SET status = 'connected', connected_at = excluded.connected_at, updated_at = excluded.updated_at", new Date().toISOString(), new Date().toISOString());
    ctx.refreshModel();
    audit(db, { entityType: "integration", entityId: "anthropic", action: "connected" });
    return c.json({ connected: true });
  });
  app.post("/api/integrations/:id/test", async (c) => {
    const id = c.req.param("id");
    const connector = getConnector(id);
    if (!connector) throw notFound("Integration");
    if (id === "anthropic") {
      const m = ctx.model();
      if (!(m instanceof AnthropicProvider)) return c.json({ ok: false, detail: "No API key configured." });
      try {
        const r = await m.ping();
        db.run("INSERT INTO integrations (id, status, last_sync_at, updated_at) VALUES ('anthropic', 'connected', ?, ?) ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at", new Date().toISOString(), new Date().toISOString());
        return c.json({ ok: true, detail: `Key valid; model ${r.model} reachable.` });
      } catch (e) {
        return c.json({ ok: false, detail: e instanceof Anthropic.AuthenticationError ? "Key rejected by Anthropic." : (e as Error).message });
      }
    }
    const s = connector.status(ctx);
    return c.json({ ok: s.status === "connected" || s.status === "available", detail: s.detail });
  });
  app.post("/api/integrations/:id/disconnect", (c) => {
    const id = c.req.param("id");
    if (!getConnector(id)) throw notFound("Integration");
    ctx.secrets.delete(`${id}:api_key`);
    ctx.secrets.delete(id);
    // Delete data that came from this provider's API (retention/revocation rules). CSV imports are user-owned and kept.
    const removed = db.run("DELETE FROM analytics_imports WHERE source = ?", `api:${id}`).changes;
    db.run("INSERT INTO integrations (id, status, updated_at) VALUES (?, 'disconnected', ?) ON CONFLICT(id) DO UPDATE SET status = 'disconnected', updated_at = excluded.updated_at", id, new Date().toISOString());
    ctx.refreshModel();
    audit(db, { entityType: "integration", entityId: id, action: "disconnected", detail: { removedApiImports: Number(removed), envKeyStillSet: id === "anthropic" && !!ctx.config.anthropicApiKey } });
    return c.json({ disconnected: true, note: id === "anthropic" && ctx.config.anthropicApiKey ? "ANTHROPIC_API_KEY is still set in your environment; remove it from .env to fully disconnect." : undefined });
  });
  app.get("/api/settings", (c) => c.json(getSettings(db)));
  app.put("/api/settings", async (c) => {
    const patch = await json(c, Settings.partial());
    const before = getSettings(db);
    const after = updateSettings(db, patch);
    if (patch.publishingEnabled !== undefined && patch.publishingEnabled !== before.publishingEnabled)
      audit(db, { entityType: "settings", entityId: "publishingEnabled", action: patch.publishingEnabled ? "publishing_enabled" : "publishing_disabled" });
    if (patch.opportunityWeights) for (const b of brands.listBrands(db)) ideas.rescoreAll(db, b.id, after);
    return c.json(after);
  });
  app.get("/api/usage", (c) => c.json(usageSummary(db)));
  app.get("/api/audit", (c) => c.json(listAudit(db, { brandId: c.req.query("brandId"), entityId: c.req.query("entityId"), limit: Number(c.req.query("limit") ?? 200) })));
  app.get("/api/brands/:b/export", (c) => {
    const b = brandOf(c);
    const tables = ["brand_profile_versions", "documents", "memory_items", "research_runs", "sources", "evidence_items", "strategy_versions", "pillars", "topic_clusters", "series", "campaigns", "ideas", "briefs", "content_items", "calendar_entries", "assets", "content_lineage", "analytics_imports", "analytics_snapshots", "experiments"];
    const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), brand: brands.getBrand(db, b) };
    for (const t of tables) data[t] = db.all(`SELECT * FROM ${t} WHERE brand_id = ?`, b);
    data.content_variants = db.all("SELECT v.* FROM content_variants v JOIN content_items c ON c.id = v.content_item_id WHERE c.brand_id = ?", b);
    return c.body(JSON.stringify(data, null, 1), 200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="throughline-export-${b}.json"` });
  });

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.text("Not found", 404)));
  return app;
}
