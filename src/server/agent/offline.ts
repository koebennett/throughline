// Offline scaffold engine. Deterministic structures built ONLY from the user's own data, with explicit
// "[insert: …]" markers where human knowledge is required. QA blocks approval until markers are replaced,
// so a scaffold can never be shipped as if it were finished content.
import type {
  AnalyticsNarrative, AnswerOutput, BriefData, DraftOutput, Format, IdeaBatch, MomentExtraction, Platform, ResearchSynthesis, StrategyDraft,
} from "../../shared/schemas.js";
import { PLATFORM_SPECS } from "../../shared/platforms.js";
import type { ContextPack } from "./context.js";
import { tokens, truncate } from "../lib/text.js";

const OFFLINE = "Offline scaffold (no AI model connected)";
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const firstSentences = (s: string, n = 2) => s.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((x) => x.length > 40 && x.length < 400).slice(0, n);

function problems(p: ContextPack["profile"]) {
  const list = p.audiences.flatMap((a) => a.problems);
  return list.length ? list : [p.niche ? `getting better results in ${p.niche}` : "the audience's core problem"];
}
function desires(p: ContextPack["profile"]) {
  return p.audiences.flatMap((a) => a.desires);
}

export function offlineSynthesis(topic: string, sources: { title: string; excerpt: string }[], pack: ContextPack): ResearchSynthesis {
  const evidence: ResearchSynthesis["evidence"] = sources.flatMap((s, i) =>
    firstSentences(s.excerpt, 2).map((sent) => ({ claim: truncate(sent, 300), kind: "observation" as const, confidence: "low" as const, sourceIndex: i, quote: truncate(sent, 300) })),
  );
  const probs = problems(pack.profile).slice(0, 4);
  return {
    summary: `${OFFLINE}: extracted ${evidence.length} candidate observation(s) from ${sources.length} source(s) about “${topic}”. Sentences were pulled automatically — review each before relying on it.`,
    audienceQuestions: probs.map((p) => `How do I deal with ${p.replace(/^(how to |dealing with )/i, "")}?`),
    evidence,
    contentGaps: [`Hypothesis: few sources address “${topic}” specifically for ${pack.profile.audiences[0]?.name ?? "your audience"} — verify by reviewing competitor content.`],
    angles: pack.profile.differentiators.slice(0, 3).map((d) => `${cap(topic)} through the lens of: ${d}`),
    openQuestions: ["Which of these sources reflect what your audience actually says?", "What first-hand experience can you add that these sources lack?"],
  };
}

