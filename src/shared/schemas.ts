// Shared domain schemas. These are the contract between UI, API, agent workflow and model outputs.
// Keep them strict enough to validate, loose enough that partially-filled real-world data is accepted.
import { z } from "zod";

export const PLATFORMS = [
  "youtube",
  "youtube_shorts",
  "tiktok",
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "threads",
  "pinterest",
  "blog",
  "newsletter",
  "podcast",
] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube (long-form)",
  youtube_shorts: "YouTube Shorts",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  blog: "Blog / website",
  newsletter: "Newsletter",
  podcast: "Podcast",
};

export const FORMATS = [
  "long_video",
  "short_video",
  "carousel",
  "single_image",
  "text_post",
  "thread",
  "article",
  "newsletter_issue",
  "story_sequence",
  "live",
  "podcast_episode",
] as const;
export const Format = z.enum(FORMATS);
export type Format = z.infer<typeof Format>;

export const FUNNEL_STAGES = ["awareness", "consideration", "conversion", "retention"] as const;
export const FunnelStage = z.enum(FUNNEL_STAGES);
export type FunnelStage = z.infer<typeof FunnelStage>;

export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

// Evidence classes — the product's core honesty mechanism.
export const EVIDENCE_KINDS = ["user_fact", "fact", "observation", "inference", "hypothesis"] as const;
export const EvidenceKind = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKind>;
export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  user_fact: "User-supplied fact",
  fact: "Sourced fact",
  observation: "Source-backed observation",
  inference: "Model inference",
  hypothesis: "Hypothesis (untested)",
};

const str = (max = 4000) => z.string().max(max);
const optStr = (max = 4000) => z.string().max(max).optional().default("");
const strList = (maxItems = 50, maxLen = 500) => z.array(z.string().max(maxLen)).max(maxItems).optional().default([]);

// ---------------- Brand profile (versioned as a whole) ----------------
export const AudienceSegment = z.object({
  name: str(200),
  description: optStr(),
  knowledgeLevel: z.enum(["beginner", "intermediate", "advanced", "mixed"]).optional().default("mixed"),
  needs: strList(),
  problems: strList(),
  desires: strList(),
  objections: strList(),
  language: strList(), // words/phrases the audience actually uses
  transformation: optStr(),
});
export type AudienceSegment = z.infer<typeof AudienceSegment>;

export const PlatformPresence = z.object({
  platform: Platform,
  handle: optStr(200),
  url: optStr(500),
  role: optStr(500), // why this channel exists
  active: z.boolean().optional().default(true),
});

export const Competitor = z.object({
  name: str(200),
  url: optStr(500),
  platform: Platform.optional(),
  notes: optStr(),
  kind: z.enum(["competitor", "reference", "aspirational"]).optional().default("competitor"),
});

export const BrandProfile = z.object({
  name: str(200).min(1),
  description: optStr(),
  website: optStr(500),
  niche: optStr(500),
  offer: optStr(),
  monetization: optStr(1000),
  objective: optStr(1000),
  geography: optStr(300),
  languages: strList(10, 50),
  audiences: z.array(AudienceSegment).max(10).optional().default([]),
  platforms: z.array(PlatformPresence).max(20).optional().default([]),
  capacity: z
    .object({
      hoursPerWeek: z.number().min(0).max(168).optional(),
      postsPerWeekTarget: z.number().min(0).max(100).optional(),
      team: optStr(1000),
      equipment: optStr(1000),
      budget: optStr(500),
      constraints: optStr(2000),
    })
    .optional()
    .default({ team: "", equipment: "", budget: "", constraints: "" }),
  voice: z
    .object({
      traits: strList(15, 100),
      tone: optStr(500),
      vocabulary: strList(50, 100),
      phrasesToUse: strList(50, 200),
      phrasesToAvoid: strList(50, 200),
      readingLevel: z.enum(["simple", "standard", "expert"]).optional().default("standard"),
    })
    .optional()
    .default({ traits: [], tone: "", vocabulary: [], phrasesToUse: [], phrasesToAvoid: [], readingLevel: "standard" }),
  positioning: optStr(2000),
  pointOfView: optStr(2000),
  proof: strList(30, 500), // credentials, results, case studies the brand can truthfully cite
  differentiators: strList(20, 500),
  ctas: strList(20, 300),
  compliance: z
    .object({
      bannedClaims: strList(50, 300), // hard blockers in QA
      requiredDisclosures: strList(20, 300),
      notes: optStr(2000),
    })
    .optional()
    .default({ bannedClaims: [], requiredDisclosures: [], notes: "" }),
  competitors: z.array(Competitor).max(30).optional().default([]),
  likes: strList(30, 500),
  dislikes: strList(30, 500),
  topicsOfExpertise: strList(30, 200),
  timezone: optStr(64),
});
export type BrandProfile = z.infer<typeof BrandProfile>;
export type BrandProfileInput = z.input<typeof BrandProfile>;

