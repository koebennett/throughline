import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { makeApp, MockProvider, PROFILE, waitFor } from "../helpers/setup.js";
import { ModelOutputError } from "../../src/server/providers/model/types.js";
import { updateSettings } from "../../src/server/services/settings.js";

async function setup(model: MockProvider) {
  const t = makeApp(model);
  const b = await t.call("POST", "/api/brands", PROFILE);
  return { ...t, brandId: b.body.id as string };
}
const run = async (t: Awaited<ReturnType<typeof setup>>, task: string, input: unknown) => {
  const id = t.engine.create(task, input, t.brandId);
  await t.engine.execute(id);
  return t.engine.get(id);
};
const goodDraft = (hook: string) => ({ angleLabel: "A", rationale: "r", fields: { titleOptions: ["Buffer accounts for irregular income"], hooks: [hook], body: `${hook}\nUse a buffer account and pay yourself a fixed salary.\n1. One account\n2. Fixed pay\n3. Tax pot`, caption: "", description: "Buffer accounts explained.", chapters: [], slides: [], beats: [], hashtags: [], cta: "Join the newsletter", thumbnailConcepts: [], visualPrompts: [], pinnedComment: "", seoTitle: "", metaDescription: "", productionNotes: "", targetLength: "", claimsToVerify: [] } });

