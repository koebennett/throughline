// Task definitions: each is a typed sequence of persisted steps with bounded model use.
import { z } from "zod";
import {
  AnalyticsNarrative, AnswerOutput, BriefData, DraftOptions, DraftOutput, Format, IdeaBatch, MomentExtraction, Platform, ResearchSynthesis, StrategyDraft,
  type DraftFields, type OpportunityDimension,
} from "../../shared/schemas.js";
import { PLATFORM_SPECS } from "../../shared/platforms.js";
import type { StepContext, TaskDef, WorkflowEngine } from "./engine.js";
import { buildContext, type ContextPack } from "./context.js";
import { system } from "./prompts.js";
import * as off from "./offline.js";
import { reviewVariant, reviseDraft } from "./review.js";
import { fenceUntrusted, findNearDuplicates, similarity, truncate } from "../lib/text.js";
import { getBrand } from "../services/brands.js";
import { addEvidence, addSource, auditSynthesis, completeResearchRun, createResearchRun, importUrl, listSources } from "../services/research.js";
import { approveStrategy, saveStrategyDraft, validateStrategy, listSeries, addSeries } from "../services/strategy.js";
import { createIdea, getIdea } from "../services/ideas.js";
import { addVariant, createBrief, createContentItem, getBrief, getContentItem, normaliseFields, listContent } from "../services/content.js";
import { addLineage, getAsset } from "../services/assets.js";
import { addEntry, suggestSlots } from "../services/calendar.js";
import { analyze } from "../services/analytics.js";
import { addMemory } from "../services/brain.js";
import { upsertExperiment } from "../services/experiments.js";
import { commandCenter } from "../services/home.js";
import type { QaResult } from "../services/qa.js";

type SC<I, S> = StepContext<I, S>;
const pushSummary = (state: any, step: string, text: string) => ((state.summaries ??= {})[step] = text);

/** Intake: resolve the brand and report missing essentials — the agent proceeds with labelled assumptions rather than re-asking. */
function intakeStep<I, S extends { missing?: string[] }>(): TaskDef<I, S>["steps"][number] {
  return {
    name: "intake",
    label: "Intake & missing essentials",
    run: async (sc) => {
      const p = getBrand(sc.ctx.db, sc.brandId).profile;
      const missing = [!p.audiences.length && "audience segments", !p.objective && "objective", !p.platforms.length && "platforms", !p.voice.traits.length && "voice traits", p.capacity.postsPerWeekTarget === undefined && "posting capacity"].filter(Boolean) as string[];
      sc.state.missing = missing;
      if (missing.length) sc.note(`Missing in brand profile: ${missing.join(", ")}. Proceeding with clearly labelled assumptions.`);
      pushSummary(sc.state, "intake", missing.length ? `Missing: ${missing.join(", ")}` : "Brand profile has the essentials.");
      sc.note(sc.ctx.model().live ? `Model: ${sc.ctx.model().models.strong}` : "No model connected — using the offline scaffold engine.");
    },
  };
}

const pack = (sc: SC<any, any>, query: string, extra: Parameters<typeof buildContext>[2] = {}): ContextPack => buildContext(sc.ctx, sc.brandId, { query, ...extra });

// ====================== research_topic ======================
const ResearchIn = z.object({ topic: z.string().min(2).max(300), question: z.string().max(1000).default(""), urls: z.array(z.string().max(2000)).max(10).default([]), useWebSearch: z.boolean().default(true) });
interface ResearchState { missing?: string[]; researchRunId?: string; sources: { id: string; url: string; title: string; publishedAt: string; excerpt: string }[]; synthesis?: ResearchSynthesis; auditNotes?: string[]; evidenceIds?: string[]; summaries?: Record<string, string> }