// ---------------- Research ----------------
export const SourceInput = z.object({
  url: z.string().url().max(2000).optional().or(z.literal("")),
  title: str(500).min(1),
  publisher: optStr(300),
  publishedAt: optStr(40),
  retrievedAt: optStr(40),
  excerpt: optStr(8000),
  notes: optStr(4000),
  provider: optStr(100),
});
export type SourceInput = z.input<typeof SourceInput>;

export const EvidenceInput = z.object({
  claim: str(2000).min(3),
  kind: EvidenceKind,
  confidence: Confidence.default("medium"),
  topic: optStr(300),
  sourceId: z.string().optional().nullable(),
  researchRunId: z.string().optional().nullable(),
  quote: optStr(2000),
});
export type EvidenceInput = z.input<typeof EvidenceInput>;

// Model output for a research synthesis. Source references are indices into the provided source list.
export const ResearchSynthesis = z.object({
  summary: z.string(),
  audienceQuestions: z.array(z.string()),
  evidence: z.array(
    z.object({
      claim: z.string(),
      kind: EvidenceKind,
      confidence: Confidence,
      sourceIndex: z.number().int().nullable(), // null for inference/hypothesis
      quote: z.string(),
    }),
  ),
  contentGaps: z.array(z.string()),
  angles: z.array(z.string()),
  openQuestions: z.array(z.string()),
});
export type ResearchSynthesis = z.infer<typeof ResearchSynthesis>;

