# Architecture

Throughline is a single local-first app: one Node process serves a JSON API and the built React UI, with all state in one SQLite file.

```
Browser (React + TanStack Query)
   │  /api/*  (X-Throughline header on writes; Host allow-list)
   ▼
Hono API (src/server/app.ts) ── services (deterministic domain logic)
   │                              ├─ brands / brain (FTS5 retrieval, memory)
   │                              ├─ research (sources, evidence, honesty rules, safe URL import)
   │                              ├─ strategy (versions, validation, approval → pillars/clusters/series)
   │                              ├─ ideas (scoring, duplicate detection, revisions)
   │                              ├─ content (briefs, items, immutable variants, QA records, approval, transitions)
   │                              ├─ qa (rule engine: blockers/warnings + heuristic rubric)
   │                              ├─ calendar, assets/lineage, analytics, experiments, publishing, usage, audit
   │
   └─ WorkflowEngine (src/server/agent/engine.ts)
         tasks.ts: typed step sequences — research_topic, build_strategy, generate_ideas, create_brief,
                   create_drafts, review_draft, repurpose_transcript, plan_calendar, analyze_performance, ask
         context.ts: retrieves only task-relevant profile/strategy/evidence/doc snippets (with citations)
         prompts.ts: shared principles + one role line per specialist module
         offline.ts: deterministic scaffolds when no model is configured
   │
   ├─ ModelProvider  (providers/model): AnthropicProvider | OfflineProvider | (tests) MockProvider
   ├─ ResearchProvider: Claude web search (via ModelProvider.webResearch), public page import (lib/safeFetch.ts), manual entry
   ├─ PlatformConnector (connectors/): registry with honest statuses; publish gate in services/publishing.ts
   └─ AssetProcessor (lib/assetProcessor.ts): owned text/subtitle ingestion; media as metadata only
SQLite (node:sqlite, WAL) — migrations in src/server/db/migrations.ts
```

## Key decisions

| Decision | Why |
|---|---|
| **node:sqlite** (built into Node ≥ 22.13) instead of better-sqlite3 | No native compilation — fresh installs on Windows just work. FTS5 is included. |
| **Hono + Vite/React** instead of Next.js | Small, explicit server; the UI is a SPA talking to a typed JSON API. Easy to test with `app.request()` without a network. |
| **One orchestrated workflow, not an agent swarm** | Each task is a typed list of persisted steps. Specialist "roles" are prompt modules, not chatting agents. Predictable cost and behaviour. |
| **Deterministic gates** | State machine, approval, publish gate, QA blockers and evidence downgrades are plain code with tests (incl. mutation checks). Models can add QA issues but never remove rule blockers. |
| **Structured outputs** | Every model call uses `client.beta.messages.parse` + Zod schema (`zodOutputFormat`) and re-validates the result; refusals and truncation are typed errors. |
| **Refusal fallbacks** | Opus/Sonnet calls send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a classifier decline is retried server-side on a fallback model. |
| **Two model tiers** | `strong` (default `claude-opus-5-5`) for strategy/creative/synthesis; `fast` (default `claude-haiku-5-5`) for QA judgement. Override with `CSA_MODEL_STRONG` / `CSA_MODEL_FAST`. |
| **FTS5 retrieval before embeddings** | Cheap, citable, no extra service. `retrieve()` is the seam for adding vectors later. |
| **JSON columns for rich artefacts** | Strategy, brief, draft fields evolve quickly; they are validated by Zod at the service boundary. Relational columns hold everything that is filtered or joined. |

## Workflow engine