export const researchTask: TaskDef<z.infer<typeof ResearchIn>, ResearchState> = {
  task: "research_topic",
  input: ResearchIn,
  initialState: () => ({ sources: [] }),
  steps: [
    intakeStep(),
    {
      name: "gather",
      label: "Gather sources",
      run: async (sc) => {
        const model = sc.ctx.model();
        const settings = sc.ctx.settings();
        const useWeb = sc.input.useWebSearch && !!model.webResearch && model.live && settings.maxWebSearchesPerRun > 0;
        sc.state.researchRunId ??= createResearchRun(sc.ctx.db, sc.brandId, sc.input.topic, sc.input.question, useWeb ? "claude_web_search" : sc.input.urls.length ? "webpage" : "manual", sc.runId);
        const seen = new Set(sc.state.sources.map((s) => s.url));
        for (const url of sc.input.urls) {
          if (seen.has(url)) continue;
          try {
            const s = await importUrl(sc.ctx.db, sc.brandId, url);
            sc.ctx.db.update("sources", s.id, { research_run_id: sc.state.researchRunId });
            sc.state.sources.push({ id: s.id, url: s.url, title: s.title, publishedAt: s.publishedAt, excerpt: s.excerpt });
            seen.add(s.url);
          } catch (e) {
            sc.note(`Could not import ${truncate(url, 80)}: ${(e as Error).message}`);
          }
        }
        if (useWeb) {
          const p = getBrand(sc.ctx.db, sc.brandId).profile;
          sc.checkBudget();
          const res = await model.webResearch!(
            `Research brief for ${p.name} (${p.niche || "content brand"}) serving ${p.audiences.map((a) => a.name).join(", ") || "its audience"}.\nTopic: ${sc.input.topic}\n${sc.input.question ? `Question: ${sc.input.question}\n` : ""}Find recent, credible public sources on audience questions, pain points, new developments and how existing content covers this topic. Summarise what each source says with dates.`,
            { maxSearches: settings.maxWebSearchesPerRun, system: system("webResearch") },
          );
          sc.charge("research.web_search", model.id, res.model, res.usage);
          for (const w of res.sources.slice(0, 15)) {
            if (seen.has(w.url)) continue;
            const cited = res.citations.filter((c) => c.url === w.url).map((c) => c.citedText).join(" … ");
            try {
              const s = addSource(sc.ctx.db, sc.brandId, { url: w.url, title: w.title || w.url, publishedAt: w.pageAge ?? "", retrievedAt: new Date().toISOString(), excerpt: truncate(cited, 4000), provider: "claude_web_search" }, sc.state.researchRunId);
              sc.state.sources.push({ id: s.id, url: s.url, title: s.title, publishedAt: s.publishedAt, excerpt: s.excerpt });
              seen.add(w.url);
            } catch (e) {
              sc.note(`Skipped source ${truncate(w.url, 60)}: ${(e as Error).message}`);
            }
          }
          sc.note(`Web search returned ${res.sources.length} result(s); ${res.citations.length} citation(s).`);
        }
        // Also include relevant sources already on file.
        for (const s of listSources(sc.ctx.db, sc.brandId)) {
          if (sc.state.sources.length >= 20 || seen.has(s.url || s.id)) continue;
          if (similarity(`${s.title} ${s.excerpt.slice(0, 500)}`, sc.input.topic) > 0.12) {
            sc.state.sources.push({ id: s.id, url: s.url, title: s.title, publishedAt: s.publishedAt, excerpt: s.excerpt });
            seen.add(s.url || s.id);
          }
        }
        pushSummary(sc.state, "gather", `${sc.state.sources.length} source(s) gathered${useWeb ? " (incl. web search)" : ""}.`);
        if (!sc.state.sources.length) sc.note("No sources available. Add URLs or manual sources; synthesis will be limited to hypotheses.");
      },
    },
    {
      name: "synthesize",
      label: "Synthesize evidence",
      run: async (sc) => {
        const ctxPack = pack(sc, sc.input.topic, { evidenceLimit: 10, includeAnalytics: false });
        const list = sc.state.sources.map((s, i) => `[${i}] ${fenceUntrusted(`source ${i}`, `TITLE: ${s.title}\nURL: ${s.url || "none"}\nPUBLISHED: ${s.publishedAt || "unknown"}\n\n${s.excerpt}`, 3500)}`).join("\n\n");
        const res = await sc.generate({
          purpose: "research.synthesis", tier: "strong", system: system("research"),
          prompt: `${ctxPack.text}\n\nRESEARCH TOPIC: ${sc.input.topic}\n${sc.input.question ? `QUESTION: ${sc.input.question}\n` : ""}\nNUMBERED SOURCES:\n${list || "(none)"}`,
          schema: ResearchSynthesis, maxTokens: 8000,
          offline: () => off.offlineSynthesis(sc.input.topic, sc.state.sources, ctxPack),
        });
        sc.state.synthesis = res.data;
        pushSummary(sc.state, "synthesize", `${res.data.evidence.length} evidence candidate(s), ${res.data.audienceQuestions.length} audience question(s).`);
      },
    },
    {
      name: "audit",
      label: "Evidence audit",
      run: async (sc) => {
        const { synthesis, notes } = auditSynthesis(sc.state.synthesis!, sc.state.sources);
        sc.state.synthesis = synthesis;
        sc.state.auditNotes = notes;
        notes.slice(0, 10).forEach((n) => sc.note(n));
        pushSummary(sc.state, "audit", notes.length ? `${notes.length} audit note(s).` : "All claims cite valid sources or are labelled as inference/hypothesis.");
      },
    },
    {
      name: "save",
      label: "Save research brief",
      run: async (sc) => {
        const s = sc.state.synthesis!;
        const by = sc.ctx.model().live ? "agent" : "offline-scaffold";
        sc.state.evidenceIds = sc.ctx.db.tx(() => {
          const ids = s.evidence.map((e) => addEvidence(sc.ctx.db, sc.brandId, { claim: e.claim, kind: e.kind, confidence: e.confidence, sourceId: e.sourceIndex !== null ? sc.state.sources[e.sourceIndex]?.id : null, researchRunId: sc.state.researchRunId, topic: sc.input.topic, quote: e.quote }, by).id);
          for (const q of s.audienceQuestions) ids.push(addEvidence(sc.ctx.db, sc.brandId, { claim: `Audience question: ${q}`, kind: "hypothesis", confidence: "low", researchRunId: sc.state.researchRunId, topic: sc.input.topic }, by).id);
          completeResearchRun(sc.ctx.db, sc.state.researchRunId!, { ...s, openQuestions: [...s.openQuestions, ...(sc.state.auditNotes ?? []).map((n) => `Audit: ${n}`)] });
          return ids;
        });
        pushSummary(sc.state, "save", `Saved ${sc.state.evidenceIds.length} evidence item(s) to the Research Desk.`);
      },
    },
  ],
  output: (s) => ({ researchRunId: s.researchRunId, evidenceCount: s.evidenceIds?.length ?? 0, sourceCount: s.sources.length, summary: s.synthesis?.summary, gaps: s.synthesis?.contentGaps, angles: s.synthesis?.angles, auditNotes: s.auditNotes }),
};

