// Public list prices (USD per million tokens), checked 2026-11-22. Used for ESTIMATES only.
// Update when Anthropic pricing changes; unknown models are costed at the most expensive known rate.
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};
export const WEB_SEARCH_USD_PER_1K = 10;

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheRead = 0, webSearches = 0): number {
  const p = PRICES[model] ?? { input: 8, output: 40, cacheRead: 0.2 };
  const usd = (inputTokens * p.input + outputTokens * p.output + cacheRead * p.cacheRead) / 1_000_000 + (webSearches * WEB_SEARCH_USD_PER_1K) / 1000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
