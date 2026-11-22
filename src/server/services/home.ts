// Command Center: real counts with their data source/window, plus deterministic "next best actions".
import type { Ctx } from "../context.js";
import { getBrand } from "./brands.js";
import { activeStrategy } from "./strategy.js";
import { analyze } from "./analytics.js";

export interface NextAction {
  priority: number;
  title: string;
  reason: string;
  action: { label: string; to: string };
}

export function commandCenter(ctx: Ctx, brandId: string) {
  const { db } = ctx;
  const brand = getBrand(db, brandId);
  const p = brand.profile;
  const count = (sql: string, ...a: string[]) => db.get<{ n: number }>(sql, brandId, ...a)?.n ?? 0;
  const strategy = activeStrategy(db, brandId);
  const draftStrategies = count("SELECT count(*) AS n FROM strategy_versions WHERE brand_id = ? AND status = 'draft'");
  const evidence = count("SELECT count(*) AS n FROM evidence_items WHERE brand_id = ?");
  const sourcedEvidence = count("SELECT count(*) AS n FROM evidence_items WHERE brand_id = ? AND source_id IS NOT NULL");
  const ideas = count("SELECT count(*) AS n FROM ideas WHERE brand_id = ? AND status IN ('IDEA','RESEARCHED')");
  const briefs = count("SELECT count(*) AS n FROM briefs WHERE brand_id = ? AND (SELECT count(*) FROM content_items c WHERE c.brief_id = briefs.id) = 0");
  const statusCounts = Object.fromEntries(db.all("SELECT status, count(*) AS n FROM content_items WHERE brand_id = ? GROUP BY status", brandId).map((r) => [r.status, r.n]));
  const reviewQueue = db.all("SELECT id, title, platform, status, updated_at FROM content_items WHERE brand_id = ? AND status IN ('QA','REVIEW') ORDER BY updated_at DESC LIMIT 8", brandId);
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString();
  const upcoming = db.all(
    "SELECT e.id, e.title, e.platform, e.scheduled_at, e.timezone, c.status AS content_status, c.id AS content_item_id FROM calendar_entries e LEFT JOIN content_items c ON c.id = e.content_item_id WHERE e.brand_id = ? AND e.scheduled_at >= ? AND e.scheduled_at < ? ORDER BY e.scheduled_at LIMIT 10",
    brandId, new Date(Date.now() - 86400000).toISOString(), in14,
  );
  const dueNotReady = upcoming.filter((u) => u.content_status && !["APPROVED", "SCHEDULED", "PUBLISHED"].includes(u.content_status));
  const analysis = analyze(db, brandId);
  const runs = db.all("SELECT id, task, status, created_at, error FROM agent_runs WHERE brand_id = ? ORDER BY created_at DESC LIMIT 5", brandId);
  const failedRuns = runs.filter((r) => r.status === "failed" || r.status === "interrupted");
  const proposedMemory = count("SELECT count(*) AS n FROM memory_items WHERE brand_id = ? AND status = 'proposed'");
  const campaigns = db.all("SELECT id, name, goal, start_date, end_date, status FROM campaigns WHERE brand_id = ? AND status IN ('planned','active') ORDER BY start_date LIMIT 5", brandId);

  const actions: NextAction[] = [];
  const profileGaps = [!p.audiences.length && "audience", !p.platforms.length && "platforms", !p.objective && "objective", !p.voice.traits.length && "voice"].filter(Boolean) as string[];
  if (profileGaps.length) actions.push({ priority: 1, title: "Complete the brand profile", reason: `Missing ${profileGaps.join(", ")} — every recommendation depends on these.`, action: { label: "Open Brand Brain", to: "/brand" } });
  if (failedRuns.length) actions.push({ priority: 1, title: "Resolve a failed agent run", reason: `“${failedRuns[0].task.replace(/_/g, " ")}” ${failedRuns[0].status}: ${String(failedRuns[0].error).slice(0, 100)}`, action: { label: "Inspect run", to: `/agent?run=${failedRuns[0].id}` } });
  if (dueNotReady.length) actions.push({ priority: 1, title: `${dueNotReady.length} planned item(s) in the next 14 days aren't approved`, reason: `Next: “${dueNotReady[0].title}” on ${dueNotReady[0].scheduled_at.slice(0, 10)} is ${dueNotReady[0].content_status}.`, action: { label: "Open in Studio", to: `/studio/${dueNotReady[0].content_item_id}` } });
  if (reviewQueue.length) actions.push({ priority: 2, title: `Review ${reviewQueue.length} draft(s)`, reason: "Drafts are waiting on QA fixes or your approval.", action: { label: "Open review queue", to: "/studio" } });
  if (evidence < 3) actions.push({ priority: 2, title: "Gather evidence before scaling output", reason: `Only ${evidence} evidence item(s) on file (${sourcedEvidence} sourced). Strategy and idea scores are mostly assumptions until you add research.`, action: { label: "Open Research Desk", to: "/research" } });
  if (!strategy && draftStrategies) actions.push({ priority: 2, title: "Review and approve the draft strategy", reason: "Pillars, clusters and series are only created after you approve a strategy.", action: { label: "Open Strategy", to: "/strategy" } });
  if (!strategy && !draftStrategies) actions.push({ priority: 2, title: "Build your first strategy", reason: "No approved strategy — ideas can't be mapped to pillars yet.", action: { label: "Build strategy", to: "/strategy" } });
  if (strategy && ideas < 5) actions.push({ priority: 3, title: "Refill the idea backlog", reason: `${ideas} open idea(s). Generate scored ideas from your pillars and evidence.`, action: { label: "Open Idea Lab", to: "/ideas" } });
  if (briefs) actions.push({ priority: 3, title: `Draft ${briefs} brief(s) that have no content yet`, reason: "Briefs are ready for platform-native drafts.", action: { label: "Open Briefs", to: "/briefs" } });
  if (!analysis.platforms.length && (statusCounts.PUBLISHED ?? 0) > 0) actions.push({ priority: 3, title: "Import performance data", reason: "Published content has no results yet — the learning loop can't run.", action: { label: "Import CSV", to: "/analytics" } });
  if (proposedMemory) actions.push({ priority: 4, title: `Review ${proposedMemory} proposed learning(s)`, reason: "Agent/analytics learnings never become brand memory without your approval.", action: { label: "Review memory", to: "/brand?tab=memory" } });
  actions.sort((a, b) => a.priority - b.priority);

  const insights = analysis.platforms.flatMap((pl) => pl.insights.slice(0, 2).map((i) => ({ ...i, platform: pl.platform, window: pl.window, n: pl.n })));
  return {
    brand: { id: brand.id, name: brand.name, isDemo: brand.isDemo, objective: p.objective },
    model: { live: ctx.model().live, label: ctx.model().label },
    strategy: strategy ? { id: strategy.id, version: strategy.version, approvedAt: strategy.approvedAt, summary: (strategy.data as any)?.executiveSummary ?? "" } : null,
    counts: { evidence, sourcedEvidence, ideas, briefsWithoutContent: briefs, content: statusCounts, proposedMemory },
    reviewQueue,
    upcoming,
    campaigns,
    recentRuns: runs,
    insights,
    nextActions: actions.slice(0, 5),
    sources: { counts: "Live counts from your local database.", insights: analysis.platforms.length ? "Imported analytics (see Analytics for data window per platform)." : "No analytics imported yet." },
  };
}