export function offlineStrategy(pack: ContextPack, goal: string, horizonDays: number): StrategyDraft {
  const p = pack.profile;
  const seeds = (p.topicsOfExpertise.length >= 3 ? uniq(p.topicsOfExpertise) : uniq([...p.topicsOfExpertise, ...problems(p)])).slice(0, 5);
  while (seeds.length < 3) seeds.push(["Fundamentals", "Behind the scenes", "Case studies"][seeds.length]);
  const platforms = p.platforms.filter((x) => x.active).map((x) => x.platform);
  const primary = platforms[0] ?? "youtube";
  const target = p.capacity.postsPerWeekTarget ?? Math.max(1, Math.round((p.capacity.hoursPerWeek ?? 4) / 4));
  const perWeek = (platforms.length ? platforms : [primary]).map((pl, i, arr) => ({ platform: pl, count: Math.max(i === 0 ? 1 : 0, Math.round(target / arr.length)) })).filter((x) => x.count > 0);
  const day = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const evidenceNote = pack.evidence.length ? `${pack.evidence.length} evidence item(s) on file (${pack.evidence.filter((e) => e.source).length} sourced)` : "assumption — no evidence on file yet";
  return {
    executiveSummary: `${OFFLINE}. Built from your brand profile${pack.evidence.length ? " and evidence on file" : ""}. Treat every pillar and recommendation as a starting hypothesis; edit it, then approve. Connect Claude for an evidence-synthesised strategy.`,
    positioning: p.positioning || `[insert: one sentence — who you help (${p.audiences[0]?.name ?? "audience"}), with what (${p.niche || "topic"}), and how you are different (${p.differentiators[0] ?? "your differentiator"})]`,
    differentiators: p.differentiators.length ? p.differentiators : ["[insert: what you can say that competitors can't]"],
    personas: p.audiences.map((a) => ({ name: a.name, summary: `${a.description} Wants: ${a.desires.join(", ") || "unknown"}.`, evidence: "User-supplied brand profile", confidence: "medium" as const })),
    pillars: seeds.slice(0, 5).map((s) => ({
      name: cap(truncate(s, 60)),
      purpose: `Help ${p.audiences[0]?.name ?? "the audience"} make progress on ${s.toLowerCase()}.`,
      audienceNeed: problems(p).find((x) => tokens(x).some((t) => tokens(s).includes(t))) ?? s,
      proof: p.proof[0] ?? "[insert: why you are credible on this]",
      boundaries: `[insert: what this pillar deliberately excludes]`,
      clusters: [{ name: `${cap(truncate(s, 40))} essentials`, pillarTopic: s, subtopics: uniq([...desires(p).slice(0, 2), ...problems(p).slice(0, 2)]).slice(0, 4), searchIntent: "informational (hypothesis)" }],
    })),
    series: [{ name: `${cap(truncate(seeds[0], 40))} in practice`, premise: `A recurring ${PLATFORM_SPECS[primary as Platform]?.label ?? primary} series applying ${seeds[0].toLowerCase()} to real situations from your experience.`, format: PLATFORM_SPECS[primary as Platform]?.defaultFormat ?? "long_video", cadence: "weekly" }],
    platformRoles: (platforms.length ? platforms : [primary]).map((pl) => ({ platform: pl, role: p.platforms.find((x) => x.platform === pl)?.role || "[insert: why this channel exists for you]", contentTypes: PLATFORM_SPECS[pl as Platform]?.formats.slice(0, 3) ?? [] })),
    messagingMatrix: problems(p).slice(0, 3).map((pr, i) => ({ stage: ["awareness", "consideration", "conversion"][i], problem: pr, promise: desires(p)[i] ?? "[insert: the change you help create]", proof: p.proof[i] ?? p.proof[0] ?? "[insert: proof]", cta: p.ctas[i] ?? p.ctas[0] ?? "[insert: next step]" })),
    funnel: [
      { stage: "awareness", goal: "Reach people with the problem", contentTypes: ["short_video", "carousel"], kpi: "Reach / views vs own baseline" },
      { stage: "consideration", goal: "Earn trust through depth", contentTypes: ["long_video", "article"], kpi: "Retention, saves, returning viewers" },
      { stage: "conversion", goal: p.objective || "Drive the main business goal", contentTypes: ["newsletter_issue", "long_video"], kpi: "Link clicks / sign-ups" },
    ],
    cadence: { summary: `${perWeek.reduce((a, b) => a + b.count, 0)} piece(s)/week across ${perWeek.length} channel(s), matching your stated capacity.`, perWeek, rationale: `Derived from your stated capacity (${p.capacity.postsPerWeekTarget ?? "?"} pieces/week, ${p.capacity.hoursPerWeek ?? "?"} h/week). Consistency beats volume.` },
    plan: [
      { window: "Days 1–30", focus: `Establish the “${cap(truncate(seeds[0], 40))}” series and baseline`, milestones: ["Publish at the planned cadence", "Import analytics weekly"], reviewDate: day(30) },
      { window: "Days 31–60", focus: "Double down on what beats your own baseline", milestones: ["Run 2 one-variable experiments", "Repurpose top long-form into shorts"], reviewDate: day(60) },
      { window: `Days 61–${Math.max(90, horizonDays)}`, focus: goal || "Connect content to the business objective", milestones: ["Review pillars with evidence", "Adjust cadence to capacity"], reviewDate: day(Math.max(90, horizonDays)) },
    ],
    experiments: [
      { hypothesis: "Opening with the payoff (result first) improves early retention vs. a context-first opener.", variable: "Hook structure", metric: "Average % viewed / first-3-seconds hold", threshold: "≥10% relative lift over 3 posts" },
      { hypothesis: `A recurring named series on ${primary} builds returning viewers faster than one-offs.`, variable: "Series packaging", metric: "Returning viewers / follows per post", threshold: "≥1.2× own median over 4 posts" },
    ],
    recommendations: [
      { title: `Commit to one signature series on ${primary}`, detail: "Series compound: the audience learns what to expect and the brand gets a recognisable format.", evidence: evidenceNote, expectedBenefit: "Hypothesis: more returning viewers and easier production", effort: "medium", risk: "Series fatigue if the premise is too narrow", confidence: "low", successMetric: "Returning viewers / follows per post vs own median" },
      { title: "Build evidence before scaling volume", detail: "Add 5–10 dated sources or audience questions in the Research Desk before generating large idea batches.", evidence: evidenceNote, expectedBenefit: "Scores and ideas grounded in demand rather than assumptions", effort: "low", risk: "Delays first posts slightly", confidence: "high", successMetric: "≥5 sourced evidence items within 2 weeks" },
    ],
    assumptions: [`Goal: ${goal || p.objective || "not stated"}`, "No market evidence was synthesised (offline mode).", "Cadence assumes the stated capacity is accurate."],
    risks: ["Pillars derived from profile keywords may be too broad — tighten boundaries before approving."],
  };
}

