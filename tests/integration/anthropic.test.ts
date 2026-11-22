import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../../src/server/providers/model/anthropic.js";
import { ModelRefusalError, ModelOutputError } from "../../src/server/providers/model/types.js";

// The SDK client is stubbed at its method boundary (no network). Verifies request shape + response handling.
function fakeClient(parseResult: any, createResults: any[] = []) {
  const sent: any[] = [];
  return {
    sent,
    client: {
      beta: { messages: { parse: async (p: any) => (sent.push(p), parseResult) } },
      messages: { create: async (p: any) => (sent.push(p), createResults.shift()) },
      models: { retrieve: async (id: string) => ({ id }) },
    } as any,
  };
}
const cfg = { apiKey: "x", strongModel: "claude-opus-5-5", fastModel: "claude-haiku-5-5" };
const S = z.object({ a: z.string() });
const usage = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0 };

describe("AnthropicProvider", () => {
  it("sends structured-output requests with refusal fallbacks on Opus and parses output", async () => {
    const f = fakeClient({ stop_reason: "end_turn", parsed_output: { a: "ok" }, model: "claude-opus-5-5", usage });
    const p = new AnthropicProvider(cfg, f.client);
    const r = await p.generate({ purpose: "t", tier: "strong", system: "s", prompt: "p", schema: S, offline: () => ({ a: "" }) });
    expect(r.data).toEqual({ a: "ok" });
    expect(r.usage.costUsd).toBeCloseTo((1000 * 4 + 1000 * 20) / 1e6);
    expect(f.sent[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "medium" } });
    expect(f.sent[0].thinking).toBeUndefined();
  });
  it("uses the fast model without fallbacks for classification", async () => {
    const f = fakeClient({ stop_reason: "end_turn", parsed_output: { a: "ok" }, usage });
    await new AnthropicProvider(cfg, f.client).generate({ purpose: "t", tier: "fast", system: "s", prompt: "p", schema: S, offline: () => ({ a: "" }) });
    expect(f.sent[0].model).toBe("claude-haiku-5-5");
    expect(f.sent[0].fallbacks).toBeUndefined();
  });
  it("surfaces refusals and truncation as typed errors", async () => {
    await expect(new AnthropicProvider(cfg, fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" }, usage }).client).generate({ purpose: "t", tier: "strong", system: "s", prompt: "p", schema: S, offline: () => ({ a: "" }) })).rejects.toBeInstanceOf(ModelRefusalError);
    await expect(new AnthropicProvider(cfg, fakeClient({ stop_reason: "max_tokens", usage }).client).generate({ purpose: "t", tier: "strong", system: "s", prompt: "p", schema: S, offline: () => ({ a: "" }) })).rejects.toBeInstanceOf(ModelOutputError);
    await expect(new AnthropicProvider(cfg, fakeClient({ stop_reason: "end_turn", parsed_output: null, usage }).client).generate({ purpose: "t", tier: "strong", system: "s", prompt: "p", schema: S, offline: () => ({ a: "" }) })).rejects.toBeInstanceOf(ModelOutputError);
  });
  it("extracts web search sources/citations and continues paused turns", async () => {
    const f = fakeClient(null, [
      { stop_reason: "pause_turn", usage: { ...usage, server_tool_use: { web_search_requests: 1 } }, content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.org", title: "A", page_age: "2026-01-01" }] }] },
      { stop_reason: "end_turn", usage: { ...usage, server_tool_use: { web_search_requests: 1 } }, content: [{ type: "text", text: "Summary", citations: [{ type: "web_search_result_location", url: "https://a.org", title: "A", cited_text: "quoted" }] }] },
    ]);
    const r = await new AnthropicProvider(cfg, f.client).webResearch("q", { maxSearches: 3, system: "s" });
    expect(r.sources).toEqual([{ url: "https://a.org", title: "A", pageAge: "2026-01-01" }]);
    expect(r.citations[0].citedText).toBe("quoted");
    expect(r.usage.webSearches).toBe(2);
    expect(f.sent[0].tools[0]).toMatchObject({ type: "web_search_20260209", max_uses: 3 });
    expect(f.sent[1].messages).toHaveLength(2);
  });
});
