import { describe, expect, it } from "vitest";
import { scoreOpportunity, scoreQa, normaliseWeights, MISSING_RATING } from "../../src/shared/scoring.js";
import { canTransition, allowedTransitions } from "../../src/shared/status.js";

describe("opportunity scoring", () => {
  it("scores full data with default weights and high confidence", () => {
    const s = scoreOpportunity({ audienceRelevance: 5, demandEvidence: 5, differentiation: 5, brandAlignment: 5, platformFit: 5, feasibility: 5, timeliness: 5 });
    expect(s.score).toBe(100);
    expect(s.confidence).toBe("high");
    expect(s.coverage).toBe(1);
    expect(s.missingPenalty).toBe(0);
  });
  it("penalises missing data and lowers confidence instead of assuming it is good", () => {
    const s = scoreOpportunity({ audienceRelevance: 5, brandAlignment: 5 });
    expect(s.coverage).toBeCloseTo(0.35);
    expect(s.confidence).toBe("low");
    expect(s.missingPenalty).toBeGreaterThan(0);
    // missing dims contribute MISSING_RATING/5 of their weight
    expect(s.score).toBe(Math.round(35 + 65 * (MISSING_RATING / 5)));
    expect(s.maxIfDataFound).toBe(100);
    expect(s.breakdown.find((b) => b.dimension === "demandEvidence")?.missing).toBe(true);
  });
  it("respects configurable weights (normalised)", () => {
    const w = { audienceRelevance: 1, demandEvidence: 0, differentiation: 0, brandAlignment: 0, platformFit: 0, feasibility: 0, timeliness: 0 };
    expect(scoreOpportunity({ audienceRelevance: 4, demandEvidence: 0 }, w).score).toBe(80);
    expect(Object.values(normaliseWeights({ a: 2, b: 2 } as any, ["a", "b"] as any)).reduce((x: number, y: any) => x + y, 0)).toBe(100);
  });
  it("clamps out-of-range ratings", () => {
    expect(scoreOpportunity({ audienceRelevance: 50 } as any).breakdown[0].rating).toBe(5);
  });
});

describe("qa scoring", () => {
  it("weights dimensions into 0–100", () => {
    const all5 = Object.fromEntries(["audienceValue", "originality", "clarityHook", "evidenceAccuracy", "brandFit", "platformFit", "narrative", "ctaAlignment"].map((d) => [d, { score: 5 }]));
    expect(scoreQa(all5).score).toBe(100);
  });
});

describe("content state machine", () => {
  it("allows the documented lifecycle and blocks skipping", () => {
    expect(canTransition("REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("IDEA", "SCHEDULED")).toBe(false);
    expect(allowedTransitions("PUBLISHED")).toEqual(["ANALYZED", "ARCHIVED"]);
  });
});
