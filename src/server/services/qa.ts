// QA / Safety review. Deterministic rules decide hard blockers; an optional model judgement can ADD issues and
// refine dimension scores, but can never remove a rule-based blocker. The 0–100 rubric is a triage aid only.
import type { BriefData, BrandProfile, DraftFields, Platform, QaDimension, QaJudgement } from "../../shared/schemas.js";
import { QA_DIMENSIONS } from "../../shared/schemas.js";
import { PLATFORM_SPECS } from "../../shared/platforms.js";
import { scoreQa } from "../../shared/scoring.js";
import { normalise, similarity, tokens, truncate } from "../lib/text.js";

export type CheckStatus = "pass" | "warn" | "block";
export const BLOCKED_SCORE_CAP = 49;
export interface QaCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  fix?: string;
  origin: "rules" | "model";
  overridable: boolean; // rule blockers are never overridable; model-raised blockers can be overridden with a note
}

export interface QaInput {
  fields: DraftFields;
  platform: Platform;
  format: string;
  brief?: BriefData | null;
  profile: BrandProfile;
  library: { id: string; text: string }[]; // other content by this brand (excluding this item's own variants)
  sourceTexts?: string[]; // transcripts/sources this item was derived from (repurposing)
  assetRights?: { title: string; rights: string }[];
  passScore: number;
  weights?: Record<QaDimension, number>;
}

export interface QaResult {
  score: number;
  dimensions: ReturnType<typeof scoreQa>["breakdown"];
  checks: QaCheck[];
  blockers: number;
  warnings: number;
  passed: boolean;
  method: "rules" | "rules+model";
  revisionInstructions: string;
  note: string;
}

