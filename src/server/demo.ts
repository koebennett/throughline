// Demo workspace. Everything here is FICTIONAL sample data, created under a brand flagged is_demo and named
// "DEMO · …". It runs the real (offline) pipeline so every screen has something to inspect.
import type { Ctx } from "./context.js";
import type { WorkflowEngine } from "./agent/engine.js";
import { createBrand, listBrands } from "./services/brands.js";
import { addDocument } from "./services/brain.js";
import { addEvidence, addSource } from "./services/research.js";
import { addAsset } from "./services/assets.js";
import { importCsv } from "./services/analytics.js";
import { addVariant, getContentItem, listContent } from "./services/content.js";
import { upsertExperiment } from "./services/experiments.js";
import { upsertCampaign } from "./services/strategy.js";
import { reviewVariant } from "./agent/review.js";
import { OfflineProvider } from "./providers/model/offline.js";

export const DEMO_NAME = "DEMO · Weeknight Kitchen Lab";

export async function seedDemo(ctx: Ctx, engine: WorkflowEngine) {
  const existing = listBrands(ctx.db).find((b) => b.isDemo);
  if (existing) return { brandId: existing.id, created: false };
  const brand = createBrand(
    ctx.db,
    {
      name: DEMO_NAME,
      description: "Fictional demo creator: a home cook who teaches busy people to cook fast, cheap weeknight dinners from a small set of pantry staples.",
      niche: "weeknight home cooking for busy people",
      website: "",
      offer: "Paid weekly meal-plan newsletter ($6/month) with shopping lists",
      monetization: "Newsletter subscriptions; occasional sponsored cookware reviews (always disclosed)",
      objective: "Grow paid newsletter subscribers from YouTube and Shorts viewers",
      geography: "UK & US",
      languages: ["English"],
      audiences: [
        { name: "Time-poor professionals", description: "Work long hours, cook 3–4 nights a week, tired of takeaway.", knowledgeLevel: "beginner", needs: ["dinners under 30 minutes"], problems: ["no energy to plan meals after work", "food waste from half-used ingredients", "recipes need too many special ingredients"], desires: ["a reliable rotation of 10 dinners", "spend less on groceries"], objections: ["meal prep takes my whole Sunday"], language: ["weeknight", "something quick", "what's for dinner"], transformation: "Confidently cooks 4 nights a week from one weekly shop" },
        { name: "New parents", description: "Cooking for a family on little sleep.", knowledgeLevel: "mixed", needs: ["one-pan meals"], problems: ["cooking with a baby in one arm", "picky toddlers"], desires: ["meals the whole family eats"], objections: [], language: ["one pan", "toddler friendly"], transformation: "" },
      ],
      platforms: [
        { platform: "youtube", handle: "@demo-kitchen-lab", url: "", role: "Depth and trust: full recipes and technique", active: true },
        { platform: "youtube_shorts", handle: "@demo-kitchen-lab", url: "", role: "Discovery: one technique per short", active: true },
        { platform: "instagram", handle: "", url: "", role: "Saves: carousel cheat-sheets", active: true },
        { platform: "newsletter", handle: "", url: "", role: "Conversion: the paid meal plan", active: true },
      ],
      capacity: { hoursPerWeek: 10, postsPerWeekTarget: 4, team: "Solo, editor 4h/week", equipment: "Phone + one mirrorless camera, home kitchen", budget: "£100/month", constraints: "Can only film on weekends" },
      voice: { traits: ["warm", "practical", "no-nonsense"], tone: "friendly expert, never preachy", vocabulary: ["pantry staples", "weeknight", "one-pan"], phrasesToUse: ["here's the shortcut"], phrasesToAvoid: ["hack", "game-changer", "you won't believe"], readingLevel: "simple" },
      positioning: "The weeknight cook's shortcut: 10 staples, 30 minutes, no waste.",
      pointOfView: "Most recipe content optimises for impressive food; busy people need repeatable systems.",
      proof: ["Cooked 4 nights a week for 6 years on a 30-minute rule (user-supplied)", "Former line cook (user-supplied)"],
      differentiators: ["Systems over single recipes", "Ingredient-reuse across the week to cut waste"],
      ctas: ["Get this week's meal plan in the newsletter", "Save this for your next shop"],
      compliance: { bannedClaims: ["healthiest", "cures"], requiredDisclosures: ["Sponsored reviews must say 'Paid partnership'"], notes: "No medical or nutrition-health claims." },
      competitors: [{ name: "Generic recipe channels (pattern)", url: "", kind: "reference", notes: "Single impressive recipes, little reuse planning." }],
      likes: ["calm, practical tutorials"],
      dislikes: ["clickbait reaction thumbnails"],
      topicsOfExpertise: ["pantry staples", "one-pan dinners", "reducing food waste"],
      timezone: "Europe/London",
    },
    { isDemo: true, actor: "demo" },
  );
  const b = brand.id;
  addDocument(ctx.db, b, { title: "DEMO offer sheet", kind: "offer", content: "# Weekly meal plan\n\nEvery Friday subscribers get 4 dinners that share ingredients, a single shopping list and prep notes.\n\n## Pricing\n\n$6/month. Cancel any time.\n\n## Who it's for\n\nPeople who want to stop deciding what's for dinner." });
  const t = addAsset(ctx.db, b, {
    kind: "transcript", title: "DEMO transcript — 10 pantry staples video", rights: "owned", rightsNote: "Demo: the creator's own video",
    textContent: "[00:00] If you only keep ten things in your pantry, you can cook dinner every night this week.\n\n[00:45] The biggest mistake people make is buying ingredients for one recipe. Here's the shortcut: buy for three.\n\n[02:10] Tinned tomatoes, chickpeas, rice, onions, garlic, eggs, frozen peas, a hard cheese, chilli flakes and lemons. That's the list.\n\n[04:30] Why does this work? Because every one of these ingredients shows up in at least three dinners, so nothing goes in the bin.\n\n[06:05] Never start a weeknight recipe that needs an ingredient you'll use once. That's the lesson I learned as a line cook.",
  });
  const s1 = addSource(ctx.db, b, { title: "DEMO source — fictional household food-waste survey (not a real publication)", publisher: "Demo data", publishedAt: "2026-06-01", excerpt: "Fictional excerpt for the demo: respondents said planning meals after work is the hardest part of cooking at home.", notes: "Illustrative only — replace with a real source.", provider: "manual" });
  addEvidence(ctx.db, b, { claim: "DEMO: respondents say planning after work is the hardest part of home cooking.", kind: "observation", confidence: "low", sourceId: s1.id, topic: "meal planning" }, "demo");
  addEvidence(ctx.db, b, { claim: "Viewers comment asking for shopping lists on recipe videos (user's own channel observation).", kind: "user_fact", confidence: "medium", topic: "meal planning" }, "demo");
  addEvidence(ctx.db, b, { claim: "Ingredient-reuse framing may differentiate from single-recipe channels.", kind: "hypothesis", confidence: "low", topic: "positioning" }, "demo");
  upsertCampaign(ctx.db, b, { name: "DEMO · January reset", goal: "Newsletter sign-ups from a 'cook from 10 staples' series", kpi: "Newsletter sign-ups per video", startDate: "2027-01-04", endDate: "2027-01-31", status: "planned" });

  // Run the real pipeline offline so the demo never depends on (or spends) an API key.
  const offlineCtx: Ctx = { ...ctx, model: () => new OfflineProvider() };
  const { WorkflowEngine: Engine } = await import("./agent/engine.js");
  const { registerTasks } = await import("./agent/tasks.js");
  const demoEngine = new Engine(offlineCtx);
  registerTasks(demoEngine);
  const run = async (task: string, input: unknown) => {
    const id = demoEngine.create(task, input, b);
    await demoEngine.execute(id);
    const r = demoEngine.get(id);
    if (r.status === "awaiting_approval") await demoEngine.decide(id, "approve", "Demo seed");
    return demoEngine.get(id);
  };
  await run("build_strategy", { goal: "Grow paid newsletter subscribers", horizonDays: 90 });
  const ideasRun = await run("generate_ideas", { count: 6 });
  const firstIdea = (ideasRun.output as any)?.ideaIds?.[0];
  if (firstIdea) {
    const briefRun = await run("create_brief", { ideaId: firstIdea });
    const briefId = (briefRun.output as any)?.briefId;
    if (briefId) await run("create_drafts", { briefId, targets: [{ platform: "youtube_shorts" }, { platform: "instagram" }], options: { variants: 2 } });
  }
  // One example of a human-finished draft so the approval flow can be explored end to end.
  const shorts = listContent(ctx.db, b, { platform: "youtube_shorts" })[0];
  if (shorts) {
    const item = getContentItem(ctx.db, shorts.id);
    addVariant(ctx.db, item.id, {
      angleLabel: "Human-edited example (demo)",
      generatedBy: "user",
      parentVariantId: item.currentVariantId,
      fields: {
        titleOptions: ["Buy for three dinners, not one"],
        hooks: ["Stop buying ingredients for one recipe."],
        body: "Stop buying ingredients for one recipe.\nHere's the shortcut: plan three dinners that share the same five ingredients.\nTonight: chickpea curry. Wednesday: the same chickpeas, crisped, on rice. Friday: leftover tomatoes become shakshuka.\nOne shop, three dinners, nothing in the bin.",
        beats: [
          { beat: "Stop buying ingredients for one recipe.", visual: "Face to camera, holding a single-use jar", seconds: 2 },
          { beat: "Plan three dinners that share five ingredients.", visual: "Overhead: five ingredients on the counter", seconds: 6 },
          { beat: "Chickpea curry → crispy chickpeas on rice → shakshuka.", visual: "Quick cuts of each dinner", seconds: 15 },
          { beat: "One shop, three dinners, nothing in the bin.", visual: "Empty fridge shelf, clean", seconds: 3 },
        ],
        caption: "One shop, three dinners. The full plan is in this week's newsletter.",
        cta: "Get this week's meal plan in the newsletter",
        hashtags: ["#weeknightdinner", "#mealplanning"],
        productionNotes: "Film on Saturday batch day. Demo example of a human-edited draft.",
        targetLength: "26 seconds",
      },
    });
    await reviewVariant(offlineCtx, item.id, undefined, { useModel: false });
  }
  importCsv(ctx.db, b, {
    filename: "DEMO-sample-youtube.csv", platform: "youtube", account: "DEMO channel (fictional data)",
    text: [
      "post_id,title,published_at,format,pillar,views,avg_percent_viewed,ctr_percent,likes,comments,followers_gained",
      "d1,DEMO: 10 pantry staples for a week of dinners,2026-09-01,tutorial,Pantry staples,4200,48,6.1,310,42,55",
      "d2,DEMO: One-pan lemon chickpeas,2026-09-08,recipe,One-pan dinners,1900,41,4.2,120,9,12",
      "d3,DEMO: Stop wasting half an onion,2026-09-15,tutorial,Reducing food waste,3100,52,5.5,240,31,38",
      "d4,DEMO: Fancy weekend risotto,2026-09-22,recipe,One-pan dinners,1200,33,3.9,80,6,4",
      "d5,DEMO: Meal plan for a tired Tuesday,2026-09-29,tutorial,Pantry staples,3600,46,5.8,260,35,41",
      "d6,DEMO: Toddler-friendly fried rice,2026-10-06,recipe,One-pan dinners,2100,44,4.6,150,22,15",
    ].join("\n"),
  });
  upsertExperiment(ctx.db, b, { hypothesis: "DEMO: Result-first hooks improve average % viewed vs context-first hooks.", variable: "Hook structure", targetMetric: "avg_percent_viewed", successThreshold: "≥10% relative lift over 3 shorts", status: "planned" });
  void engine;
  void t;
  return { brandId: b, created: true };
}
