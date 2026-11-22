// Context retrieval: load ONLY what a task needs, compactly, with citation handles.
// User-owned docs, web excerpts and transcripts are fenced as untrusted data.
import type { BrandProfile, StrategyDraft } from "../../shared/schemas.js";
import { EVIDENCE_KIND_LABELS } from "../../shared/schemas.js";
import type { Ctx } from "../context.js";
import { fenceUntrusted, tokens, truncate } from "../lib/text.js";
import { getBrand } from "../services/brands.js";
import { approvedMemory, retrieve, type Snippet } from "../services/brain.js";
import { activeStrategy, listPillars } from "../services/strategy.js";
import { listEvidence } from "../services/research.js";
import { analyze } from "../services/analytics.js";

export interface EvidenceRef {
  ref: string; // E1, E2…
  id: string;
  claim: string;
  kind: string;
  confidence: string;
  source: string; // "Title — publisher (date)" or ""
  url: string;
}

export interface ContextPack {
  profile: BrandProfile;
  strategy: StrategyDraft | null;
  pillars: { id: string; name: string; purpose: string; audienceNeed: string }[];
  evidence: EvidenceRef[];
  snippets: Snippet[];
  memory: { statement: string; layer: string }[];
  analyticsInsights: string[];
  text: string;
}

export function profileSummary(p: BrandProfile): string {
  const lines = [
    `Brand: ${p.name}${p.niche ? ` — niche: ${p.niche}` : ""}`,
    p.description && `About: ${truncate(p.description, 600)}`,
    p.objective && `Objective: ${p.objective}`,
    p.offer && `Offer: ${truncate(p.offer, 400)}`,
    p.monetization && `Monetization: ${p.monetization}`,
    p.positioning && `Positioning: ${truncate(p.positioning, 400)}`,
    p.pointOfView && `Point of view: ${truncate(p.pointOfView, 400)}`,
    p.differentiators.length && `Differentiators: ${p.differentiators.join("; ")}`,
    p.proof.length && `Proof the brand can truthfully cite (user-supplied): ${p.proof.join("; ")}`,
    ...p.audiences.map(
      (a, i) =>
        `Audience ${i + 1} — ${a.name} (${a.knowledgeLevel}): ${a.description}. Problems: ${a.problems.join("; ") || "unknown"}. Desires: ${a.desires.join("; ") || "unknown"}. Objections: ${a.objections.join("; ") || "unknown"}. Their words: ${a.language.join(", ") || "unknown"}. Transformation: ${a.transformation || "unknown"}.`,
    ),
    p.platforms.length && `Platforms: ${p.platforms.map((x) => `${x.platform}${x.role ? ` (${x.role})` : ""}`).join(", ")}`,
    `Capacity: ${p.capacity.hoursPerWeek ?? "?"} h/week, target ${p.capacity.postsPerWeekTarget ?? "?"} pieces/week. Team: ${p.capacity.team || "unspecified"}. Equipment: ${p.capacity.equipment || "unspecified"}. Constraints: ${p.capacity.constraints || "none stated"}.`,
    `Voice: ${p.voice.traits.join(", ") || "unspecified"}; tone ${p.voice.tone || "unspecified"}; reading level ${p.voice.readingLevel}. Use: ${p.voice.phrasesToUse.join("; ") || "-"}. Avoid: ${p.voice.phrasesToAvoid.join("; ") || "-"}.`,
    p.ctas.length && `Preferred CTAs: ${p.ctas.join("; ")}`,
    (p.compliance.bannedClaims.length || p.compliance.requiredDisclosures.length) && `Compliance — banned claims: ${p.compliance.bannedClaims.join("; ") || "-"}; required disclosures: ${p.compliance.requiredDisclosures.join("; ") || "-"}. ${p.compliance.notes}`,
    p.competitors.length && `Competitors/references: ${p.competitors.map((c) => `${c.name} (${c.kind}${c.notes ? `: ${truncate(c.notes, 120)}` : ""})`).join("; ")}`,
    p.likes.length && `Content the user likes: ${p.likes.join("; ")}`,
    p.dislikes.length && `Content the user dislikes: ${p.dislikes.join("; ")}`,
    p.topicsOfExpertise.length && `Topics of expertise: ${p.topicsOfExpertise.join(", ")}`,
    p.geography && `Geography: ${p.geography}; languages: ${p.languages.join(", ") || "-"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildContext(ctx: Ctx, brandId: string, opts: { query?: string; evidenceLimit?: number; includeAnalytics?: boolean; snippetLimit?: number } = {}): ContextPack {
  const { db } = ctx;
  const brand = getBrand(db, brandId);
  const strategyRow = activeStrategy(db, brandId);
  const strategy = (strategyRow?.data as StrategyDraft) ?? null;
  const pillars = listPillars(db, brandId).map((p: any) => ({ id: p.id, name: p.name, purpose: p.purpose, audienceNeed: p.audienceNeed }));
  const q = opts.query ?? "";
  const qTok = new Set(tokens(q));
  const allEvidence = listEvidence(db, brandId);
  const ranked = q
    ? [...allEvidence].sort((a: any, b: any) => overlap(b.claim + " " + b.topic, qTok) - overlap(a.claim + " " + a.topic, qTok))
    : allEvidence;
  const evidence: EvidenceRef[] = ranked.slice(0, opts.evidenceLimit ?? 25).map((e: any, i: number) => ({
    ref: `E${i + 1}`,
    id: e.id,
    claim: e.claim,
    kind: e.kind,
    confidence: e.confidence,
    source: e.sourceTitle ? `${e.sourceTitle}${e.sourcePublisher ? ` — ${e.sourcePublisher}` : ""}${e.sourcePublishedAt ? ` (${String(e.sourcePublishedAt).slice(0, 10)})` : ""}` : "",
    url: e.sourceUrl ?? "",
  }));
  const snippets = q ? retrieve(db, brandId, q, opts.snippetLimit ?? 5) : [];
  const memory = approvedMemory(db, brandId).map((m) => ({ statement: m.statement, layer: m.layer }));
  const analyticsInsights = opts.includeAnalytics === false ? [] : analyze(db, brandId).platforms.flatMap((p) => p.insights.map((i) => `[${p.platform}, n=${p.n}, ${i.kind}, ${i.confidence} confidence] ${i.text}`));

  const parts = [
    "## BRAND PROFILE (user-provided, approved)",
    profileSummary(brand.profile),
    strategy && "## APPROVED STRATEGY",
    strategy && `Positioning: ${strategy.positioning}\nPillars: ${pillars.map((p) => `${p.name} — ${p.purpose}`).join(" | ")}\nCadence: ${strategy.cadence.summary}`,
    !strategy && pillars.length > 0 && `## PILLARS\n${pillars.map((p) => `${p.name} — ${p.purpose}`).join("\n")}`,
    memory.length > 0 && `## APPROVED LEARNINGS (brand memory)\n${memory.map((m) => `- [${m.layer}] ${m.statement}`).join("\n")}`,
    `## EVIDENCE ON FILE (${evidence.length}${allEvidence.length > evidence.length ? ` most relevant of ${allEvidence.length}` : ""})`,
    evidence.length ? evidence.map((e) => `${e.ref} [${EVIDENCE_KIND_LABELS[e.kind as keyof typeof EVIDENCE_KIND_LABELS] ?? e.kind}; ${e.confidence}] ${e.claim}${e.source ? ` — source: ${e.source}` : " — no source"}`).join("\n") : "(none — treat all market claims as hypotheses)",
    analyticsInsights.length > 0 && `## OWN-ACCOUNT ANALYTICS (descriptive)\n${analyticsInsights.slice(0, 10).join("\n")}`,
    snippets.length > 0 && `## BRAND DOCUMENT SNIPPETS (cite as [Doc: title])\n${snippets.map((s) => fenceUntrusted(`Doc: ${s.citation}`, s.text, 1500)).join("\n")}`,
  ];
  return { profile: brand.profile, strategy, pillars, evidence, snippets, memory, analyticsInsights, text: parts.filter(Boolean).join("\n\n") };
}

const overlap = (text: string, q: Set<string>) => tokens(text).filter((t) => q.has(t)).length;
