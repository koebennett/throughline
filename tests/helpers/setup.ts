import { bootstrap } from "../../src/server/bootstrap.js";
import { loadConfig } from "../../src/server/config.js";
import type { GenerateRequest, GenerateResult, ModelProvider, WebResearchResult } from "../../src/server/providers/model/types.js";

/** A scripted LIVE provider for tests: handlers keyed by request purpose. Only used in tests. */
export class MockProvider implements ModelProvider {
  id = "mock";
  label = "Mock model (tests only)";
  live = true;
  models = { strong: "claude-opus-5-5", fast: "claude-haiku-5-5" };
  calls: { purpose: string; prompt: string }[] = [];
  failNext: Error[] = [];
  constructor(public handlers: Record<string, (req: GenerateRequest<any>) => unknown> = {}, public costPerCall = 0.01) {}
  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    this.calls.push({ purpose: req.purpose, prompt: req.prompt });
    const err = this.failNext.shift();
    if (err) throw err;
    const h = this.handlers[req.purpose];
    const data = req.schema.parse(h ? h(req) : req.offline());
    return { data, provider: this.id, model: this.models[req.tier], usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, webSearches: 0, costUsd: this.costPerCall } };
  }
  webResearch?: (q: string, o: { maxSearches: number; system: string }) => Promise<WebResearchResult>;
}

export function makeApp(model?: ModelProvider) {
  const config = { ...loadConfig({ CSA_DB_PATH: ":memory:" } as any), anthropicApiKey: undefined };
  const boot = bootstrap(config, { model });
  boot.engine.sleep = async () => {};
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await boot.app.request(path, {
      method,
      headers: { host: "127.0.0.1:8787", ...(method === "GET" ? {} : { "x-throughline": "1" }), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body (csv/ics) */
    }
    return { status: res.status, body: json, headers: res.headers };
  };
  return { ...boot, call };
}

export const PROFILE = {
  name: "Test Brand",
  niche: "personal finance for freelancers",
  objective: "Grow newsletter sign-ups",
  audiences: [{ name: "New freelancers", description: "First year freelancing", problems: ["irregular income makes budgeting hard", "forgetting to save for taxes"], desires: ["stable monthly pay"], language: ["feast or famine"] }],
  platforms: [{ platform: "youtube" }, { platform: "linkedin" }],
  capacity: { hoursPerWeek: 6, postsPerWeekTarget: 3 },
  voice: { traits: ["calm", "direct"], phrasesToAvoid: ["hack"], vocabulary: ["buffer account"] },
  proof: ["Freelanced for 8 years"],
  differentiators: ["Systems built for irregular income"],
  ctas: ["Join the newsletter"],
  compliance: { bannedClaims: ["financial advice"], requiredDisclosures: [] },
  topicsOfExpertise: ["budgeting", "taxes", "pricing"],
};

export async function waitFor<T>(fn: () => Promise<T> | T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > ms) throw new Error("waitFor timed out: " + JSON.stringify(v).slice(0, 500));
    await new Promise((r) => setTimeout(r, 20));
  }
}
