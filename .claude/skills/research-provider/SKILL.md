---
name: research-provider
description: Use when adding a research/search data provider (e.g. a SERP or keyword API, YouTube Data API search) to the Research Desk.
---

# Adding a research provider

1. Confirm the provider's terms allow storing results; note retention limits in `docs/INTEGRATIONS.md`.
2. Fetch server-side only; credentials via `ctx.secrets` or env. For arbitrary URLs use `safeFetch` (SSRF-safe) — never raw `fetch` on user input.
3. Map results to `addSource()` with url, title, publisher, publishedAt (as given — never invented), retrievedAt, provider id.
4. Metrics (search volume, views) only if the provider returns them; label the provider and date. If absent, omit — do not estimate silently.
5. Wire it into the `gather` step of `research_topic` (`src/server/agent/tasks.ts`); keep the deterministic `auditSynthesis` step after synthesis.
6. Fence all returned text with `fenceUntrusted()` before it reaches a prompt.
7. Add an integration test with a stubbed provider proving sources/evidence are dated and audited.
