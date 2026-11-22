# Implementation plan & checklist

Product brief for ongoing sessions: `docs/COMPACT_BRIEF.md`. Priority (per owner): **strategy & intelligence engine first; publishing connectors and advanced analytics after.**

## Status by phase

### Phase 0 — audit & plan ✅
Empty repo → chose TypeScript, Hono, Vite/React, node:sqlite (no native deps on Windows), Zod, Anthropic SDK. CLAUDE.md, skills, hook, docs created.

### Phase 1 — functional core without credentials ✅
- [x] App shell, navigation, onboarding wizard, explicit DEMO workspace (labelled everywhere)
- [x] SQLite + ordered migrations; append-only audit log (triggers)
- [x] Brand Brain: versioned profile (restore), documents w/ FTS5 cited retrieval, exclude/delete, memory with provenance/approval/conflict flags
- [x] Research Desk: manual sources, SSRF-safe URL import, evidence kinds with automatic downgrade of unsourced "facts", research runs
- [x] Strategy Studio: versions, deterministic validation, approval → pillars/clusters/series; editable weights
- [x] Idea Lab: transparent opportunity scoring w/ missing-data penalty, duplicate detection, series, revisions, CSV export
- [x] Briefs: full brief model, versions, proof origin honesty
- [x] Creation & Review: platform-native drafts, variants, compare, edit → new variant, QA (blockers/warnings/rubric), approval bound to variant, hand-off package
- [x] Calendar: month/week/list, drag-drop, filters, campaigns, CSV + ICS export
- [x] Agent runs: persisted steps, progress, pause/resume/cancel/retry, approval gates
- [x] Offline scaffold engine (honest, labelled)

### Phase 2 — live agent ✅ (code) / ⚠️ (live verification pending a key)
- [x] Anthropic provider: structured outputs (Zod), refusal fallbacks, typed errors, usage/cost accounting, budgets
- [x] Claude web search research provider with source/citation capture + evidence audit
- [x] Retrieval with citations; bounded QA revision loop (≤2); section regeneration
- [ ] Run the live smoke test with a real key (owner action)

### Phase 3 — analytics & learning ✅ (CSV) / ⏳ (APIs)
- [x] CSV template, preview & mapping (YouTube Studio headers auto-mapped), safe parsing with warnings
- [x] Own-baseline comparison, segments (format/pillar/weekday), insights labelled observation vs hypothesis
- [x] Postmortems, experiment log, agent narrative with approval before memory updates
- [ ] YouTube Analytics read-only OAuth (needs Google OAuth client)

### Phase 4 — publishing ⏳
- [x] Connector interface, honest registry, publish gate (kill switch, approval, preview hash, idempotency, ambiguous check, audit), publish log
- [ ] First real connector (YouTube upload or an approved multi-platform provider) — follow `.claude/skills/platform-connector`

### Phase 5 — advanced ◐
- [x] Repurposing from owned transcripts with timestamps + lineage map + rights gating
- [x] Backup CLI, brand export, brand delete, audit log UI, responsive layout, dark mode
- [ ] MCP server for Claude Desktop/Code (typed safe tools; writes obey approvals)
- [ ] Embeddings behind `retrieve()`; notifications; scheduler for weekly summaries

## Next highest-value work
1. Live-key smoke test; tune prompts on real outputs (strategy specificity, idea distinctness).
2. YouTube read-only OAuth + Analytics sync (store as `source = 'api:youtube'`, honour retention).
3. MCP server exposing research/brief/plan/review/analyze tools.
4. Competitor public-pattern capture (manual + provider-backed) feeding differentiation scores.
