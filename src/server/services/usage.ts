import type { Db } from "../db/db.js";
import { newId, now } from "../db/db.js";
import type { Usage } from "../providers/model/types.js";

export function recordUsage(db: Db, r: { brandId?: string | null; runId?: string | null; step?: string; provider: string; model: string; purpose: string; usage: Usage }) {
  if (r.provider === "offline") return;
  db.insert("usage_records", {
    id: newId("use"), brand_id: r.brandId ?? null, run_id: r.runId ?? null, step: r.step ?? "", provider: r.provider, model: r.model, purpose: r.purpose,
    input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens, cache_read_tokens: r.usage.cacheReadTokens, cost_usd: r.usage.costUsd, web_searches: r.usage.webSearches, created_at: now(),
  });
}

export function monthSpend(db: Db): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return db.get<{ s: number }>("SELECT coalesce(sum(cost_usd), 0) AS s FROM usage_records WHERE created_at >= ?", start.toISOString())?.s ?? 0;
}

export function usageSummary(db: Db) {
  const byModel = db.all("SELECT model, purpose, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, sum(web_searches) AS web_searches, round(sum(cost_usd), 4) AS cost_usd FROM usage_records GROUP BY model, purpose ORDER BY cost_usd DESC LIMIT 100");
  return { monthToDateUsd: Math.round(monthSpend(db) * 10000) / 10000, byModel, note: "Costs are estimates from public list prices; your invoice is authoritative." };
}