const FORMAT_FOR: Record<string, Format> = { youtube: "long_video", youtube_shorts: "short_video", tiktok: "short_video", instagram: "carousel", linkedin: "text_post", x: "thread", threads: "text_post", facebook: "text_post", pinterest: "single_image", blog: "article", newsletter: "newsletter_issue", podcast: "podcast_episode" };
const ANGLES = [
  { label: "Mistakes to avoid", title: (t: string, a: string) => `${cap(t)}: the mistakes ${a} make most`, format: "teardown" },
  { label: "Step-by-step", title: (t: string, a: string) => `${cap(t)}, step by step, for ${a}`, format: "tutorial" },
  { label: "Myth vs reality", title: (t: string) => `What most advice gets wrong about ${t}`, format: "myth-busting" },
  { label: "Case study", title: (t: string) => `${cap(t)} in practice: a real example`, format: "case study" },
];

export function offlineIdeas(pack: ContextPack, count: number, opts: { platform?: Platform | null; pillarId?: string | null }): IdeaBatch {
  const p = pack.profile;
  const pillars = (opts.pillarId ? pack.pillars.filter((x) => x.id === opts.pillarId) : pack.pillars).map((x) => ({ name: x.name, need: x.audienceNeed || x.purpose }));
  const seeds = pillars.length ? pillars : problems(p).map((pr) => ({ name: "Unassigned", need: pr }));
  const platforms = (opts.platform ? [opts.platform] : p.platforms.filter((x) => x.active).map((x) => x.platform)) as Platform[];
  const plats: Platform[] = platforms.length ? platforms : ["youtube"];
  const out: IdeaBatch["ideas"] = [];
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const seed = seeds[i % seeds.length];
    const angle = ANGLES[Math.floor(i / seeds.length) % ANGLES.length];
    const platform = plats[i % plats.length];
    const topic = truncate(seed.name === "Unassigned" ? seed.need : seed.name, 70).toLowerCase();
    const audienceName = (p.audiences[i % Math.max(1, p.audiences.length)]?.name ?? "beginners").toLowerCase();
    const evIdx = pack.evidence.map((e, j) => ({ j, o: tokens(e.claim).filter((t) => tokens(topic).includes(t)).length })).filter((x) => x.o >= 2).map((x) => x.j).slice(0, 3);
    const effort = FORMAT_FOR[platform] === "long_video" ? "high" : FORMAT_FOR[platform] === "short_video" ? "medium" : "low";
    const hours = p.capacity.hoursPerWeek ?? 0;
    out.push({
      title: angle.title(topic, audienceName),
      angle: `${angle.label} — addresses “${truncate(seed.need, 90)}”${p.differentiators[0] ? `, framed through “${truncate(p.differentiators[0], 80)}”` : ". [insert: your distinct perspective]"}`,
      rationale: `Addresses the stated audience need “${truncate(seed.need, 100)}” (user-supplied). ${evIdx.length ? `Related evidence: ${evIdx.map((j) => pack.evidence[j].ref).join(", ")}.` : "No supporting evidence on file — demand is unverified."}`,
      pillarName: seed.name,
      audience: p.audiences[i % Math.max(1, p.audiences.length)]?.name ?? "",
      platform,
      format: FORMAT_FOR[platform] ?? "text_post",
      funnelStage: angle.format === "case study" ? "consideration" : "awareness",
      effort,
      seriesName: "",
      evidenceRefs: evIdx,
      ratings: { audienceRelevance: 4, demandEvidence: evIdx.length ? Math.min(5, 2 + evIdx.length) : null, differentiation: null, brandAlignment: pillars.length ? 4 : 3, platformFit: 3, feasibility: effort === "high" && hours < 6 ? 2 : effort === "low" ? 5 : 3, timeliness: null },
      ratingReasons: {
        audienceRelevance: "Derived from a user-stated audience problem.",
        demandEvidence: evIdx.length ? `${evIdx.length} related evidence item(s).` : "No evidence — unknown.",
        differentiation: "Unknown offline — compare against competitor content.",
        brandAlignment: pillars.length ? "Mapped to an approved pillar." : "No approved pillar yet.",
        platformFit: `Default ${FORMAT_FOR[platform] ?? "text_post"} format for ${platform}.`,
        feasibility: `Effort ${effort} vs ${hours || "?"} h/week capacity.`,
        timeliness: "Not assessed offline.",
      },
      whyDifferent: "[insert: why your take beats what already exists]",
    });
  }
  return { ideas: out };
}

