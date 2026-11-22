import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { GenerateRequest, GenerateResult, ModelProvider, WebResearchResult, WebSource } from "./types.js";
import { ModelOutputError, ModelRefusalError } from "./types.js";
import { estimateCost } from "./pricing.js";

// Models that support server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface AnthropicConfig {
  apiKey: string;
  baseURL?: string;
  strongModel: string;
  fastModel: string;
}

export class AnthropicProvider implements ModelProvider {
  id = "anthropic";
  label = "Claude (Anthropic API)";
  live = true;
  models: { fast: string; strong: string };
  private client: Anthropic;

  constructor(cfg: AnthropicConfig, client?: Anthropic) {
    this.models = { strong: cfg.strongModel, fast: cfg.fastModel };
    // baseURL is explicit so an ambient ANTHROPIC_BASE_URL (e.g. from a dev tool) is never picked up silently.
    this.client = client ?? new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || "https://api.anthropic.com", maxRetries: 2, timeout: 180_000 });
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = this.models[req.tier];
    const useFallback = FALLBACK_MODELS.has(model);
    const response = await this.client.beta.messages.parse({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: req.effort ?? (req.tier === "fast" ? "low" : "medium"), format: zodOutputFormat(req.schema as any) },
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    });
    const usage = toUsage(response.model ?? model, response.usage);
    if (response.stop_reason === "refusal") {
      const cat = response.stop_details?.category ?? "unspecified";
      throw new ModelRefusalError(`The model declined this request (category: ${cat}).`);
    }
    if (response.stop_reason === "max_tokens") throw new ModelOutputError("Model output was cut off (max_tokens). Try a smaller request.");
    const parsed = response.parsed_output as T | null;
    if (parsed == null) throw new ModelOutputError("Model output did not match the expected schema.");
    const check = req.schema.safeParse(parsed);
    if (!check.success) throw new ModelOutputError(`Schema validation failed: ${check.error.issues[0]?.message ?? "unknown"}`);
    return { data: check.data, provider: this.id, model: response.model ?? model, usage };
  }

  /** Cheap connectivity/key check: retrieves the configured model's metadata (no tokens billed). */
  async ping(): Promise<{ ok: true; model: string }> {
    const m = await this.client.models.retrieve(this.models.strong);
    return { ok: true, model: m.id };
  }

  async webResearch(query: string, opts: { maxSearches: number; system: string }): Promise<WebResearchResult> {
    const model = this.models.strong;
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
    const sources = new Map<string, WebSource>();
    const citations: WebResearchResult["citations"] = [];
    let text = "";
    let inputTokens = 0, outputTokens = 0, cacheRead = 0, searches = 0;
    for (let turn = 0; turn < 4; turn++) {
      const res = await this.client.messages.create({
        model,
        max_tokens: 16000,
        system: opts.system,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches }],
      });
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;
      cacheRead += res.usage.cache_read_input_tokens ?? 0;
      searches += (res.usage as any).server_tool_use?.web_search_requests ?? 0;
      if (res.stop_reason === "refusal") throw new ModelRefusalError("The model declined this research request.");
      for (const block of res.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, { url: r.url, title: r.title, pageAge: r.page_age ?? null });
        } else if (block.type === "text") {
          text += block.text;
          for (const c of block.citations ?? []) {
            if (c.type === "web_search_result_location") citations.push({ url: c.url, title: c.title ?? "", citedText: c.cited_text });
          }
        }
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    return { text, sources: [...sources.values()], citations, model, usage: { inputTokens, outputTokens, cacheReadTokens: cacheRead, webSearches: searches, costUsd: estimateCost(model, inputTokens, outputTokens, cacheRead, searches) } };
  }
}

function toUsage(model: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined) {
  const inputTokens = u?.input_tokens ?? 0;
  const outputTokens = u?.output_tokens ?? 0;
  const cacheReadTokens = u?.cache_read_input_tokens ?? 0;
  return { inputTokens, outputTokens, cacheReadTokens, webSearches: 0, costUsd: estimateCost(model, inputTokens, outputTokens, cacheReadTokens) };
}
