import { z } from "zod";
import { DEFAULT_OPPORTUNITY_WEIGHTS, DEFAULT_QA_WEIGHTS } from "../../shared/schemas.js";
import type { Db } from "../db/db.js";
import { now, parseJson } from "../db/db.js";

export const Settings = z.object({
  opportunityWeights: z.record(z.string(), z.number().min(0).max(100)).default(DEFAULT_OPPORTUNITY_WEIGHTS),
  qaWeights: z.record(z.string(), z.number().min(0).max(100)).default(DEFAULT_QA_WEIGHTS),
  qaPassScore: z.number().min(0).max(100).default(60),
  runBudgetUsd: z.number().min(0).max(100).default(1.5), // per agent run
  monthlyBudgetUsd: z.number().min(0).max(10000).default(25),
  maxWebSearchesPerRun: z.number().int().min(0).max(20).default(5),
  maxRevisionLoops: z.number().int().min(0).max(2).default(2),
  timezone: z.string().max(64).default("UTC"),
  publishingEnabled: z.boolean().default(false), // global kill switch: OFF by default
  autoPublishChannels: z.array(z.string()).default([]), // per-channel opt-in automation (still requires approval)
  researchCacheDays: z.number().int().min(1).max(90).default(14),
  notifications: z.object({ reviewQueue: z.boolean().default(true), weeklySummary: z.boolean().default(true) }).default({ reviewQueue: true, weeklySummary: true }),
});
export type Settings = z.infer<typeof Settings>;

export function getSettings(db: Db): Settings {
  const rows = db.all<{ key: string; value_json: string }>("SELECT key, value_json FROM settings WHERE key NOT LIKE '\\_\\_%' ESCAPE '\\'");
  const obj: Record<string, unknown> = {};
  for (const r of rows) obj[r.key] = parseJson(r.value_json, undefined);
  const parsed = Settings.safeParse(obj);
  return parsed.success ? parsed.data : Settings.parse({});
}

export function updateSettings(db: Db, patch: Partial<Settings>): Settings {
  const merged = Settings.parse({ ...getSettings(db), ...patch });
  db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in Settings.shape)) continue;
      db.run(
        "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        k, JSON.stringify((merged as any)[k]), now(),
      );
    }
  });
  return merged;
}
