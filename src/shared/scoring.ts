// ScoringEngine — deterministic, explainable, configurable. Scores are triage aids, never reach predictions.
import {
  DEFAULT_OPPORTUNITY_WEIGHTS,
  DEFAULT_QA_WEIGHTS,
  OPPORTUNITY_DIMENSIONS,
  QA_DIMENSIONS,
  type Confidence,
  type OpportunityDimension,
  type OpportunityRatings,
  type QaDimension,
} from "./schemas.js";

/** Rating assumed for a dimension with no data: below neutral, so missing data can't inflate a score. */
export const MISSING_RATING = 2;

export interface DimensionBreakdown<D extends string> {
  dimension: D;
  weight: number; // normalised percentage (sums to 100)
  rating: number | null; // 0–5 or null when unknown
  contribution: number; // points out of 100
  missing: boolean;
  reason?: string;
}

export interface OpportunityScore {
  score: number; // 0–100
  maxIfDataFound: number; // score if every missing dimension turned out to be 5/5
  missingPenalty: number; // points lost vs. a neutral 2.5 for unknown dimensions
  coverage: number; // share of weight that has data, 0–1
  confidence: Confidence;
  breakdown: DimensionBreakdown<OpportunityDimension>[];
  note: string;
}

export function normaliseWeights<D extends string>(weights: Record<D, number>, dims: readonly D[]): Record<D, number> {
  const clean = dims.map((d) => Math.max(0, Number.isFinite(weights[d]) ? weights[d] : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  const out = {} as Record<D, number>;
  dims.forEach((d, i) => (out[d] = total > 0 ? (clean[i] / total) * 100 : 100 / dims.length));
  return out;
}

export function scoreOpportunity(
  ratings: Partial<OpportunityRatings>,
  weights: Record<OpportunityDimension, number> = DEFAULT_OPPORTUNITY_WEIGHTS,
  reasons: Partial<Record<OpportunityDimension, string>> = {},
): OpportunityScore {
  const w = normaliseWeights(weights, OPPORTUNITY_DIMENSIONS);
  let score = 0;
  let coverageWeight = 0;
  let maxIfDataFound = 0;
  let missingPenalty = 0;
  const breakdown = OPPORTUNITY_DIMENSIONS.map((d) => {
    const raw = ratings[d];
    const rating = typeof raw === "number" && Number.isFinite(raw) ? clamp(raw, 0, 5) : null;
    const missing = rating === null;
    const used = missing ? MISSING_RATING : rating;
    const contribution = (w[d] * used) / 5;
    score += contribution;
    maxIfDataFound += missing ? w[d] : contribution;
    if (missing) missingPenalty += (w[d] * (2.5 - MISSING_RATING)) / 5;
    else coverageWeight += w[d];
    return { dimension: d, weight: round1(w[d]), rating, contribution: round1(contribution), missing, reason: reasons[d] };
  });
  const coverage = coverageWeight / 100;
  const confidence: Confidence = coverage >= 0.85 ? "high" : coverage >= 0.6 ? "medium" : "low";
  return {
    score: Math.round(score),
    maxIfDataFound: Math.round(maxIfDataFound),
    missingPenalty: round1(missingPenalty),
    coverage: round2(coverage),
    confidence,
    breakdown,
    note: "Prioritisation aid only — not a prediction of views, reach or virality.",
  };
}

export interface QaScore {
  score: number;
  breakdown: DimensionBreakdown<QaDimension>[];
}

export function scoreQa(
  dims: Partial<Record<QaDimension, { score: number; reason?: string }>>,
  weights: Record<QaDimension, number> = DEFAULT_QA_WEIGHTS,
): QaScore {
  const w = normaliseWeights(weights, QA_DIMENSIONS);
  let score = 0;
  const breakdown = QA_DIMENSIONS.map((d) => {
    const entry = dims[d];
    const rating = entry && Number.isFinite(entry.score) ? clamp(entry.score, 0, 5) : null;
    const used = rating ?? MISSING_RATING;
    const contribution = (w[d] * used) / 5;
    score += contribution;
    return { dimension: d, weight: round1(w[d]), rating, contribution: round1(contribution), missing: rating === null, reason: entry?.reason };
  });
  return { score: Math.round(score), breakdown };
}

export function confidenceFromSample(n: number): Confidence {
  return n >= 10 ? "high" : n >= 5 ? "medium" : "low";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