// ====================== build_strategy ======================
const StrategyIn = z.object({ goal: z.string().max(1000).default(""), horizonDays: z.number().int().min(30).max(180).default(90), applyOnApproval: z.boolean().default(true) });
interface StrategyState { missing?: string[]; draft?: StrategyDraft; strategyId?: string; issues?: { level: string; message: string }[]; generatedBy?: string; summaries?: Record<string, string> }

export const strategyTask: TaskDef<z.infer<typeof StrategyIn>, StrategyState> = {
  task: "build_strategy",
  input: StrategyIn,
  initialState: () => ({}),
  steps: [
    intakeStep(),
    {
      name: "strategist",
      label: "Synthesize strategy",
      run: async (sc) => {
        const p = getBrand(sc.ctx.db, sc.brandId).profile;
        const c = pack(sc, `${sc.input.goal} ${p.niche} ${p.topicsOfExpertise.join(" ")} ${p.audiences.flatMap((a) => a.problems).join(" ")}`, { evidenceLimit: 40 });
        const res = await sc.generate({
          purpose: "strategy.synthesis", tier: "strong", system: system("strategy"), maxTokens: 16000, effort: "high",
          prompt: `${c.text}\n\nTASK: Build a ${sc.input.horizonDays}-day content strategy. Goal: ${sc.input.goal || p.objective || "not stated — state your assumption"}.\nMissing brand info: ${sc.state.missing?.join(", ") || "none"} (list related assumptions).\nToday: ${new Date().toISOString().slice(0, 10)}. Review dates must be real dates.`,
          schema: StrategyDraft,
          offline: () => off.offlineStrategy(c, sc.input.goal, sc.input.horizonDays),
        });
        sc.state.draft = res.data;
        sc.state.generatedBy = res.model;
      },
    },
    {
      name: "validate",
      label: "Validate (deterministic) & revise once",
      run: async (sc) => {
        const p = getBrand(sc.ctx.db, sc.brandId).profile;
        let issues = validateStrategy(sc.state.draft!, p);
        const errors = issues.filter((i) => i.level === "error");
        if (errors.length && sc.ctx.model().live) {
          sc.note(`Revising once to fix: ${errors.map((e) => e.message).join(" | ")}`);
          const res = await sc.generate({
            purpose: "strategy.revision", tier: "strong", system: system("strategy"), maxTokens: 16000, schema: StrategyDraft,
            prompt: `Fix these validation errors and return the full corrected strategy. Do not change anything else.\nERRORS:\n${errors.map((e) => `- ${e.message}`).join("\n")}\n\nSTRATEGY:\n${JSON.stringify(sc.state.draft)}`,
            offline: () => sc.state.draft!,
          });
          sc.state.draft = res.data;
          issues = validateStrategy(res.data, p);
        }
        sc.state.issues = issues;
        issues.forEach((i) => sc.note(`${i.level === "error" ? "Error" : "Warning"}: ${i.message}`));
        pushSummary(sc.state, "validate", `${issues.filter((i) => i.level === "error").length} error(s), ${issues.filter((i) => i.level === "warning").length} warning(s).`);
      },
    },
    {
      name: "save",
      label: "Save draft strategy",
      run: async (sc) => {
        const p = getBrand(sc.ctx.db, sc.brandId).profile;
        if (!sc.state.strategyId) sc.state.strategyId = saveStrategyDraft(sc.ctx.db, sc.brandId, sc.state.draft!, sc.state.generatedBy ?? "agent", p, sc.runId).id;
        pushSummary(sc.state, "save", "Draft strategy saved (not yet active).");
      },
    },
    {
      name: "approval",
      label: "Your approval to activate",
      run: async (sc) => {
        if (!sc.input.applyOnApproval) return;
        const errors = (sc.state.issues ?? []).filter((i) => i.level === "error");
        return {
          awaitApproval: {
            message: errors.length
              ? "The draft has validation errors — edit it in Strategy Studio, then approve there. Approving here will fail until fixed."
              : "Approving activates this strategy: its pillars, topic clusters and series replace the current active ones. Positioning/pillars never change without this step.",
            payload: { strategyId: sc.state.strategyId, pillars: sc.state.draft!.pillars.map((p) => p.name), cadence: sc.state.draft!.cadence.summary, warnings: (sc.state.issues ?? []).filter((i) => i.level === "warning").map((i) => i.message) },
          },
        };
      },
      onApprove: async (sc) => {
        approveStrategy(sc.ctx.db, sc.state.strategyId!, { acknowledgeWarnings: true });
      },
    },
  ],
  output: (s) => ({ strategyId: s.strategyId, pillars: s.draft?.pillars.map((p) => p.name), issues: s.issues, summary: s.draft?.executiveSummary }),
};

// ====================== generate_ideas ======================
const IdeasIn = z.object({ count: z.number().int().min(1).max(20).default(8), pillarId: z.string().nullable().default(null), platform: Platform.nullable().default(null), campaignId: z.string().nullable().default(null), focus: z.string().max(500).default("") });
interface IdeasState { missing?: string[]; batch?: IdeaBatch; evidenceMap?: string[]; ideaIds?: string[]; skipped?: string[]; summaries?: Record<string, string> }

