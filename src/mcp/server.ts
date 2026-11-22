// Throughline MCP server (stdio) for Claude Desktop / Claude Code.
// It calls the RUNNING Throughline app over its local API, so every rule applies unchanged:
// evidence honesty, QA blockers, approval gates and the publish kill switch.
// Deliberately NOT exposed: approving content, approving agent gates, publishing, deleting.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/** Locate the app: THROUGHLINE_URL, else the desktop app's runtime file, else the default dev/CLI port. */
export function resolveBaseUrl(env = process.env): string {
  if (env.THROUGHLINE_URL) return env.THROUGHLINE_URL.replace(/\/$/, "");
  const appData = env.APPDATA ?? (process.platform === "darwin" ? join(homedir(), "Library", "Application Support") : join(homedir(), ".config"));
  const runtime = join(appData, "Throughline", "runtime.json");
  if (existsSync(runtime)) {
    try {
      return JSON.parse(readFileSync(runtime, "utf8")).url;
    } catch {
      /* fall through */
    }
  }
  return "http://127.0.0.1:8787";
}

export function createMcpServer(baseUrl = resolveBaseUrl(), fetchImpl: typeof fetch = fetch) {
  const url = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("THROUGHLINE_URL must point at a loopback address.");
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetchImpl(`${baseUrl}/api${path}`, {
      method,
      headers: { ...(method !== "GET" ? { "x-throughline": "1" } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as any)?.error ?? `Throughline API ${res.status}`);
    return data;
  };
  const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
  const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `${(e as Error).message}. Is the Throughline app running at ${baseUrl}?` }] });
  const wrap = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try {
      return ok(await fn(a));
    } catch (e) {
      return fail(e);
    }
  };
  const ro = { readOnlyHint: true, openWorldHint: false };
  const server = new McpServer({ name: "throughline", version: "0.1.0" });

  server.registerTool("list_brands", { description: "List brands/workspaces in Throughline (demo brands are flagged isDemo).", annotations: ro }, wrap(async () => call("GET", "/brands")));
  server.registerTool("command_center", { description: "Prioritised next best actions, review queue, upcoming schedule and data-backed insights for a brand.", inputSchema: { brandId: z.string() }, annotations: ro }, wrap(({ brandId }) => call("GET", `/brands/${encodeURIComponent(brandId)}/home`)));
  server.registerTool("get_brand", { description: "The approved brand profile (audience, voice, positioning, platforms, capacity, compliance).", inputSchema: { brandId: z.string() }, annotations: ro }, wrap(({ brandId }) => call("GET", `/brands/${encodeURIComponent(brandId)}`)));
  server.registerTool("search_brand_docs", { description: "Full-text search of the brand's own documents; returns cited snippets.", inputSchema: { brandId: z.string(), query: z.string().min(2) }, annotations: ro }, wrap(({ brandId, query }) => call("GET", `/brands/${encodeURIComponent(brandId)}/search?q=${encodeURIComponent(query)}`)));
  server.registerTool("list_evidence", { description: "Evidence on file, each labelled user_fact / fact / observation / inference / hypothesis with its source and dates.", inputSchema: { brandId: z.string() }, annotations: ro }, wrap(({ brandId }) => call("GET", `/brands/${encodeURIComponent(brandId)}/evidence`)));
  server.registerTool("list_ideas", { description: "Scored idea backlog (scores are triage aids, not predictions).", inputSchema: { brandId: z.string() }, annotations: ro }, wrap(async ({ brandId }) => ((await call("GET", `/brands/${encodeURIComponent(brandId)}/ideas`)) as any[]).map((i) => ({ id: i.id, title: i.title, angle: i.angle, pillar: i.pillarName, platform: i.platform, status: i.status, score: i.scoring.score, confidence: i.scoring.confidence }))));
  server.registerTool("list_content", { description: "Content items with status (DRAFT…PUBLISHED) and latest QA score.", inputSchema: { brandId: z.string(), status: z.string().optional() }, annotations: ro }, wrap(({ brandId, status }) => call("GET", `/brands/${encodeURIComponent(brandId)}/content${status ? `?status=${encodeURIComponent(status)}` : ""}`)));
  server.registerTool("get_content", { description: "A content item with its variants, QA reviews (checks, blockers) and history.", inputSchema: { contentId: z.string() }, annotations: ro }, wrap(({ contentId }) => call("GET", `/content/${encodeURIComponent(contentId)}`)));
  server.registerTool("get_analytics", { description: "Own-baseline performance analysis per platform (descriptive, not causal).", inputSchema: { brandId: z.string() }, annotations: ro }, wrap(({ brandId }) => call("GET", `/brands/${encodeURIComponent(brandId)}/analytics`)));
  server.registerTool("get_run", { description: "Status, steps and output of an agent run.", inputSchema: { runId: z.string() }, annotations: ro }, wrap(({ runId }) => call("GET", `/agent/runs/${encodeURIComponent(runId)}`)));

  server.registerTool(
    "add_evidence",
    { description: "Record evidence. Facts/observations without a sourceId are automatically downgraded to inference.", inputSchema: { brandId: z.string(), claim: z.string().min(3), kind: z.enum(["user_fact", "fact", "observation", "inference", "hypothesis"]), confidence: z.enum(["low", "medium", "high"]).default("medium"), topic: z.string().default(""), sourceId: z.string().optional() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
    wrap(({ brandId, ...e }) => call("POST", `/brands/${encodeURIComponent(brandId)}/evidence`, e)),
  );
  server.registerTool(
    "add_idea",
    { description: "Add an idea to the backlog (duplicate detection and scoring apply).", inputSchema: { brandId: z.string(), title: z.string().min(3), angle: z.string().default(""), rationale: z.string().default("") }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
    wrap(({ brandId, ...i }) => call("POST", `/brands/${encodeURIComponent(brandId)}/ideas`, { ...i, source: "agent" })),
  );
  server.registerTool(
    "run_task",
    {
      description: "Start a Throughline agent task and wait up to waitSeconds for it. Approval gates (strategy activation, calendar writes, learnings) are NOT approvable here — the user approves in the app.",
      inputSchema: { brandId: z.string(), task: z.enum(["research_topic", "build_strategy", "generate_ideas", "create_brief", "create_drafts", "review_draft", "repurpose_transcript", "plan_calendar", "analyze_performance", "ask"]), input: z.record(z.string(), z.unknown()).default({}), waitSeconds: z.number().int().min(0).max(300).default(120) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    wrap(async ({ brandId, task, input, waitSeconds }) => {
      const run: any = await call("POST", `/brands/${encodeURIComponent(brandId)}/agent/runs`, { task, input });
      const until = Date.now() + waitSeconds * 1000;
      let r = run;
      while ((["queued", "running"].includes(r.status) || r.running) && Date.now() < until) {
        await new Promise((res) => setTimeout(res, 1000));
        r = await call("GET", `/agent/runs/${run.id}`);
      }
      return { runId: r.id, status: r.status, error: r.error || undefined, steps: r.steps.map((s: any) => ({ step: s.label, status: s.status, summary: s.output?.summary })), output: r.output ?? undefined, note: r.status === "awaiting_approval" ? "Waiting for the user's approval in the Throughline app (Agent & Runs)." : undefined };
    }),
  );
  return server;
}

const isMain = process.argv[1] && /mcp[\\/]server\.(js|ts)$/.test(process.argv[1]);
if (isMain) {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