const GUARANTEE = [
  /\bguarantee[sd]?\b/i,
  /\b(will|gonna|going to) go viral\b/i,
  /\b100\s?% (success|results|guaranteed|proven)\b/i,
  /\b(get rich|overnight success)\b/i,
  /\b(you will|you'll) (make|earn) \$?\d/i,
  /\brisk[- ]free\b/i,
  /\b(instant|guaranteed) (monetization|approval|growth|followers|subscribers)\b/i,
];
export function findGuaranteeLanguage(text: string): string[] {
  return GUARANTEE.flatMap((re) => {
    const m = text.match(re);
    return m ? [m[0]] : [];
  });
}

const BAIT = [
  /\bcomment ["'“]?\w+["'”]? (below )?(if|and|to)\b/i,
  /\blike (this|if)\b/i,
  /\btag (\d+|a|two|three|your) friends?\b/i,
  /\bsmash (that|the) (like|subscribe)\b/i,
  /\bshare (this )?(with|to) (\d+|everyone|10)\b/i,
  /\bfollow for part \d\b/i,
];
const PLACEHOLDER_CI = /\[(verify|fact[- ]?check|citation needed|source|todo|tbd|insert[^\]]*)\]|\{\{[^}]+\}\}/i;
const PLACEHOLDER_CS = /\bTODO\b|\bXXX+\b|\bTBD\b/; // case-sensitive: "xxx" in normal text is not a marker
const findPlaceholder = (t: string) => t.match(PLACEHOLDER_CI) ?? t.match(PLACEHOLDER_CS);
const STAT = /(\b\d{1,3}(\.\d+)?\s?%|\b(studies|research|data|surveys?) (show|shows|found|suggests?)\b|\baccording to\b|\b\d+x (more|faster|better)\b)/i;
const SPONSOR_SIGNALS = /\b(sponsored by|affiliate|use (my|the) code|discount code|link in (my )?bio to (buy|shop)|paid partnership|commission)\b/i;
const DISCLOSURE = /(#ad\b|#sponsored|\bsponsored\b|paid partnership|\baffiliate (link|disclosure)|i (may )?earn a (small )?commission|\bad\b:)/i;
const ENDORSE = /\b(as seen on|endorsed by|recommended by|approved by) [A-Z][\w&.]+/;
const WEAK_OPENERS = /^(hey|hi|hello) (guys|everyone|friends)|^in this (video|post)|^welcome back|^so today/i;

function allText(f: DraftFields): string {
  return [
    ...f.titleOptions, ...f.hooks, f.body, f.caption, f.description, ...f.slides.map((s) => `${s.heading} ${s.text}`),
    ...f.beats.map((b) => b.beat), f.cta, f.pinnedComment, f.seoTitle, f.metaDescription, ...f.chapters.map((c) => c.label),
  ].filter(Boolean).join("\n");
}
/** Publishable text only (excludes production notes and visual prompts). */
export function publishableText(f: DraftFields): string {
  return allText(f);
}

export function runQaRules(input: QaInput): { checks: QaCheck[]; dims: Partial<Record<QaDimension, { score: number; reason: string }>> } {
  const { fields: f, profile, brief } = input;
  const text = allText(f);
  const body = f.body || f.caption || f.slides.map((s) => s.text).join("\n") || f.beats.map((b) => b.beat).join("\n");
  const checks: QaCheck[] = [];
  const add = (c: Omit<QaCheck, "origin" | "overridable">) => checks.push({ ...c, origin: "rules", overridable: false });

  // --- Hard blockers ---
  add(body.trim().length < 20
    ? { id: "has_content", label: "Has substantive content", status: "block", message: "The draft has no meaningful body/script/caption.", fix: "Write or generate the main copy." }
    : { id: "has_content", label: "Has substantive content", status: "pass", message: "Main copy present." });

  const placeholder = findPlaceholder(text);
  add(placeholder
    ? { id: "no_placeholders", label: "No unresolved placeholders", status: "block", message: `Unresolved marker "${placeholder[0]}" — the draft is not finished.`, fix: "Replace scaffold markers with real, verified content." }
    : { id: "no_placeholders", label: "No unresolved placeholders", status: "pass", message: "No scaffold markers left." });

  const g = findGuaranteeLanguage(text);
  add(g.length
    ? { id: "no_guarantees", label: "No guarantee / hype claims", status: "block", message: `Promises outcomes: ${g.join(", ")}.`, fix: "Describe what the audience will learn or try, not guaranteed results." }
    : { id: "no_guarantees", label: "No guarantee / hype claims", status: "pass", message: "No outcome guarantees found." });

  const banned = profile.compliance.bannedClaims.filter((b) => b.trim() && normalise(text).includes(normalise(b)));
  add(banned.length
    ? { id: "brand_banned_claims", label: "Brand compliance restrictions", status: "block", message: `Uses banned claim(s): ${banned.join("; ")}.`, fix: "Remove or rephrase per the brand's compliance rules." }
    : { id: "brand_banned_claims", label: "Brand compliance restrictions", status: "pass", message: "No banned claims used." });

  const needsDisclosure = !!brief?.sponsored || SPONSOR_SIGNALS.test(text);
  if (needsDisclosure)
    add(DISCLOSURE.test(text)
      ? { id: "disclosure", label: "Sponsorship / affiliate disclosure", status: "pass", message: "Disclosure present." }
      : { id: "disclosure", label: "Sponsorship / affiliate disclosure", status: "block", message: "Sponsored or affiliate signals found but no clear disclosure.", fix: "Add a clear disclosure (e.g. “#ad”, “Paid partnership with…”, “I earn a commission”) and use the platform's paid-promotion setting." });

  const badRights = (input.assetRights ?? []).filter((a) => a.rights === "unknown");
  if (input.assetRights?.length)
    add(badRights.length
      ? { id: "rights", label: "Asset rights confirmed", status: "block", message: `Rights unknown for: ${badRights.map((a) => a.title).join(", ")}.`, fix: "Confirm the asset is owned, licensed, public domain or permissioned in the Repurposing Studio." }
      : { id: "rights", label: "Asset rights confirmed", status: "pass", message: "All linked assets have confirmed rights." });

  // Near-duplicate of the brand's own library
  let maxSim = 0;
  let dupOf = "";
  for (const c of input.library) {
    const s = similarity(body, c.text);
    if (s > maxSim) (maxSim = s), (dupOf = c.text);
  }
  if (maxSim >= 0.85) add({ id: "originality", label: "Not a near-duplicate", status: "block", message: `Near-duplicate (${Math.round(maxSim * 100)}% similar) of existing content: “${truncate(dupOf, 80)}”.`, fix: "Add a distinct insight, story, example or angle — or archive one of them." });
  else if (maxSim >= 0.6) add({ id: "originality", label: "Not a near-duplicate", status: "warn", message: `Overlaps heavily (${Math.round(maxSim * 100)}%) with existing content.`, fix: "Make the unique angle explicit and change examples." });
  else add({ id: "originality", label: "Not a near-duplicate", status: "pass", message: maxSim > 0 ? `Max similarity to library ${Math.round(maxSim * 100)}%.` : "No comparable content in library." });

  // --- Soft warnings ---
  const statSentences = splitSentences(text).filter((s) => STAT.test(s));
  const hasSupport = (brief?.proof ?? []).some((p) => p.origin !== "needs_verification") || (brief?.sourceLinks ?? []).length > 0;
  if (statSentences.length && !hasSupport)
    add({ id: "claims_supported", label: "Claims supported", status: "warn", message: `${statSentences.length} statistic/research claim(s) without linked support, e.g. “${truncate(statSentences[0], 90)}”.`, fix: "Add the source to the brief or rephrase as opinion/experience." });
  else add({ id: "claims_supported", label: "Claims supported", status: "pass", message: statSentences.length ? "Claims have brief-level support; spot-check before publishing." : "No statistical claims detected." });

  if (f.claimsToVerify.length)
    add({ id: "fact_check", label: "Fact-check list cleared", status: "warn", message: `${f.claimsToVerify.length} claim(s) flagged for verification: ${f.claimsToVerify.slice(0, 2).map((c) => `“${truncate(c, 60)}”`).join(", ")}.`, fix: "Verify each claim and remove it from the list, or cut the claim." });

  const bait = BAIT.map((re) => text.match(re)?.[0]).filter(Boolean) as string[];
  add(bait.length
    ? { id: "no_bait", label: "No engagement bait", status: "warn", message: `Engagement-bait phrasing: ${bait.join(", ")}.`, fix: "Ask a genuine question tied to the content or give a useful next step instead." }
    : { id: "no_bait", label: "No engagement bait", status: "pass", message: "CTA phrasing is not bait." });

  const avoid = profile.voice.phrasesToAvoid.filter((p) => p.trim() && normalise(text).includes(normalise(p)));
  if (avoid.length) add({ id: "voice_avoid", label: "Brand voice: phrases to avoid", status: "warn", message: `Uses phrases the brand avoids: ${avoid.join(", ")}.`, fix: "Swap for the brand's own vocabulary." });

  const hook = f.hooks[0] || firstLine(body);
  const hookWords = hook.split(/\s+/).filter(Boolean).length;
  if (!hook) add({ id: "hook", label: "Clear opening hook", status: "warn", message: "No opening hook.", fix: "Open with the problem, tension or payoff in one line." });
  else if (WEAK_OPENERS.test(hook.trim())) add({ id: "hook", label: "Clear opening hook", status: "warn", message: `Opening “${truncate(hook, 50)}” delays the value.`, fix: "Lead with the insight or tension; cut the greeting." });
  else if (hookWords > 30) add({ id: "hook", label: "Clear opening hook", status: "warn", message: `Hook is ${hookWords} words — long for an opener.`, fix: "Tighten to one sentence." });
  else add({ id: "hook", label: "Clear opening hook", status: "pass", message: "Hook present and concise." });

  add(f.cta.trim() || /\b(subscribe|sign up|download|join|reply|book|try|read|watch|save this)\b/i.test(body)
    ? { id: "cta", label: "Has an appropriate CTA", status: "pass", message: "CTA present." }
    : { id: "cta", label: "Has an appropriate CTA", status: "warn", message: "No CTA tied to the objective.", fix: brief?.cta ? `Consider the brief's CTA: “${truncate(brief.cta, 60)}”.` : "Add one clear next step." });

  const spec = PLATFORM_SPECS[input.platform];
  const limitIssues: string[] = [];
  const longestTitle = Math.max(0, ...f.titleOptions.map((t) => t.length));
  if (spec.limits.title && longestTitle > spec.limits.title) limitIssues.push(`a title option is ${longestTitle} chars (limit ~${spec.limits.title})`);
  if (spec.limits.caption && f.caption.length > spec.limits.caption) limitIssues.push(`caption is ${f.caption.length} chars (limit ~${spec.limits.caption})`);
  if (spec.limits.description && f.description.length > spec.limits.description) limitIssues.push(`description is ${f.description.length} chars (limit ~${spec.limits.description})`);
  if (spec.limits.hashtags && f.hashtags.length > spec.limits.hashtags) limitIssues.push(`${f.hashtags.length} hashtags (limit ~${spec.limits.hashtags})`);
  if (spec.limits.body) {
    const parts = input.format === "thread" ? f.body.split(/\n\s*\n/) : [f.body];
    const over = parts.filter((p) => p.length > spec.limits.body!);
    if (over.length) limitIssues.push(input.format === "thread" ? `${over.length} thread post(s) exceed ~${spec.limits.body} chars` : `body is ${f.body.length} chars (limit ~${spec.limits.body})`);
  }
  const missingFormat = formatGaps(input.format, input.platform, f);
  add(limitIssues.length || missingFormat.length
    ? { id: "platform_format", label: "Platform & format fit", status: "warn", message: [...limitIssues, ...missingFormat].join("; ") + ".", fix: `Adapt to ${spec.label} (limits are commonly documented values — verify in the platform's current docs).` }
    : { id: "platform_format", label: "Platform & format fit", status: "pass", message: `Fits common ${spec.label} limits.` });

  const stuffing = keywordStuffing(body, f.hashtags);
  if (stuffing) add({ id: "seo_natural", label: "Natural SEO (no keyword stuffing)", status: "warn", message: stuffing, fix: "Use the keyword where it reads naturally; vary phrasing." });

  const titleToks = new Set(f.titleOptions.flatMap((t) => tokens(t)));
  const bodyToks = new Set(tokens(body));
  if (titleToks.size >= 3) {
    const overlap = [...titleToks].filter((t) => bodyToks.has(t)).length / titleToks.size;
    if (overlap < 0.3) add({ id: "packaging_truthful", label: "Title/thumbnail match the content", status: "warn", message: `Only ${Math.round(overlap * 100)}% of title terms appear in the content — packaging may over-promise.`, fix: "Make sure the content delivers exactly what the title promises." });
    else add({ id: "packaging_truthful", label: "Title/thumbnail match the content", status: "pass", message: "Title terms are reflected in the content." });
  }

  const endorse = text.match(ENDORSE);
  if (endorse) add({ id: "endorsement", label: "No fake endorsement / impersonation", status: "warn", message: `“${endorse[0]}” — confirm this endorsement is real and you may reference it.`, fix: "Remove unless documented and permitted." });

  if (f.visualPrompts.length)
    add({ id: "ai_disclosure", label: "AI/synthetic media disclosure", status: "warn", message: "Includes AI image/video prompts. Realistic synthetic or altered media may require a platform disclosure label.", fix: "Use the platform's altered/synthetic content disclosure where it applies." });

  if (input.sourceTexts?.length) {
    const reuse = Math.max(...input.sourceTexts.map((s) => similarity(body, s.slice(0, 20000))));
    if (reuse > 0.7 && (input.platform === "youtube" || input.platform === "youtube_shorts"))
      add({ id: "transformative", label: "Reused content is transformative", status: "warn", message: `Derivative is ${Math.round(reuse * 100)}% similar to its source. YouTube's monetization policy treats repetitive or lightly modified reused content as ineligible.`, fix: "Add significant original commentary, education or substantive modification. (This check does not predict YPP decisions.)" });
  }

  // --- Heuristic dimension scores (0–5) ---
  const audienceToks = new Set(tokens(`${brief?.audienceProblem ?? ""} ${brief?.targetAudience ?? ""} ${profile.audiences.flatMap((a) => a.problems).join(" ")}`));
  const audienceOverlap = audienceToks.size ? [...audienceToks].filter((t) => bodyToks.has(t)).length / audienceToks.size : 0;
  const concrete = /(\n\s*(\d+[.)]|-|•)\s)|\b(step|example|for instance|here's how|template|checklist|mistake)\b/i.test(body);
  const words = body.split(/\s+/).filter(Boolean).length;
  const angleToks = tokens(brief?.originalAngle ?? "");
  const angleHit = angleToks.length ? angleToks.filter((t) => bodyToks.has(t)).length / angleToks.length : 0;
  const vocab = profile.voice.vocabulary.concat(profile.voice.phrasesToUse).filter((v) => normalise(text).includes(normalise(v))).length;
  const structureCount = f.slides.length + f.beats.length + f.chapters.length + (body.match(/^#{1,3} |\n\s*\d+[.)] /gm)?.length ?? 0);
  const avgSentence = words / Math.max(1, splitSentences(body).length);

  const dims: Partial<Record<QaDimension, { score: number; reason: string }>> = {
    audienceValue: { score: clamp5(2 + (audienceOverlap >= 0.15 ? 1.25 : audienceOverlap > 0 ? 0.5 : 0) + (concrete ? 1 : 0) + (words >= 60 ? 0.75 : 0)), reason: `Audience-problem overlap ${Math.round(audienceOverlap * 100)}%; ${concrete ? "has concrete steps/examples" : "few concrete steps/examples"}.` },
    originality: { score: clamp5(5 - Math.max(0, maxSim - 0.3) * 6 + (angleHit >= 0.3 ? 0.5 : -0.5)), reason: `Max library similarity ${Math.round(maxSim * 100)}%; unique angle ${angleHit >= 0.3 ? "reflected" : "not clearly reflected"} in copy.` },
    clarityHook: { score: clamp5((hook ? 2 : 0) + (hookWords && hookWords <= 25 ? 1 : 0) + (avgSentence <= 22 ? 1 : 0) + (hook && !WEAK_OPENERS.test(hook.trim()) ? 1 : 0)), reason: `Hook ${hook ? `${hookWords} words` : "missing"}; average sentence ${Math.round(avgSentence)} words.` },
    evidenceAccuracy: { score: clamp5(4 - (hasSupport ? 0 : Math.min(3, statSentences.length)) - (f.claimsToVerify.length ? 1.5 : 0) + (hasSupport ? 1 : 0) - (g.length ? 2 : 0)), reason: `${statSentences.length} statistical claim(s); ${hasSupport ? "brief has support" : "no linked support"}; ${f.claimsToVerify.length} to verify.` },
    brandFit: { score: clamp5(3 + Math.min(1.5, vocab * 0.5) - avoid.length - banned.length * 2), reason: `${vocab} brand vocabulary hit(s); ${avoid.length} avoided phrase(s) used.` },
    platformFit: { score: clamp5(5 - limitIssues.length - missingFormat.length), reason: limitIssues.length || missingFormat.length ? [...limitIssues, ...missingFormat].join("; ") : `Fits ${spec.label} format.` },
    narrative: { score: clamp5(structureCount >= 3 ? 4.5 : structureCount >= 1 ? 3.5 : words > 120 ? 2.5 : 3), reason: `${structureCount} structural element(s) (sections/slides/beats/chapters).` },
    ctaAlignment: { score: clamp5((f.cta.trim() ? 3 : 1.5) + (brief?.cta && tokens(brief.cta).some((t) => tokens(f.cta).includes(t)) ? 2 : 0) - (bait.length ? 2 : 0)), reason: f.cta ? `CTA: “${truncate(f.cta, 60)}”.` : "No explicit CTA." },
  };
  return { checks, dims };
}

export function combineQa(input: QaInput, judgement?: QaJudgement | null): QaResult {
  const { checks, dims } = runQaRules(input);
  let finalDims = dims;
  let revisionInstructions = "";
  if (judgement) {
    finalDims = Object.fromEntries(
      QA_DIMENSIONS.map((d) => {
        const m = judgement.dimensions[d];
        const h = dims[d]!;
        // Model score refines the heuristic but cannot exceed it by more than 1.5 where rules found problems.
        const score = Math.min(m.score, h.score + 1.5);
        return [d, { score: Math.round(((score + h.score) / 2) * 10) / 10, reason: m.reason || h.reason }];
      }),
    ) as typeof dims;
    judgement.issues.forEach((iss, i) =>
      checks.push({ id: `model_${i}`, label: "Editor review", status: iss.severity === "blocker" ? "block" : "warn", message: iss.message, fix: iss.fix, origin: "model", overridable: true }),
    );
    revisionInstructions = judgement.revisionInstructions;
  }
  const qa = scoreQa(finalDims, input.weights);
  const blockers = checks.filter((c) => c.status === "block").length;
  // A draft with open hard blockers is not "good" however well it scores on the rubric — cap it visibly.
  if (blockers > 0 && qa.score > BLOCKED_SCORE_CAP) {
    checks.push({ id: "score_capped", label: "Score capped by blockers", status: "warn", message: `Rubric score ${qa.score} is capped at ${BLOCKED_SCORE_CAP} until hard blockers are fixed.`, origin: "rules", overridable: false });
    qa.score = BLOCKED_SCORE_CAP;
  }
  const warnings = checks.filter((c) => c.status === "warn").length;
  if (qa.score < input.passScore)
    checks.push({ id: "score_threshold", label: "Quality score threshold", status: "warn", message: `Score ${qa.score} is below your pass threshold (${input.passScore}).`, fix: "Address the weakest dimensions shown in the rubric.", origin: "rules", overridable: false });
  if (!revisionInstructions) revisionInstructions = checks.filter((c) => c.status !== "pass" && c.fix).map((c) => `- ${c.label}: ${c.fix}`).join("\n");
  return {
    score: qa.score,
    dimensions: qa.breakdown,
    checks,
    blockers,
    warnings: Math.max(warnings, checks.filter((c) => c.status === "warn").length),
    passed: blockers === 0,
    method: judgement ? "rules+model" : "rules",
    revisionInstructions,
    note: "Quality rubric for triage — not a prediction of reach, ranking or monetization.",
  };
}

function formatGaps(format: string, platform: Platform, f: DraftFields): string[] {
  const gaps: string[] = [];
  if (format === "carousel" && f.slides.length < 3) gaps.push("carousel has fewer than 3 slides");
  if (format === "short_video" && !f.beats.length && f.body.length < 40) gaps.push("short video has no beat sheet or script");
  if (platform === "youtube" && !f.description.trim()) gaps.push("YouTube description missing");
  if (platform === "youtube" && f.chapters.length && !/^(0{1,2}:)?0{1,2}:00$/.test(f.chapters[0].time.trim())) gaps.push("first chapter should start at 00:00");
  if ((platform === "youtube" || platform === "blog" || platform === "newsletter" || platform === "podcast") && !f.titleOptions.length) gaps.push("no title options");
  if (platform === "blog" && !f.metaDescription.trim()) gaps.push("meta description missing");
  return gaps;
}

function keywordStuffing(body: string, hashtags: string[]): string | null {
  if (hashtags.length > 15) return `${hashtags.length} hashtags reads as spammy.`;
  const toks = tokens(body).filter((t) => t.length >= 4);
  if (toks.length < 80) return null;
  const counts = new Map<string, number>();
  toks.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / toks.length > 0.05 ? `“${top}” is ${Math.round((n / toks.length) * 100)}% of meaningful words.` : null;
}

const splitSentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const firstLine = (s: string) => s.split(/\n/).map((x) => x.trim()).find(Boolean) ?? "";
const clamp5 = (n: number) => Math.round(Math.min(5, Math.max(0, n)) * 10) / 10;
