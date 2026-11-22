// QA review operation shared by agent runs and the "Run QA" button.
import { DraftOutput, QaJudgement, type BriefData, type DraftFields, type QaDimension } from "../../shared/schemas.js";
import type { Ctx } from "../context.js";
import type { GenerateRequest, GenerateResult } from "../providers/model/types.js";
import { recordUsage } from "../services/usage.js";
import { combineQa, type QaResult } from "../services/qa.js";
import { getBrand } from "../services/brands.js";
import { getBrief, getContentItem, libraryCorpus, normaliseFields, saveQaReview } from "../services/content.js";
import { rightsForItem, sourceTextsForItem } from "../services/assets.js";
import { profileSummary } from "./context.js";
import { system } from "./prompts.js";
import { fenceUntrusted } from "../lib/text.js";

type Gen = <T>(req: GenerateRequest<T>) => Promise<GenerateResult<T>>;

/** Default generator outside agent runs: records usage but has no run budget (single, user-initiated call). */
export function directGenerate(ctx: Ctx, brandId: string): Gen {
  return async (req) => {
    const res = await ctx.model().generate(req);
    recordUsage(ctx.db, { brandId, provider: res.provider, model: res.model, purpose: req.purpose, usage: res.usage });
    return res;
  };
}

export function draftText(f: DraftFields): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : typeof v === "string" ? v.trim() : v != null))),
    null,
    1,
  );
}

export async function reviewVariant(ctx: Ctx, itemId: string, variantId: string | undefined, opts: { useModel: boolean; generate?: Gen }) {
  const item = getContentItem(ctx.db, itemId);
  const vid = variantId ?? item.currentVariantId;
  const variant = item.variants.find((v: any) => v.id === vid);
  if (!variant) throw new Error("Variant not found");
  const brand = getBrand(ctx.db, item.brandId);
  const brief: BriefData | null = item.briefId ? (getBrief(ctx.db, item.briefId).data as BriefData) : null;
  const settings = ctx.settings();
  const fields = normaliseFields(variant.fields);
  const input = {
    fields, platform: item.platform, format: item.format, brief, profile: brand.profile, library: libraryCorpus(ctx.db, item.brandId, itemId),
    sourceTexts: sourceTextsForItem(ctx.db, itemId), assetRights: rightsForItem(ctx.db, itemId), passScore: settings.qaPassScore, weights: settings.qaWeights as Record<QaDimension, number>,
  };
  let judgement: QaJudgement | null = null;
  const model = ctx.model();
  if (opts.useModel && model.live) {
    const gen = opts.generate ?? directGenerate(ctx, item.brandId);
    const rules = combineQa(input, null);
    const res = await gen({
      purpose: "qa.judgement",
      tier: "fast",
      system: system("qa"),
      prompt: `${profileSummary(brand.profile)}\n\nPLATFORM: ${item.platform} / ${item.format}\n\nBRIEF:\n${brief ? JSON.stringify({ objective: brief.objective, audience: brief.targetAudience, problem: brief.audienceProblem, angle: brief.originalAngle, cta: brief.cta, proof: brief.proof, sponsored: brief.sponsored }) : "(no brief)"}\n\nAUTOMATED RULE FINDINGS (already enforced; do not repeat unless you add detail):\n${rules.checks.filter((c) => c.status !== "pass").map((c) => `- ${c.label}: ${c.message}`).join("\n") || "- none"}\n\nDRAFT TO REVIEW:\n${fenceUntrusted("draft", draftText(fields), 20000)}`,
      schema: QaJudgement,
      maxTokens: 4000,
      offline: () => { throw new Error("unreachable"); },
    });
    judgement = res.data;
  }
  const result = combineQa(input, judgement);
  return { review: saveQaReview(ctx.db, itemId, vid, result), result };
}

export async function reviseDraft(ctx: Ctx, gen: Gen, args: { brandId: string; brief: BriefData | null; platform: string; format: string; fields: DraftFields; qa: QaResult }) {
  const brand = getBrand(ctx.db, args.brandId);
  const res = await gen({
    purpose: "draft.revision",
    tier: "strong",
    system: system("revise"),
    prompt: `${profileSummary(brand.profile)}\n\nPLATFORM: ${args.platform} / ${args.format}\nBRIEF: ${args.brief ? JSON.stringify(args.brief) : "(none)"}\n\nISSUES TO FIX:\n${args.qa.revisionInstructions || args.qa.checks.filter((c) => c.status !== "pass").map((c) => `- ${c.label}: ${c.message} → ${c.fix ?? ""}`).join("\n")}\n\nCURRENT DRAFT:\n${fenceUntrusted("draft", draftText(args.fields), 20000)}\n\nReturn the full revised draft.`,
    schema: DraftOutput,
    maxTokens: 12000,
    offline: () => { throw new Error("Revision requires a model."); },
  });
  return res;
}