export const ideasTask: TaskDef<z.infer<typeof IdeasIn>, IdeasState> = {
  task: "generate_ideas",
  input: IdeasIn,
  initialState: () => ({}),
  steps: [
    intakeStep(),
    {
      name: "ideate",
      label: "Generate candidate ideas",
      run: async (sc) => {
        const c = pack(sc, sc.input.focus.trim() || getBrand(sc.ctx.db, sc.brandId).profile.niche, { evidenceLimit: 30 });
        sc.state.evidenceMap = c.evidence.map((e) => e.id);
        const existing = listContent(sc.ctx.db, sc.brandId).slice(0, 40).map((x: any) => `- ${x.title}`).join("\n");
        const series = listSeries(sc.ctx.db, sc.brandId).map((s: any) => s.name).join(", ");
        const res = await sc.generate({
          purpose: "ideas.generate", tier: "strong", system: system("ideas"), maxTokens: 12000,
          prompt: `${c.text}\n\nEXISTING CONTENT (avoid duplicates):\n${existing || "(none)"}\nEXISTING SERIES: ${series || "(none)"}\n\nTASK: Propose ${sc.input.count} distinct ideas${sc.input.platform ? ` for ${sc.input.platform}` : ""}${sc.input.pillarId ? ` in pillar "${c.pillars.find((p) => p.id === sc.input.pillarId)?.name}"` : ""}${sc.input.focus ? ` focused on: ${sc.input.focus}` : ""}. Use pillar names exactly as listed. Group into series where natural.`,
          schema: IdeaBatch,
          offline: () => off.offlineIdeas(c, sc.input.count, { platform: sc.input.platform, pillarId: sc.input.pillarId }),
        });
        sc.state.batch = res.data;
        pushSummary(sc.state, "ideate", `${res.data.ideas.length} candidate(s).`);
      },
    },
    {
      name: "dedupe_score_save",
      label: "De-duplicate, score & save",
      run: async (sc) => {
        if (sc.state.ideaIds) return;
        const { db } = sc.ctx;
        const settings = sc.ctx.settings();
        const pillars = db.all<{ id: string; name: string }>("SELECT id, name FROM pillars WHERE brand_id = ? AND active = 1", sc.brandId);
        const corpus = db.all<{ id: string; text: string }>("SELECT id, title || ' ' || angle AS text FROM ideas WHERE brand_id = ? AND status != 'ARCHIVED'", sc.brandId).concat(db.all("SELECT id, title AS text FROM content_items WHERE brand_id = ?", sc.brandId));
        const ids: string[] = [];
        const skipped: string[] = [];
        const accepted: { id: string; text: string }[] = [];
        const seriesByName = new Map<string, string>(listSeries(db, sc.brandId).map((s: any) => [s.name.toLowerCase(), s.id]));
        for (const idea of sc.state.batch!.ideas) {
          const text = `${idea.title} ${idea.angle}`;
          const dup = findNearDuplicates(text, [...corpus, ...accepted], 0.7)[0];
          if (dup) {
            skipped.push(`“${truncate(idea.title, 60)}” (${Math.round(dup.similarity * 100)}% similar to existing)`);
            continue;
          }
          let seriesId: string | null = null;
          if (idea.seriesName.trim()) {
            seriesId = seriesByName.get(idea.seriesName.toLowerCase()) ?? null;
            if (!seriesId) {
              seriesId = addSeries(db, sc.brandId, { name: idea.seriesName, premise: "Proposed by the agent — edit the premise.", format: idea.format }).id;
              seriesByName.set(idea.seriesName.toLowerCase(), seriesId!);
            }
          }
          const ratings = Object.fromEntries(Object.entries(idea.ratings)) as Record<OpportunityDimension, number | null>;
          const evidenceIds = idea.evidenceRefs.map((i) => sc.state.evidenceMap![i]).filter(Boolean);
          const created = createIdea(db, sc.brandId, {
            title: idea.title, angle: idea.angle, rationale: `${idea.rationale}${idea.whyDifferent ? `\n\nWhy different: ${idea.whyDifferent}` : ""}`,
            pillarId: pillars.find((p) => p.name.toLowerCase() === idea.pillarName.toLowerCase())?.id ?? sc.input.pillarId ?? null,
            seriesId, campaignId: sc.input.campaignId, audience: idea.audience, platform: idea.platform, format: idea.format, funnelStage: idea.funnelStage,
            effort: idea.effort, source: "agent", evidenceIds, ratings, ratingReasons: idea.ratingReasons,
            notes: sc.ctx.model().live ? "" : "Offline scaffold idea — refine the angle before briefing.",
          }, settings, "agent");
          ids.push(created.id);
          accepted.push({ id: created.id, text });
        }
        sc.state.ideaIds = ids;
        sc.state.skipped = skipped;
        if (skipped.length) sc.note(`Skipped ${skipped.length} near-duplicate(s): ${skipped.slice(0, 3).join("; ")}`);
        pushSummary(sc.state, "dedupe_score_save", `Saved ${ids.length} idea(s); skipped ${skipped.length} duplicate(s).`);
      },
    },
  ],
  output: (s) => ({ ideaIds: s.ideaIds, skipped: s.skipped }),
};

// ====================== create_brief ======================
const BriefIn = z.object({ ideaId: z.string() });
interface BriefState { missing?: string[]; brief?: BriefData; briefId?: string; generatedBy?: string; summaries?: Record<string, string> }