export function offlineBrief(idea: { title: string; angle: string; rationale: string; platform: string | null; format: string | null; audience: string; funnelStage: string | null }, pack: ContextPack, evidence: { claim: string; source: string; url: string }[]): BriefData {
  const p = pack.profile;
  const aud = p.audiences.find((a) => a.name === idea.audience) ?? p.audiences[0];
  const platform = (idea.platform ?? "youtube") as Platform;
  const spec = PLATFORM_SPECS[platform];
  return {
    workingTitle: idea.title,
    objective: `${cap(idea.funnelStage ?? "awareness")}: ${p.objective || "[insert: what this piece should achieve]"}`,
    targetAudience: aud ? `${aud.name} — ${aud.description}` : "[insert: audience]",
    audienceProblem: aud?.problems[0] ?? "[insert: the specific problem]",
    desiredTakeaway: aud?.transformation || "[insert: what they can do after watching/reading]",
    coreThesis: "[insert: the one claim this piece argues]",
    originalAngle: idea.angle,
    hooks: [`[insert: a specific moment where ${aud?.name ?? "your audience"} feels this problem]`, `Most advice about ${idea.title.toLowerCase()} skips one thing.`],
    promise: `By the end, the audience understands ${idea.title.toLowerCase()} well enough to act on it.`,
    outline: [
      { section: "Hook & stakes", points: ["Name the problem in the audience's words", "Show what's at stake"] },
      { section: "Core idea", points: ["[insert: your framework or main insight]"] },
      { section: "Proof / example", points: [p.proof[0] ? `Use: ${p.proof[0]}` : "[insert: first-hand example]"] },
      { section: "Apply it", points: ["Concrete steps the audience can take today"] },
      { section: "Next step", points: [p.ctas[0] ?? "[insert: CTA]"] },
    ],
    talkingPoints: idea.rationale ? [idea.rationale] : [],
    proof: [
      ...p.proof.slice(0, 2).map((x) => ({ claim: x, support: "Brand profile", origin: "user_supplied" as const })),
      ...evidence.slice(0, 3).map((e) => ({ claim: e.claim, support: e.source || "Evidence on file", origin: e.source ? ("researched" as const) : ("needs_verification" as const) })),
    ],
    requiredAssets: [spec.defaultFormat.includes("video") ? "Original footage / screen recording you own" : "Original visuals or screenshots you own"],
    visualDirection: `${spec.aspect ?? "platform default"} framing; brand visual style.`,
    sourceLinks: evidence.map((e) => e.url).filter(Boolean),
    rightsNotes: "Use only owned, licensed or permissioned media.",
    cta: p.ctas[0] ?? "",
    disclosures: p.compliance.requiredDisclosures,
    platform,
    format: idea.format ?? spec.defaultFormat,
    constraints: [spec.aspect && `Aspect ${spec.aspect}`, spec.duration, ...Object.entries(spec.limits).map(([k, v]) => `${k} ≤ ~${v} chars`)].filter(Boolean).join("; "),
    searchIntent: platform === "youtube" || platform === "blog" || platform === "pinterest" ? "informational (hypothesis — verify with research)" : "",
    kpi: platform === "youtube" ? "Average % viewed and CTR vs own median" : "Saves/shares vs own median",
    risks: ["Generic execution — make the original angle explicit in the first 10% of the piece."],
    assumptions: ["Offline scaffold: thesis, hooks and proof need your input."],
    factCheck: evidence.filter((e) => !e.source).map((e) => e.claim),
    sponsored: false,
  };
}

