import { describe, expect, it } from "vitest";
import { combineQa, findGuaranteeLanguage, BLOCKED_SCORE_CAP } from "../../src/server/services/qa.js";
import { normaliseFields } from "../../src/server/services/content.js";
import { BrandProfile } from "../../src/shared/schemas.js";

const profile = BrandProfile.parse({ name: "B", voice: { phrasesToAvoid: ["game-changer"], vocabulary: ["pantry"] }, compliance: { bannedClaims: ["cures anxiety"] }, audiences: [{ name: "A", problems: ["no time to cook"] }] });
const base = { platform: "youtube_shorts" as const, format: "short_video", brief: null, profile, library: [], passScore: 60 };
const good = normaliseFields({ hooks: ["Stop buying for one recipe."], body: "Stop buying for one recipe.\nPlan three dinners that share five pantry ingredients so you have no time to cook problem solved quickly.\n1. Curry\n2. Rice bowl\n3. Shakshuka", cta: "Get the plan in the newsletter", titleOptions: ["Plan three dinners from one shop"] });

const check = (r: ReturnType<typeof combineQa>, id: string) => r.checks.find((c) => c.id === id);

describe("QA rules", () => {
  it("passes a clean draft", () => {
    const r = combineQa({ ...base, fields: good });
    expect(r.passed).toBe(true);
    expect(r.blockers).toBe(0);
    expect(r.method).toBe("rules");
    expect(r.dimensions).toHaveLength(8);
  });
  it("blocks guarantee language, banned claims and placeholders", () => {
    const r = combineQa({ ...base, fields: { ...good, body: good.body + "\nThis is guaranteed to go viral and cures anxiety. [insert: example]" } });
    expect(check(r, "no_guarantees")?.status).toBe("block");
    expect(check(r, "brand_banned_claims")?.status).toBe("block");
    expect(check(r, "no_placeholders")?.status).toBe("block");
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThanOrEqual(BLOCKED_SCORE_CAP);
    expect(findGuaranteeLanguage("You'll make $5000 a month")).toHaveLength(1);
  });
  it("blocks missing disclosure when sponsored", () => {
    const r = combineQa({ ...base, fields: { ...good, body: good.body + "\nUse my code PAN10 for a discount." } });
    expect(check(r, "disclosure")?.status).toBe("block");
    const ok = combineQa({ ...base, fields: { ...good, body: good.body + "\nPaid partnership with PanCo. Use my code PAN10." } });
    expect(check(ok, "disclosure")?.status).toBe("pass");
  });
  it("blocks near-duplicates of the library, warns on overlap", () => {
    const r = combineQa({ ...base, fields: good, library: [{ id: "x", text: good.body }] });
    expect(check(r, "originality")?.status).toBe("block");
  });
  it("blocks unknown asset rights", () => {
    const r = combineQa({ ...base, fields: good, assetRights: [{ title: "clip", rights: "unknown" }] });
    expect(check(r, "rights")?.status).toBe("block");
  });
  it("warns (not blocks) on bait, avoided phrases, unsupported stats, platform limits", () => {
    const r = combineQa({ ...base, platform: "x", format: "thread", fields: { ...good, body: "x".repeat(300) + "\n\nStudies show 87% of people waste food. Comment YES if you agree! This is a game-changer." } });
    expect(check(r, "no_bait")?.status).toBe("warn");
    expect(check(r, "voice_avoid")?.status).toBe("warn");
    expect(check(r, "claims_supported")?.status).toBe("warn");
    expect(check(r, "platform_format")?.status).toBe("warn");
    expect(r.checks.filter((c) => c.status === "block")).toHaveLength(0);
  });
  it("model judgement can add issues but cannot clear a rule blocker", () => {
    const dims = Object.fromEntries(["audienceValue", "originality", "clarityHook", "evidenceAccuracy", "brandFit", "platformFit", "narrative", "ctaAlignment"].map((d) => [d, { score: 5, reason: "great" }])) as any;
    const r = combineQa({ ...base, fields: { ...good, body: good.body + " Guaranteed results." } }, { dimensions: dims, issues: [{ severity: "blocker", message: "Misleading", fix: "Fix" }], revisionInstructions: "" });
    expect(r.method).toBe("rules+model");
    expect(r.checks.filter((c) => c.status === "block" && c.origin === "rules")).toHaveLength(1);
    expect(r.checks.find((c) => c.origin === "model")?.overridable).toBe(true);
    expect(r.passed).toBe(false);
  });
  it("flags lightly-modified reuse for YouTube monetization originality", () => {
    const r = combineQa({ ...base, fields: good, sourceTexts: [good.body] });
    expect(check(r, "transformative")?.status).toBe("warn");
  });
});