export const briefTask: TaskDef<z.infer<typeof BriefIn>, BriefState> = {
  task: "create_brief",
  input: BriefIn,
  initialState: () => ({}),
  steps: [
    intakeStep(),
    {
      name: "brief",
      label: "Write the brief",
      run: async (sc) => {
        const idea = getIdea(sc.ctx.db, sc.input.ideaId, sc.ctx.settings());
        const c = pack(sc, `${idea.title} ${idea.angle}`, { evidenceLimit: 15 });
        const linked = (idea.evidenceIds as string[]).map((id) => sc.ctx.db.get("SELECT e.claim, s.title, s.publisher, s.url FROM evidence_items e LEFT JOIN sources s ON s.id = e.source_id WHERE e.id = ?", id)).filter(Boolean) as any[];
        const linkedEv = linked.map((e) => ({ claim: e.claim, source: e.title ? `${e.title}${e.publisher ? ` — ${e.publisher}` : ""}` : "", url: e.url ?? "" }));
        const res = await sc.generate({
          purpose: "brief.generate", tier: "strong", system: system("brief"), maxTokens: 8000,
          prompt: `${c.text}\n\nIDEA:\n${JSON.stringify({ title: idea.title, angle: idea.angle, rationale: idea.rationale, pillar: idea.pillarName, audience: idea.audience, platform: idea.platform, format: idea.format, funnelStage: idea.funnelStage })}\nLINKED EVIDENCE:\n${linkedEv.map((e, i) => `${i + 1}. ${e.claim} — ${e.source || "no source"} ${e.url}`).join("\n") || "(none)"}\n\nPlatform constraints: ${idea.platform ? JSON.stringify(PLATFORM_SPECS[idea.platform as Platform]) : "choose the best platform"}`,
          schema: BriefData,
          offline: () => off.offlineBrief(idea, c, linkedEv),
        });
        // Deterministic honesty: proof can only be "researched" if the idea has linked, sourced evidence.
        const hasSourced = linkedEv.some((e) => e.source);
        const data: BriefData = { ...res.data, proof: res.data.proof.map((p) => (p.origin === "researched" && !hasSourced ? { ...p, origin: "needs_verification" as const } : p)) };
        sc.state.brief = data;
        sc.state.generatedBy = res.model;
      },
    },
    {
      name: "save",
      label: "Save brief",
      run: async (sc) => {
        if (!sc.state.briefId) sc.state.briefId = createBrief(sc.ctx.db, sc.brandId, sc.state.brief!, { ideaId: sc.input.ideaId, generatedBy: sc.state.generatedBy }).id;
        const unverified = sc.state.brief!.proof.filter((p) => p.origin === "needs_verification").length;
        if (unverified) sc.note(`${unverified} proof point(s) need verification before drafting.`);
        pushSummary(sc.state, "save", "Brief saved.");
      },
    },
  ],
  output: (s) => ({ briefId: s.briefId, title: s.brief?.workingTitle }),
};

// ====================== create_drafts ======================
const Target = z.object({ platform: Platform, format: Format.optional() });
const DraftsIn = z.object({ briefId: z.string(), targets: z.array(Target).min(1).max(6), options: DraftOptions.default({ voiceStrength: "balanced", readingLevel: "standard", length: "medium", creativity: "balanced", variants: 2 }), campaignId: z.string().nullable().default(null) });
interface DraftsState { missing?: string[]; items: { contentItemId: string; platform: string; format: string; variantIds: string[] }[]; qa: Record<string, { score: number; passed: boolean; blockers: number }>; revisions: number; summaries?: Record<string, string> }
const DraftSet = z.object({ variants: z.array(DraftOutput) });