export function offlineDrafts(brief: BriefData, platform: Platform, format: Format, pack: ContextPack, n: number): DraftOutput[] {
  const p = pack.profile;
  const out: DraftOutput[] = [];
  const angles = [
    { label: "Problem → solution", hook: brief.hooks[0] ?? "" },
    { label: "Contrarian take", hook: `Here's what most advice about ${brief.workingTitle.toLowerCase()} gets wrong.` },
    { label: "Story-led", hook: "[insert: a short real story that sets up the problem]" },
  ];
  for (let i = 0; i < n; i++) {
    const a = angles[i % angles.length];
    const steps = brief.outline.map((o, j) => `${j + 1}. ${o.section}: ${o.points.join("; ")}`).join("\n");
    const base = {
      titleOptions: [brief.workingTitle, `${brief.workingTitle} (${a.label.toLowerCase()})`].map((t) => truncate(t, PLATFORM_SPECS[platform].limits.title ?? 100)),
      hooks: [a.hook],
      body: "",
      caption: "",
      description: "",
      chapters: [] as { time: string; label: string }[],
      slides: [] as { heading: string; text: string }[],
      beats: [] as { beat: string; visual: string; seconds: number | null }[],
      hashtags: [] as string[],
      cta: brief.cta,
      thumbnailConcepts: [] as string[],
      visualPrompts: [] as string[],
      pinnedComment: "",
      seoTitle: "",
      metaDescription: "",
      productionNotes: `${OFFLINE}. Replace every [insert: …] marker with your own words and examples. Voice: ${p.voice.traits.join(", ") || "your natural voice"}.`,
      targetLength: "",
      claimsToVerify: brief.factCheck,
    };
    if (format === "long_video" || format === "podcast_episode" || format === "live") {
      base.body = `HOOK (0:00–0:20)\n${a.hook}\n\nPROMISE\n${brief.promise}\n\n${brief.outline.map((o) => `## ${o.section}\n${o.points.map((x) => `- ${x}`).join("\n")}`).join("\n\n")}\n\nCLOSE\n${brief.cta || "[insert: CTA]"}`;
      base.description = `${brief.desiredTakeaway}\n\n[insert: 2–3 sentence summary in your voice]\n\nChapters below.`;
      base.chapters = brief.outline.map((o, j) => ({ time: j === 0 ? "00:00" : `[insert: mm:ss]`, label: o.section }));
      base.thumbnailConcepts = [`Close-up reaction + 3-word text naming the problem (“${truncate(brief.audienceProblem, 24)}”)`, "Before/after split showing the transformation"];
      base.targetLength = "8–12 minutes (adjust to the depth the topic needs)";
    } else if (format === "short_video") {
      base.beats = [
        { beat: a.hook, visual: "Face to camera, tight crop", seconds: 2 },
        { beat: "[insert: the one insight]", visual: "B-roll or on-screen text", seconds: 10 },
        { beat: "[insert: concrete example or step]", visual: "Demonstration / screen recording you own", seconds: 15 },
        { beat: brief.cta || "[insert: CTA]", visual: "Text overlay", seconds: 3 },
      ];
      base.body = base.beats.map((b) => b.beat).join("\n");
      base.caption = `${truncate(brief.desiredTakeaway, 150)}`;
      base.targetLength = "20–45 seconds";
    } else if (format === "carousel") {
      base.slides = [{ heading: truncate(a.hook, 80), text: brief.audienceProblem }, ...brief.outline.slice(1, 5).map((o) => ({ heading: o.section, text: o.points.join(" ") })), { heading: "Save this", text: brief.cta || "[insert: CTA]" }];
      base.caption = `${brief.promise}\n\n${brief.cta}`;
    } else if (format === "thread") {
      base.body = [a.hook, ...brief.outline.map((o) => `${o.section}: ${o.points.join(" ")}`), brief.cta || "[insert: CTA]"].map((x) => truncate(x, 270)).join("\n\n");
    } else if (format === "article" || format === "newsletter_issue") {
      base.body = `# ${brief.workingTitle}\n\n${a.hook}\n\n${brief.outline.map((o) => `## ${o.section}\n\n${o.points.join("\n\n")}`).join("\n\n")}\n\n${brief.cta}`;
      base.seoTitle = truncate(brief.workingTitle, 60);
      base.metaDescription = truncate(brief.desiredTakeaway, 155);
      base.description = format === "newsletter_issue" ? truncate(brief.promise, 120) : "";
    } else {
      base.body = `${a.hook}\n\n${steps}\n\n${brief.cta}`;
    }
    out.push({ angleLabel: a.label, fields: base, rationale: `${OFFLINE}: ${a.label} structure applied to the brief's outline.` });
  }
  return out;
}

