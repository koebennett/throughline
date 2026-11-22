import type { z } from "zod";

export type ModelTier = "fast" | "strong";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  costUsd: number; // estimate from the public price table
}

export interface GenerateRequest<T> {
  purpose: string; // logged in usage records, e.g. "strategy.synthesis"
  tier: ModelTier;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Deterministic scaffold used when no model is configured. Must be honest about being a scaffold. */
  offline: () => T;
}

export interface GenerateResult<T> {
  data: T;
  provider: string;
  model: string; // model id, or "offline-scaffold"
  usage: Usage;
}

export interface WebSource {
  url: string;
  title: string;
  pageAge: string | null;
}

export interface WebResearchResult {
  text: string;
  sources: WebSource[];
  citations: { url: string; title: string; citedText: string }[];
  usage: Usage;
  model: string;
}

export interface ModelProvider {
  id: string;
  label: string;
  /** true only for a real, configured model. The offline scaffold is never "live". */
  live: boolean;
  models: Record<ModelTier, string>;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
  /** Live web research with citations, if the provider supports it. */
  webResearch?(query: string, opts: { maxSearches: number; system: string }): Promise<WebResearchResult>;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, webSearches: 0, costUsd: 0 };

export class ModelRefusalError extends Error {}
export class ModelOutputError extends Error {}
export class BudgetExceededError extends Error {}