- `create()` validates input with the task's Zod schema and persists the run plus one row per step.
- `execute()` runs steps in order. After each step, state and step output are written in a transaction — a crash loses at most the in-flight step.
- Transient errors (network, 429, 5xx) retry with exponential backoff up to 3 attempts; schema/refusal/budget errors fail immediately.
- Budget: per-run USD cap, monthly cap, and a 40-model-call cap are checked before every model call (`checkBudget`).
- Controls: `pause` / `cancel` are cooperative flags checked between steps; `resume` continues from the current step (completed steps are never repeated; tasks are written to be resumable mid-step, e.g. drafting skips platforms already drafted).
- Approval gates: a step returns `{ awaitApproval: { message, payload } }`; the run pauses as `awaiting_approval`. `decide(approve)` calls the step's `onApprove` (e.g. activate strategy, write calendar entries, save learnings), then continues. `reject` cancels with nothing applied.
- On startup, runs left `running` are marked `interrupted` and can be resumed.

## Data model (tables)

workspaces, brands, brand_profile_versions (profile JSON incl. audience segments, platform accounts, competitors), documents, doc_chunks, chunks_fts, memory_items, research_runs, sources, evidence_items, strategy_versions, pillars, topic_clusters, series, campaigns, ideas, idea_revisions, briefs, brief_revisions, content_items, content_variants, qa_reviews, approvals, assets, content_lineage, calendar_entries, publish_jobs, publish_results, analytics_imports, analytics_snapshots, experiments, agent_runs, agent_steps, usage_records, integrations, secrets, settings, audit_events (append-only via triggers), schema_migrations.

`MetricDefinition` lives in code (`src/shared/metrics.ts`) because definitions ship with the app. Audience segments, platform accounts and competitors are versioned inside the brand profile so every edit is a recoverable snapshot.

## Security model

- Binds to `127.0.0.1`; API has no login (single-user local tool). Writes require `X-Throughline: 1` (blocks cross-site form/fetch CSRF); `Host` must be localhost/127.0.0.1 (blocks DNS rebinding). Body limit 12 MB.
- Built UI served with a strict CSP (`script-src 'self'`), `X-Frame-Options: DENY`, `no-referrer`.
- Secrets: AES-256-GCM in the `secrets` table; key from `CSA_SECRET_KEY` or `data/secret.key` (0600). Keys are never returned by the API; logs scrub key-like fields.
- SSRF: `safeFetch` allows http(s) on default ports only, rejects credentials in URLs, validates resolved IPs at connect time (private/loopback/link-local/CGNAT/metadata blocked), re-validates each redirect, caps size/time and content type.
- Prompt injection: all third-party/user-supplied text is wrapped in `<untrusted>` fences; the system prompt instructs models to treat it as data. Safety-critical actions never depend on model output.
- XSS: React escaping only; no `dangerouslySetInnerHTML`. CSV export neutralises formula injection.
- Deletion: brand delete removes all brand rows (incl. its audit history, via a scoped purge flag) and records one workspace-level deletion event.

## Security review log
**2026-11-22**, an independent read-only review. All findings were fixed, each with a regression test:
1. The publish gate accepted a stale approval after "changes requested" or archive. Approval is now valid only if it is the latest decision, it covers the current variant, and the item is APPROVED/SCHEDULED. Idempotent repeats return the existing job before any gate or provider call.
2. The SSRF filter could be bypassed with IPv6-mapped/compatible/6to4/site-local literals. These are now classified on fully expanded addresses, and the connected `remoteAddress` is re-checked. Fetches also have a total deadline in addition to the idle timeout.
3. Hostile HTML could cause quadratic regex time on page import. Parsing is now linear, using an `indexOf` tag scanner and bounded patterns.
4. The untrusted-content fence could be broken by nested tags. Tag-like sequences are now neutralised in a single pass that can't be reassembled, labels are sanitised, and source titles/URLs are moved inside the fence.
5. `javascript:` URLs were accepted. The server now accepts http(s) only (published URL, CSV URL column), and the client renders links only for http(s) (`safeHref`).
6. Also fixed: audit `limit` validation; lone CR escaping in ICS; the drafting agent no longer marks briefs approved; `secure_delete` is on, the WAL is checkpointed after a brand delete, and the deletion record no longer stores the brand name.