export const draftsTask: TaskDef<z.infer<typeof DraftsIn>, DraftsState> = {
  task: "create_drafts",
  input: DraftsIn,
  initialState: () => ({ items: [], qa: {}, revisions: 0 }),
  steps: [
    intakeStep(),
    {
      name: "draft",
      label: "Draft platform-native variants",
      run: async (sc) => {
        const brief = getBrief(sc.ctx.db, sc.input.briefId);
        const data = brief.data as BriefData;
        const c = pack(sc, `${data.workingTitle} ${data.coreThesis}`, { evidenceLimit: 10, includeAnalytics: false });
        for (const t of sc.input.targets) {
          if (sc.state.items.some((i) => i.platform === t.platform)) continue; // resumable: skip done targets
          if (sc.isCancelled()) return;
          const format = t.format ?? PLATFORM_SPECS[t.platform].defaultFormat;
          const o = sc.input.options;
          const res = await sc.generate({
            purpose: "draft.generate", tier: "strong", system: system("draft"), maxTokens: 16000,
            prompt: `${c.text}\n\nAPPROVED BRIEF:\n${JSON.stringify(data)}\n\nTARGET: ${PLATFORM_SPECS[t.platform].label} — ${format}. Platform notes: ${PLATFORM_SPECS[t.platform].notes.join(" ")} Limits: ${JSON.stringify(PLATFORM_SPECS[t.platform].limits)}.\nOPTIONS: voice strength ${o.voiceStrength}; reading level ${o.readingLevel}; length ${o.length}; creativity ${o.creativity}.\nWrite ${o.variants} variant(s) with genuinely different angles or structures.`,
            schema: DraftSet,
            offline: () => ({ variants: off.offlineDrafts(data, t.platform, format, c, o.variants) }),
          });
          const variants = res.data.variants.slice(0, o.variants);
          if (!variants.length) throw new Error("Model returned no variants.");
          const tz = getBrand(sc.ctx.db, sc.brandId).profile.timezone || sc.ctx.settings().timezone;
          const item = createContentItem(sc.ctx.db, sc.brandId, { title: data.workingTitle, platform: t.platform, format, briefId: brief.id, ideaId: brief.ideaId, campaignId: sc.input.campaignId, timezone: tz }, { fields: variants[0].fields, angleLabel: variants[0].angleLabel, rationale: variants[0].rationale, generatedBy: res.model });
          const variantIds = [item.currentVariantId];
          for (const v of variants.slice(1)) variantIds.push(addVariant(sc.ctx.db, item.id, { fields: v.fields, angleLabel: v.angleLabel, rationale: v.rationale, generatedBy: res.model }));
          // keep the first variant as current
          sc.ctx.db.update("content_items", item.id, { current_variant_id: variantIds[0] });
          sc.state.items.push({ contentItemId: item.id, platform: t.platform, format, variantIds });
          sc.note(`${PLATFORM_SPECS[t.platform].label}: ${variantIds.length} variant(s).`);
        }
      },
    },
    {
      name: "qa",
      label: "QA review & bounded revision",
      run: async (sc) => {
        const maxLoops = sc.ctx.settings().maxRevisionLoops;
        const live = sc.ctx.model().live;
        for (const it of sc.state.items) {
          if (sc.state.qa[it.contentItemId]) continue;
          let current = getContentItem(sc.ctx.db, it.contentItemId).currentVariantId as string;
          let { result } = await reviewVariant(sc.ctx, it.contentItemId, current, { useModel: live, generate: sc.generate });
          for (let loop = 0; live && loop < maxLoops && (!result.passed || result.score < sc.ctx.settings().qaPassScore); loop++) {
            const item = getContentItem(sc.ctx.db, it.contentItemId);
            const v = item.variants.find((x: any) => x.id === current);
            const brief = getBrief(sc.ctx.db, sc.input.briefId).data as BriefData;
            const rev = await reviseDraft(sc.ctx, sc.generate, { brandId: sc.brandId, brief, platform: item.platform, format: item.format, fields: normaliseFields(v.fields), qa: result as QaResult });
            current = addVariant(sc.ctx.db, it.contentItemId, { fields: rev.data.fields, angleLabel: `${v.angleLabel} (revised ${loop + 1})`, rationale: rev.data.rationale, generatedBy: rev.model, parentVariantId: v.id, feedback: result.revisionInstructions.slice(0, 2000) });
            it.variantIds.push(current);
            sc.state.revisions++;
            ({ result } = await reviewVariant(sc.ctx, it.contentItemId, current, { useModel: true, generate: sc.generate }));
          }
          if (!result.passed) sc.note(`${PLATFORM_SPECS[it.platform as Platform].label}: ${result.blockers} blocker(s) remain — ${live ? "surfaced for you to fix instead of looping further" : "offline scaffolds need your edits"}.`);
          sc.state.qa[it.contentItemId] = { score: result.score, passed: result.passed, blockers: result.blockers };
        }
        pushSummary(sc.state, "qa", `${Object.values(sc.state.qa).filter((q) => q.passed).length}/${sc.state.items.length} item(s) passed QA; ${sc.state.revisions} revision(s).`);
      },
    },
  ],
  output: (s) => ({ items: s.items, qa: s.qa, revisions: s.revisions }),
};

// ====================== review_draft ======================
const ReviewIn = z.object({ contentItemId: z.string(), variantId: z.string().optional() });
export const reviewTask: TaskDef<z.infer<typeof ReviewIn>, { reviewId?: string; score?: number; passed?: boolean; summaries?: Record<string, string> }> = {
  task: "review_draft",
  input: ReviewIn,
  initialState: () => ({}),
  steps: [
    {
      name: "qa",
      label: "Run QA checklist & rubric",
      run: async (sc) => {
        const { review, result } = await reviewVariant(sc.ctx, sc.input.contentItemId, sc.input.variantId, { useModel: sc.ctx.model().live, generate: sc.generate });
        Object.assign(sc.state, { reviewId: review.id, score: result.score, passed: result.passed });
        pushSummary(sc.state, "qa", `Score ${result.score}; ${result.blockers} blocker(s), ${result.warnings} warning(s).`);
      },
    },
  ],
  output: (s) => s,
};

