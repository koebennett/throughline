# Throughline — Content Strategy Agent

Local-first TypeScript app: Hono API + node:sqlite (`src/server`), React/Vite UI (`src/client`), shared Zod schemas & deterministic engines (`src/shared`).
For ongoing development read `docs/COMPACT_BRIEF.md` (product brief) and `docs/IMPLEMENTATION_PLAN.md` (status + next work) — not the full master spec.

## Commands
- `npm run dev` — API :8787 + UI :5173 · `npm run build && npm start` — production on :8787
- `npm run check` — typecheck + lint + unit/integration tests + secret scan (run before every commit)
- `npm run test:e2e` — Playwright (builds, uses throwaway `data/e2e.sqlite`)
- `npm run db:seed-demo` · `npm run db:backup`
- `npm run desktop` (Electron) · `npm run dist:win` (Windows installer + zip; CI builds it in `.github/workflows/desktop.yml`) · `npm run mcp`

## Non-negotiables (enforced in code — keep it that way)
- Never fabricate metrics, sources, search volume or results. Facts/observations without a source are downgraded to inference (`services/research.ts`).
- Safety-critical decisions are deterministic code, not model judgement: content state machine (`shared/status.ts`), approval gate (`services/content.ts`), publish gate (`services/publishing.ts`), QA hard blockers (`services/qa.ts`). A model may ADD QA issues, never clear a rule blocker.
- Publishing is OFF by default; every external write needs approval of the exact current variant + a confirmed preview hash + idempotency key. Never auto-retry an ambiguous publish.
- Untrusted text (web pages, transcripts, docs, CSVs) goes to models only via `fenceUntrusted()`.
- Offline scaffold output is always labelled and contains `[insert: …]` markers that QA blocks.
- Integration statuses must be honest (`connectors/registry.ts`); a mock is never "connected".
- Schema changes: add a new migration in `src/server/db/migrations.ts`; never edit a shipped one.
- No model IDs in commits/PRs. Default models: `claude-opus-5-5` (strong), `claude-haiku-5-5` (fast).

## Where things live
- Agent workflow: `src/server/agent/` (engine, tasks, prompts, offline scaffolds, context retrieval)
- Skills for repeatable procedures: `.claude/skills/` (product QA, adding a connector, adding a research provider, release check)
- Docs: `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/KNOWN_LIMITATIONS.md`