export function offlineMoments(text: string, max: number): MomentExtraction {
  const blocks = text.split(/\n(?=\s*[[(]?\d{1,2}:\d{2})|\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 80);
  const scored = blocks.map((b, i) => {
    const ts = b.match(/^\s*[[(]?(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1] ?? `Section ${i + 1}`;
    const score = (b.match(/\?/g)?.length ?? 0) + (b.match(/\d/g)?.length ?? 0) * 0.3 + (/(mistake|secret|never|always|the reason|here's|lesson)/i.test(b) ? 2 : 0) + Math.min(2, b.length / 400);
    return { b, ts, score, i };
  });
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.i - b.i);
  return {
    themes: [],
    moments: top.map((m) => {
      const next = scored[m.i + 1]?.ts ?? "end";
      return { label: truncate(m.b.replace(/^\s*[[(]?\d{1,2}:\d{2}(:\d{2})?[\])]?\s*/, ""), 70), start: m.ts, end: next, quote: truncate(m.b, 400), whyItWorks: "Heuristic pick (offline): dense with questions, numbers or strong statements. Review before clipping.", suggestedPlatform: "youtube_shorts", suggestedFormat: "short_video", contextNeeded: "[insert: one line of setup the viewer needs]" };
    }),
  };
}

export function offlineNarrative(analysis: { platform: string; n: number; insights: { text: string; kind: string }[] }[]): AnalyticsNarrative {
  const all = analysis.flatMap((a) => a.insights.map((i) => ({ ...i, platform: a.platform })));
  return {
    headline: analysis.length ? `${OFFLINE}: descriptive summary of ${analysis.reduce((s, a) => s + a.n, 0)} imported post(s).` : "No analytics imported yet.",
    whatHappened: all.filter((i) => i.kind === "observation").map((i) => `[${i.platform}] ${i.text}`),
    known: analysis.map((a) => `${a.platform}: ${a.n} post(s) in the baseline.`),
    hypotheses: all.filter((i) => i.kind === "hypothesis").map((i) => `[${i.platform}] ${i.text}`),
    repeat: [],
    change: [],
    nextExperiments: all.filter((i) => i.kind === "hypothesis").slice(0, 2).map((i) => ({ hypothesis: i.text, variable: "The factor named in the hypothesis", metric: "Primary metric for the platform", threshold: "≥1.2× own median over 3+ posts" })),
    memoryCandidates: [],
  };
}

export function offlineAnswer(question: string, pack: ContextPack, actions: { title: string; reason: string }[]): AnswerOutput {
  const top = actions[0];
  return {
    answer: `${OFFLINE}: I can't reason over your question without a model, but here is what your data says right now. Question noted: “${truncate(question, 200)}”.`,
    recommendation: top ? `${top.title} — ${top.reason}` : "Your workspace has no urgent gaps. Keep the cadence and import results weekly.",
    evidence: [...pack.snippets.slice(0, 3).map((s) => `[Doc: ${s.citation}] ${truncate(s.text, 160)}`), ...pack.evidence.slice(0, 3).map((e) => `${e.ref}: ${e.claim}`)],
    assumptions: ["Offline mode: no model inference was performed."],
    confidence: "low",
    nextActions: actions.slice(0, 3).map((a) => a.title),
    successCriteria: [],
  };
}