// ====================== repurpose_transcript ======================
const RepurposeIn = z.object({ assetId: z.string(), maxMoments: z.number().int().min(1).max(8).default(4), platform: Platform.default("youtube_shorts") });
interface RepurposeState { moments?: MomentExtraction["moments"]; items: string[]; summaries?: Record<string, string> }
export const repurposeTask: TaskDef<z.infer<typeof RepurposeIn>, RepurposeState> = {
  task: "repurpose_transcript",
  input: RepurposeIn,
  initialState: () => ({ items: [] }),
  steps: [
    {
      name: "rights",
      label: "Check source rights",
      run: async (sc) => {
        const a = getAsset(sc.ctx.db, sc.input.assetId);
        if (!a.textContent?.trim()) throw new Error("This asset has no transcript/text. Paste or upload the transcript first.");
        if (a.rights === "unknown") sc.note("Rights are UNKNOWN for this source. Derivatives will be blocked at QA until you confirm ownership/licence.");
        pushSummary(sc.state, "rights", `Source rights: ${a.rights}.`);
      },
    },
    {
      name: "extract",
      label: "Find clip-worthy moments",
      run: async (sc) => {
        const a = getAsset(sc.ctx.db, sc.input.assetId);
        const p = getBrand(sc.ctx.db, sc.brandId).profile;
        const res = await sc.generate({
          purpose: "repurpose.extract", tier: "strong", system: system("repurpose"), maxTokens: 8000,
          prompt: `Brand: ${p.name}; audience: ${p.audiences.map((x) => x.name).join(", ")}.\nFind up to ${sc.input.maxMoments} self-contained moments for ${sc.input.platform}.\n\nTRANSCRIPT (user-owned asset "${a.title}"):\n${fenceUntrusted(a.title, a.textContent, 60000)}`,
          schema: MomentExtraction,
          offline: () => off.offlineMoments(a.textContent, sc.input.maxMoments),
        });
        sc.state.moments = res.data.moments.slice(0, sc.input.maxMoments);
        pushSummary(sc.state, "extract", `${sc.state.moments.length} moment(s) found.`);
      },
    },
    {
      name: "derive",
      label: "Create derivative drafts with lineage",
      run: async (sc) => {
        const a = getAsset(sc.ctx.db, sc.input.assetId);
        for (const [i, m] of sc.state.moments!.entries()) {
          if (i < sc.state.items.length) continue;
          const platform = sc.input.platform;
          const format = PLATFORM_SPECS[platform].defaultFormat;
          const fields: Partial<DraftFields> = {
            titleOptions: [truncate(m.label, 90)],
            hooks: [truncate(m.quote.split(/(?<=[.!?])\s/)[0] ?? m.label, 140)],
            body: `[${m.start} → ${m.end}] ${m.quote}`,
            caption: "",
            productionNotes: `Clip from your own file “${a.title}” ${m.start}–${m.end}. Context to add: ${m.contextNeeded}. Why it works: ${m.whyItWorks}. Edit from your original file; do not download from a platform.`,
            beats: [{ beat: "Context line", visual: "Text overlay", seconds: 2 }, { beat: m.quote.slice(0, 200), visual: "Source clip (vertical reframe)", seconds: null }, { beat: "Payoff / CTA", visual: "End card", seconds: 3 }],
            targetLength: "15–60 seconds",
            claimsToVerify: [],
          };
          const item = createContentItem(sc.ctx.db, sc.brandId, { title: `Clip: ${truncate(m.label, 80)}`, platform, format }, { fields, angleLabel: "Clip from source", rationale: m.whyItWorks, generatedBy: sc.ctx.model().live ? sc.ctx.model().models.strong : "offline-scaffold" });
          addLineage(sc.ctx.db, sc.brandId, { sourceAssetId: a.id, derivativeContentItemId: item.id, segmentStart: m.start, segmentEnd: m.end, quote: m.quote, note: m.contextNeeded });
          sc.state.items.push(item.id);
          await reviewVariant(sc.ctx, item.id, undefined, { useModel: false });
        }
        pushSummary(sc.state, "derive", `${sc.state.items.length} derivative draft(s) linked to “${a.title}”.`);
      },
    },
  ],
  output: (s) => ({ contentItemIds: s.items, moments: s.moments }),
};

// ====================== plan_calendar ======================
const PlanIn = z.object({ weeks: z.number().int().min(1).max(8).default(2), startDate: z.string().default(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10)), hourUtc: z.number().int().min(0).max(23).default(15) });
interface PlanState { proposal?: { contentItemId: string; title: string; platform: string; scheduledAt: string; basis: "own_history" | "hypothesis"; rationale: string; status: string }[]; written?: number; summaries?: Record<string, string> }
export const planTask: TaskDef<z.infer<typeof PlanIn>, PlanState> = {
  task: "plan_calendar",
  input: PlanIn,
  initialState: () => ({}),
  steps: [
    {
      name: "propose",
      label: "Propose schedule from cadence & own history",
      run: async (sc) => {
        const { db } = sc.ctx;
        const unplanned = db.all("SELECT c.id, c.title, c.platform, c.status FROM content_items c WHERE c.brand_id = ? AND c.status IN ('DRAFT','QA','REVIEW','APPROVED') AND NOT EXISTS (SELECT 1 FROM calendar_entries e WHERE e.content_item_id = c.id) ORDER BY CASE c.status WHEN 'APPROVED' THEN 0 WHEN 'REVIEW' THEN 1 ELSE 2 END, c.created_at", sc.brandId);
        const strategy = db.get("SELECT data_json FROM strategy_versions WHERE brand_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1", sc.brandId);
        const perWeek = new Map<string, number>(((strategy ? JSON.parse(strategy.data_json).cadence?.perWeek : []) ?? []).map((x: any) => [x.platform, x.count]));
        const byPlatform = new Map<string, any[]>();
        unplanned.forEach((u) => byPlatform.set(u.platform, [...(byPlatform.get(u.platform) ?? []), u]));
        const proposal: NonNullable<PlanState["proposal"]> = [];
        for (const [platform, items] of byPlatform) {
          const cadence = perWeek.get(platform) ?? 1;
          const n = Math.min(items.length, cadence * sc.input.weeks);
          const { slots, basis, rationale } = suggestSlots(db, sc.brandId, platform, n, `${sc.input.startDate}T00:00:00Z`, sc.input.hourUtc);
          items.slice(0, slots.length).forEach((it, i) => proposal.push({ contentItemId: it.id, title: it.title, platform, scheduledAt: slots[i], basis, rationale, status: it.status }));
          if (items.length > n) sc.note(`${platform}: ${items.length - n} item(s) left unplanned to respect the ${cadence}/week cadence.`);
        }
        sc.state.proposal = proposal.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        pushSummary(sc.state, "propose", `${proposal.length} slot(s) proposed.`);
      },
    },
    {
      name: "approval",
      label: "Your approval to write the calendar",
      run: async (sc) => {
        if (!sc.state.proposal?.length) return;
        return { awaitApproval: { message: "Approve to add these planned dates to your calendar. Planning does not schedule or publish anything; content still needs QA + approval.", payload: sc.state.proposal } };
      },
      onApprove: async (sc) => {
        const tz = getBrand(sc.ctx.db, sc.brandId).profile.timezone || sc.ctx.settings().timezone;
        sc.ctx.db.tx(() => {
          for (const p of sc.state.proposal ?? []) addEntry(sc.ctx.db, sc.brandId, { contentItemId: p.contentItemId, scheduledAt: p.scheduledAt, timezone: tz, suggestionBasis: p.basis, notes: p.rationale });
        });
        sc.state.written = sc.state.proposal?.length ?? 0;
      },
    },
  ],
  output: (s) => ({ proposed: s.proposal?.length ?? 0, written: s.written ?? 0 }),
};