describe("workflow engine", () => {
  it("brand context reaches the model prompt (onboarding data is actually used)", async () => {
    const m = new MockProvider();
    const t = await setup(m);
    await run(t, "ask", { question: "What should I post next week?" });
    const prompt = m.calls.find((c) => c.purpose === "ask")!.prompt;
    expect(prompt).toContain("irregular income makes budgeting hard");
    expect(prompt).toContain("Systems built for irregular income");
    expect(prompt).toContain("Avoid: hack");
  });

  it("retries transient errors with backoff, but never retries schema failures", async () => {
    const m = new MockProvider();
    const t = await setup(m);
    m.failNext = [new Anthropic.APIConnectionError({ message: "socket hang up" })];
    const ok = await run(t, "ask", { question: "Next steps?" });
    expect(ok.status).toBe("succeeded");
    expect(ok.steps[0].attempts).toBe(2);
    m.failNext = [new ModelOutputError("bad schema")];
    const bad = await run(t, "ask", { question: "Next steps?" });
    expect(bad.status).toBe("failed");
    expect(bad.steps[0].attempts).toBe(1);
    expect(bad.error).toMatch(/bad schema/);
    // Retry from the failed step works and keeps completed work.
    const retried = await t.engine.resume(bad.id, true);
    expect(retried.status).toBe("succeeded");
  });

  it("enforces the per-run budget and records usage", async () => {
    const m = new MockProvider({}, 0.6);
    const t = await setup(m);
    updateSettings(t.db, { runBudgetUsd: 1 });
    const r = await run(t, "create_drafts", { briefId: "missing", targets: [{ platform: "youtube" }] });
    expect(r.status).toBe("failed"); // missing brief: proves validation errors fail cleanly
    const brief = await t.call("POST", `/api/brands/${t.brandId}/briefs`, { data: { workingTitle: "T", objective: "o", targetAudience: "a", audienceProblem: "p", desiredTakeaway: "d", coreThesis: "c", originalAngle: "x", hooks: ["h"], promise: "p", outline: [], talkingPoints: [], proof: [], requiredAssets: [], visualDirection: "", sourceLinks: [], rightsNotes: "", cta: "", disclosures: [], platform: "youtube", format: "long_video", constraints: "", searchIntent: "", kpi: "", risks: [], assumptions: [], factCheck: [], sponsored: false } });
    const r2 = await run(t, "create_drafts", { briefId: brief.body.id, targets: [{ platform: "youtube" }, { platform: "linkedin" }, { platform: "x" }], options: { variants: 1 } });
    expect(r2.status).toBe("failed");
    expect(r2.error).toMatch(/budget/i);
    expect(r2.costUsd).toBeGreaterThanOrEqual(1);
    expect(t.db.get("SELECT count(*) AS n FROM usage_records")!.n).toBeGreaterThan(0);
    // Work done before the budget stop is preserved.
    expect(r2.state.items.length).toBeGreaterThan(0);
  });

  it("supports pause, resume, cancel and recovers interrupted runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = new MockProvider({ ask: async () => (await gate, undefined) as any });
    m.handlers.ask = undefined as any;
    const t = await setup(m);
    const origGenerate = m.generate.bind(m);
    m.generate = async (req) => (req.purpose === "strategy.synthesis" ? (await gate, origGenerate(req)) : origGenerate(req));
    const id = t.engine.create("build_strategy", {}, t.brandId);
    const p = t.engine.execute(id);
    await waitFor(() => t.engine.get(id), (r) => r.steps[1].status === "running");
    t.engine.pause(id);
    release();
    await p;
    expect(t.engine.get(id).status).toBe("paused");
    const resumed = await t.engine.resume(id, true);
    expect(resumed.status).toBe("awaiting_approval");
    const rejected = await t.engine.decide(id, "reject", "not now");
    expect(rejected.status).toBe("cancelled");
    expect(t.db.get("SELECT count(*) AS n FROM pillars")!.n).toBe(0); // nothing applied

    const id2 = t.engine.create("ask", { question: "hi there" }, t.brandId);
    t.db.update("agent_runs", id2, { status: "running" });
    expect(t.engine.recoverInterrupted()).toBe(1);
    expect(t.engine.get(id2).status).toBe("interrupted");
    expect((await t.engine.resume(id2, true)).status).toBe("succeeded");
    expect(() => t.engine.cancel(id2)).toThrow(/already succeeded/);
  });

  it("live drafting runs QA with model judgement and at most N bounded revisions", async () => {
    let revisions = 0;
    const m = new MockProvider({
      "draft.generate": () => ({ variants: [goodDraft("This is guaranteed to fix your money.")] }),
      "qa.judgement": () => ({ dimensions: Object.fromEntries(["audienceValue", "originality", "clarityHook", "evidenceAccuracy", "brandFit", "platformFit", "narrative", "ctaAlignment"].map((d) => [d, { score: 4, reason: "ok" }])), issues: [], revisionInstructions: "Remove the guarantee." }),
      "draft.revision": () => (revisions++, goodDraft(revisions === 1 ? "Still guaranteed." : "Irregular income breaks normal budgets.")),
    });
    const t = await setup(m);
    const brief = await t.call("POST", `/api/brands/${t.brandId}/briefs`, { data: { workingTitle: "Buffer accounts", objective: "o", targetAudience: "New freelancers", audienceProblem: "irregular income", desiredTakeaway: "d", coreThesis: "c", originalAngle: "buffer account", hooks: ["h"], promise: "p", outline: [], talkingPoints: [], proof: [], requiredAssets: [], visualDirection: "", sourceLinks: [], rightsNotes: "", cta: "Join the newsletter", disclosures: [], platform: "youtube", format: "long_video", constraints: "", searchIntent: "", kpi: "", risks: [], assumptions: [], factCheck: [], sponsored: false } });
    const r = await run(t, "create_drafts", { briefId: brief.body.id, targets: [{ platform: "youtube" }], options: { variants: 1 } });
    expect(r.status).toBe("succeeded");
    expect(r.output.revisions).toBe(2);
    expect(r.output.qa[r.output.items[0].contentItemId].passed).toBe(true);
    const item = (await t.call("GET", `/api/content/${r.output.items[0].contentItemId}`)).body;
    expect(item.variants).toHaveLength(3); // original + 2 revisions, lineage via parentVariantId
    expect(item.variants[0].parentVariantId).toBe(item.variants[1].id);
    expect(item.reviews[0].method).toBe("rules+model");
  });

  it("research with live web search saves dated sources and audits evidence", async () => {
    const m = new MockProvider({
      "research.synthesis": () => ({ summary: "s", audienceQuestions: ["How much should I save for tax?"], contentGaps: ["g"], angles: ["a"], openQuestions: [], evidence: [
        { claim: "Freelancers report tax anxiety", kind: "observation", confidence: "medium", sourceIndex: 0, quote: "q" },
        { claim: "Invented stat", kind: "fact", confidence: "high", sourceIndex: 7, quote: "" },
        { claim: "Uncited fact", kind: "fact", confidence: "high", sourceIndex: null, quote: "" },
      ] }),
    });
    m.webResearch = async () => ({ text: "t", model: "claude-opus-5-5", sources: [{ url: "https://example.org/tax-survey", title: "Tax survey", pageAge: "2026-05-01" }], citations: [{ url: "https://example.org/tax-survey", title: "Tax survey", citedText: "Many freelancers worry about tax." }], usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, webSearches: 2, costUsd: 0.02 } });
    const t = await setup(m);
    const r = await run(t, "research_topic", { topic: "freelancer taxes", useWebSearch: true });
    expect(r.status).toBe("succeeded");
    const ev = (await t.call("GET", `/api/brands/${t.brandId}/evidence?run=${r.output.researchRunId}`)).body;
    expect(ev.find((e: any) => e.claim === "Invented stat")).toBeUndefined();
    expect(ev.find((e: any) => e.claim === "Uncited fact").kind).toBe("inference");
    expect(ev.find((e: any) => e.claim === "Freelancers report tax anxiety")).toMatchObject({ kind: "observation", sourceUrl: "https://example.org/tax-survey", sourcePublishedAt: "2026-05-01" });
    expect(r.output.auditNotes.length).toBeGreaterThan(0);
    expect(t.db.get("SELECT sum(web_searches) AS n FROM usage_records")!.n).toBe(2);
  });
});