// ---------------- Strategy ----------------
export const Recommendation = z.object({
  title: z.string(),
  detail: z.string(),
  evidence: z.string(), // short citation or "assumption"
  expectedBenefit: z.string(),
  effort: z.enum(["low", "medium", "high"]),
  risk: z.string(),
  confidence: Confidence,
  successMetric: z.string(),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const PillarDraft = z.object({
  name: z.string(),
  purpose: z.string(),
  audienceNeed: z.string(),
  proof: z.string(),
  boundaries: z.string(),
  clusters: z.array(
    z.object({
      name: z.string(),
      pillarTopic: z.string(),
      subtopics: z.array(z.string()),
      searchIntent: z.string(),
    }),
  ),
});
export type PillarDraft = z.infer<typeof PillarDraft>;

export const StrategyDraft = z.object({
  executiveSummary: z.string(),
  positioning: z.string(),
  differentiators: z.array(z.string()),
  personas: z.array(
    z.object({ name: z.string(), summary: z.string(), evidence: z.string(), confidence: Confidence }),
  ),
  pillars: z.array(PillarDraft),
  series: z.array(z.object({ name: z.string(), premise: z.string(), format: z.string(), cadence: z.string() })),
  platformRoles: z.array(z.object({ platform: z.string(), role: z.string(), contentTypes: z.array(z.string()) })),
  messagingMatrix: z.array(
    z.object({
      stage: z.string(),
      problem: z.string(),
      promise: z.string(),
      proof: z.string(),
      cta: z.string(),
    }),
  ),
  funnel: z.array(z.object({ stage: z.string(), goal: z.string(), contentTypes: z.array(z.string()), kpi: z.string() })),
  cadence: z.object({ summary: z.string(), perWeek: z.array(z.object({ platform: z.string(), count: z.number() })), rationale: z.string() }),
  plan: z.array(z.object({ window: z.string(), focus: z.string(), milestones: z.array(z.string()), reviewDate: z.string() })),
  experiments: z.array(z.object({ hypothesis: z.string(), variable: z.string(), metric: z.string(), threshold: z.string() })),
  recommendations: z.array(Recommendation),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
});
export type StrategyDraft = z.infer<typeof StrategyDraft>;

// ---------------- Scoring ----------------
export const OPPORTUNITY_DIMENSIONS = [
  "audienceRelevance",
  "demandEvidence",
  "differentiation",
  "brandAlignment",
  "platformFit",
  "feasibility",
  "timeliness",
] as const;
export type OpportunityDimension = (typeof OPPORTUNITY_DIMENSIONS)[number];
export const OPPORTUNITY_LABELS: Record<OpportunityDimension, string> = {
  audienceRelevance: "Audience relevance",
  demandEvidence: "Evidence of demand",
  differentiation: "Differentiation / gap",
  brandAlignment: "Brand / business alignment",
  platformFit: "Platform / format fit",
  feasibility: "Feasibility",
  timeliness: "Timeliness",
};
export const DEFAULT_OPPORTUNITY_WEIGHTS: Record<OpportunityDimension, number> = {
  audienceRelevance: 20,
  demandEvidence: 20,
  differentiation: 20,
  brandAlignment: 15,
  platformFit: 10,
  feasibility: 10,
  timeliness: 5,
};
// Each rating 0–5 or null (unknown). Null is penalised and lowers confidence; it is never silently treated as good.
export const OpportunityRatings = z.object(
  Object.fromEntries(OPPORTUNITY_DIMENSIONS.map((d) => [d, z.number().min(0).max(5).nullable()])) as Record<
    OpportunityDimension,
    z.ZodNullable<z.ZodNumber>
  >,
);
export type OpportunityRatings = z.infer<typeof OpportunityRatings>;

export const QA_DIMENSIONS = [
  "audienceValue",
  "originality",
  "clarityHook",
  "evidenceAccuracy",
  "brandFit",
  "platformFit",
  "narrative",
  "ctaAlignment",
] as const;
export type QaDimension = (typeof QA_DIMENSIONS)[number];
export const QA_LABELS: Record<QaDimension, string> = {
  audienceValue: "Audience value",
  originality: "Originality",
  clarityHook: "Clarity & hook",
  evidenceAccuracy: "Evidence & accuracy",
  brandFit: "Brand fit",
  platformFit: "Platform fit",
  narrative: "Narrative / usefulness",
  ctaAlignment: "CTA / objective fit",
};
export const DEFAULT_QA_WEIGHTS: Record<QaDimension, number> = {
  audienceValue: 20,
  originality: 20,
  clarityHook: 15,
  evidenceAccuracy: 15,
  brandFit: 10,
  platformFit: 10,
  narrative: 5,
  ctaAlignment: 5,
};

// ---------------- Ideas ----------------
export const IdeaInput = z.object({
  title: str(300).min(3),
  angle: optStr(2000),
  rationale: optStr(4000),
  pillarId: z.string().nullable().optional(),
  seriesId: z.string().nullable().optional(),
  campaignId: z.string().nullable().optional(),
  audience: optStr(300),
  platform: Platform.optional().nullable(),
  format: Format.optional().nullable(),
  funnelStage: FunnelStage.optional().nullable(),
  effort: z.enum(["low", "medium", "high"]).optional().default("medium"),
  source: z.enum(["manual", "research", "agent", "repurpose", "analytics"]).optional().default("manual"),
  evidenceIds: z.array(z.string()).optional().default([]),
  ratings: OpportunityRatings.partial().optional(),
  ratingReasons: z.record(z.string(), z.string()).optional(),
  notes: optStr(4000),
  userRating: z.number().int().min(0).max(5).optional().nullable(),
});
export type IdeaInput = z.input<typeof IdeaInput>;

export const IdeaBatch = z.object({
  ideas: z.array(
    z.object({
      title: z.string(),
      angle: z.string(),
      rationale: z.string(),
      pillarName: z.string(),
      audience: z.string(),
      platform: Platform,
      format: Format,
      funnelStage: FunnelStage,
      effort: z.enum(["low", "medium", "high"]),
      seriesName: z.string(),
      evidenceRefs: z.array(z.number().int()), // indices into provided evidence list
      ratings: OpportunityRatings,
      ratingReasons: z.object(Object.fromEntries(OPPORTUNITY_DIMENSIONS.map((d) => [d, z.string()])) as Record<OpportunityDimension, z.ZodString>),
      whyDifferent: z.string(),
    }),
  ),
});
export type IdeaBatch = z.infer<typeof IdeaBatch>;

// ---------------- Briefs ----------------
export const BriefData = z.object({
  workingTitle: z.string(),
  objective: z.string(),
  targetAudience: z.string(),
  audienceProblem: z.string(),
  desiredTakeaway: z.string(),
  coreThesis: z.string(),
  originalAngle: z.string(),
  hooks: z.array(z.string()),
  promise: z.string(),
  outline: z.array(z.object({ section: z.string(), points: z.array(z.string()) })),
  talkingPoints: z.array(z.string()),
  proof: z.array(z.object({ claim: z.string(), support: z.string(), origin: z.enum(["user_supplied", "researched", "needs_verification"]) })),
  requiredAssets: z.array(z.string()),
  visualDirection: z.string(),
  sourceLinks: z.array(z.string()),
  rightsNotes: z.string(),
  cta: z.string(),
  disclosures: z.array(z.string()),
  platform: z.string(),
  format: z.string(),
  constraints: z.string(), // aspect ratio, duration, length where known
  searchIntent: z.string(),
  kpi: z.string(),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
  factCheck: z.array(z.string()),
  sponsored: z.boolean(),
});
export type BriefData = z.infer<typeof BriefData>;

// ---------------- Content drafts ----------------
// A flexible but typed set of fields; which ones are used depends on platform/format.
export const DraftFields = z.object({
  titleOptions: z.array(z.string()),
  hooks: z.array(z.string()),
  body: z.string(), // script, post copy, article — the main text
  caption: z.string(),
  description: z.string(),
  chapters: z.array(z.object({ time: z.string(), label: z.string() })),
  slides: z.array(z.object({ heading: z.string(), text: z.string() })),
  beats: z.array(z.object({ beat: z.string(), visual: z.string(), seconds: z.number().nullable() })),
  hashtags: z.array(z.string()),
  cta: z.string(),
  thumbnailConcepts: z.array(z.string()),
  visualPrompts: z.array(z.string()), // prompts for image/video tools — never factual claims
  pinnedComment: z.string(),
  seoTitle: z.string(),
  metaDescription: z.string(),
  productionNotes: z.string(),
  targetLength: z.string(),
  claimsToVerify: z.array(z.string()),
});
export type DraftFields = z.infer<typeof DraftFields>;

export const DraftOutput = z.object({
  angleLabel: z.string(),
  fields: DraftFields,
  rationale: z.string(),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

export const DraftOptions = z.object({
  voiceStrength: z.enum(["light", "balanced", "strong"]).default("balanced"),
  readingLevel: z.enum(["simple", "standard", "expert"]).default("standard"),
  length: z.enum(["short", "medium", "long"]).default("medium"),
  creativity: z.enum(["conservative", "balanced", "bold"]).default("balanced"),
  variants: z.number().int().min(1).max(3).default(2),
});
export type DraftOptions = z.infer<typeof DraftOptions>;

export const QaJudgement = z.object({
  dimensions: z.object(
    Object.fromEntries(QA_DIMENSIONS.map((d) => [d, z.object({ score: z.number().min(0).max(5), reason: z.string() })])) as Record<
      QaDimension,
      z.ZodObject<{ score: z.ZodNumber; reason: z.ZodString }>
    >,
  ),
  issues: z.array(z.object({ severity: z.enum(["blocker", "warning"]), message: z.string(), fix: z.string() })),
  revisionInstructions: z.string(),
});
export type QaJudgement = z.infer<typeof QaJudgement>;

// ---------------- Repurposing ----------------
export const MomentExtraction = z.object({
  themes: z.array(z.string()),
  moments: z.array(
    z.object({
      label: z.string(),
      start: z.string(), // timestamp or section reference from the transcript
      end: z.string(),
      quote: z.string(),
      whyItWorks: z.string(),
      suggestedPlatform: Platform,
      suggestedFormat: Format,
      contextNeeded: z.string(),
    }),
  ),
});
export type MomentExtraction = z.infer<typeof MomentExtraction>;

// ---------------- Analytics ----------------
export const AnalyticsNarrative = z.object({
  headline: z.string(),
  whatHappened: z.array(z.string()),
  known: z.array(z.string()),
  hypotheses: z.array(z.string()),
  repeat: z.array(z.string()),
  change: z.array(z.string()),
  nextExperiments: z.array(z.object({ hypothesis: z.string(), variable: z.string(), metric: z.string(), threshold: z.string() })),
  memoryCandidates: z.array(z.object({ statement: z.string(), confidence: Confidence })),
});
export type AnalyticsNarrative = z.infer<typeof AnalyticsNarrative>;

export const ExperimentInput = z.object({
  hypothesis: str(1000).min(5),
  variable: str(300).min(1),
  targetMetric: str(200).min(1),
  successThreshold: str(300).min(1),
  startDate: optStr(20),
  endDate: optStr(20),
  status: z.enum(["planned", "running", "completed", "abandoned"]).default("planned"),
  result: optStr(4000),
  decision: optStr(2000),
  contentItemIds: z.array(z.string()).optional().default([]),
});

// ---------------- Agent ----------------
export const AGENT_TASKS = [
  "research_topic",
  "build_strategy",
  "generate_ideas",
  "create_brief",
  "create_drafts",
  "review_draft",
  "repurpose_transcript",
  "plan_calendar",
  "analyze_performance",
  "ask",
] as const;
export const AgentTask = z.enum(AGENT_TASKS);
export type AgentTask = z.infer<typeof AgentTask>;
export const AGENT_TASK_LABELS: Record<AgentTask, string> = {
  research_topic: "Research a topic",
  build_strategy: "Build a strategy",
  generate_ideas: "Generate scored ideas",
  create_brief: "Create a content brief",
  create_drafts: "Draft platform-native content",
  review_draft: "Review a draft (QA)",
  repurpose_transcript: "Repurpose a transcript",
  plan_calendar: "Plan the calendar",
  analyze_performance: "Analyze performance",
  ask: "Ask the strategist",
};

export const AnswerOutput = z.object({
  answer: z.string(),
  recommendation: z.string(),
  evidence: z.array(z.string()),
  assumptions: z.array(z.string()),
  confidence: Confidence,
  nextActions: z.array(z.string()),
  successCriteria: z.array(z.string()),
});
export type AnswerOutput = z.infer<typeof AnswerOutput>;