// ====================== analyze_performance ======================
const AnalyzeIn = z.object({ platform: Platform.nullable().default(null) });
interface AnalyzeState { narrative?: AnalyticsNarrative; applied?: boolean; summaries?: Record<string, string> }
export const analyzeTask: TaskDef<z.infer<typeof AnalyzeIn>, AnalyzeState> = {
  task: "analyze_performance",
  input: AnalyzeIn,
  initialState: () => ({}),
  steps: [
    {
      name: "analyze",
      label: "Compare with own baseline & interpret",
      run: async (sc) => {
        const a = analyze(sc.ctx.db, sc.brandId, sc.input.platform ? { platform: sc.input.platform } : {});
        if (!a.platforms.length) throw new Error("No analytics imported yet. Import a CSV in the Analytics Lab first.");
        const p = getBrand(sc.ctx.db, sc.brandId).profile;
        const compact = a.platforms.map((pl) => ({ platform: pl.platform, n: pl.n, window: pl.window, primary: pl.primaryMetric, baseline: pl.baseline, segments: pl.segments, insights: pl.insights, posts: pl.posts.slice(0, 40).map((x) => ({ title: x.title, format: x.format, pillar: x.pillar, verdict: x.verdict, vs: x.vsBaseline })) }));
        const res = await sc.generate({
          purpose: "analytics.narrative", tier: "strong", system: system("analytics"), maxTokens: 6000,
          prompt: `Brand objective: ${p.objective || "not stated"}.\nDETERMINISTIC ANALYSIS (own-account data; ratios are vs the same platform's median):\n${JSON.stringify(compact)}`,
          schema: AnalyticsNarrative,
          offline: () => off.offlineNarrative(a.platforms),
        });
        sc.state.narrative = res.data;
        pushSummary(sc.state, "analyze", res.data.headline);
      },
    },
    {
      name: "approval",
      label: "Approve experiments & learnings",
      run: async (sc) => {
        const n = sc.state.narrative!;
        if (!n.nextExperiments.length && !n.memoryCandidates.length) return;
        return { awaitApproval: { message: "Approve to add these experiments (as planned) and learnings (to brand memory). Weak signals are not turned into brand truth without you.", payload: { experiments: n.nextExperiments, learnings: n.memoryCandidates } } };
      },
      onApprove: async (sc) => {
        const n = sc.state.narrative!;
        for (const e of n.nextExperiments) upsertExperiment(sc.ctx.db, sc.brandId, { hypothesis: e.hypothesis, variable: e.variable, targetMetric: e.metric, successThreshold: e.threshold, status: "planned" });
        for (const m of n.memoryCandidates) addMemory(sc.ctx.db, sc.brandId, { layer: "content", statement: m.statement, sourceType: "analytics", sourceRef: `run:${sc.runId}`, confidence: m.confidence, status: "approved" });
        sc.state.applied = true;
      },
    },
  ],
  output: (s) => ({ narrative: s.narrative, applied: !!s.applied }),
};

// ====================== ask ======================
const AskIn = z.object({ question: z.string().min(3).max(4000) });
export const askTask: TaskDef<z.infer<typeof AskIn>, { answer?: AnswerOutput; citations?: string[]; summaries?: Record<string, string> }> = {
  task: "ask",
  input: AskIn,
  initialState: () => ({}),
  steps: [
    {
      name: "answer",
      label: "Retrieve context & answer",
      run: async (sc) => {
        const c = pack(sc, sc.input.question, { evidenceLimit: 20, snippetLimit: 6 });
        const res = await sc.generate({
          purpose: "ask", tier: "strong", system: system("ask"), maxTokens: 6000,
          prompt: `${c.text}\n\nUSER QUESTION:\n${sc.input.question}`,
          schema: AnswerOutput,
          offline: () => off.offlineAnswer(sc.input.question, c, commandCenter(sc.ctx, sc.brandId).nextActions),
        });
        sc.state.answer = res.data;
        sc.state.citations = c.snippets.map((s) => s.citation);
      },
    },
  ],
  output: (s) => ({ ...s.answer, retrievedDocs: s.citations }),
};

export function registerTasks(engine: WorkflowEngine) {
  [researchTask, strategyTask, ideasTask, briefTask, draftsTask, reviewTask, repurposeTask, planTask, analyzeTask, askTask].forEach((t) => engine.register(t as any));
}
