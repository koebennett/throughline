# Integrations — status and notes

Last reviewed: **2026-11-22**. Platform rules change: re-check the official docs before enabling any live connector (see `.claude/skills/platform-connector`). The table reflects what the code actually does.

| Integration | Status in this release | What works today |
|---|---|---|
| Claude (Anthropic API) | **Implemented.** Live when `ANTHROPIC_API_KEY` is set or a key is saved in Settings (verified with a models lookup, stored encrypted). | Structured strategy/ideas/briefs/drafts/QA judgement/analytics narrative, cited web research, section regeneration. **Not verified against the live API in the build environment (no key available) — covered by SDK-boundary tests.** |
| Claude web search | Implemented (server tool `web_search_20260209`, bounded by `maxWebSearchesPerRun`). | Sources saved with URL, title, page age, cited text. Requires web search enabled for your Anthropic org. |
| Public page import | Implemented, no setup. | SSRF-safe fetch of a public URL → dated source with excerpt. |
| Manual hand-off | Implemented. | Markdown package, copy, CSV/ICS calendar export, “mark published” with URL. |
| YouTube Data/Analytics API | **Boundary only** (`needs_credentials` / `not_implemented`). | Use YouTube Studio CSV export → Analytics import (headers auto-mapped). |
| TikTok Content Posting API | `needs_provider_approval` | Hand-off only. |
| Instagram/Facebook (Meta Graph) | `needs_provider_approval` | CSV import + hand-off. |
| LinkedIn | `needs_provider_approval` | Hand-off only. |
| Buffer / Postiz-style provider | `not_implemented` (interface ready) | Hand-off only. |

## Anthropic setup
1. Create a key at console.anthropic.com.
2. Either put `ANTHROPIC_API_KEY=...` in `.env`, or paste it in **Settings → Integrations** (verified, then stored encrypted in the local DB).
3. Optional: `CSA_MODEL_STRONG` (default `claude-opus-5-5`), `CSA_MODEL_FAST` (default `claude-haiku-5-5`).
4. Costs are estimated from list prices in `src/server/providers/model/pricing.ts` (Opus 5.5 $4/$20, Haiku 5.5 $0.10/$0.50 per MTok, web search $10/1k). Per-run and monthly caps are in Settings.

## YouTube (next connector — checklist)
Official docs: Analytics API https://developers.google.com/youtube/analytics · data model https://developers.google.com/youtube/analytics/data_model · upload https://developers.google.com/youtube/v3/docs/videos/insert · policies https://developers.google.com/youtube/terms/developer-policies

1. Google Cloud project; enable YouTube Data API v3 + YouTube Analytics API; OAuth consent screen with yourself as test user.
2. OAuth client (Web) with redirect `http://127.0.0.1:8787/api/integrations/youtube/callback`; set `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET`.
3. Read-only scopes first: `yt-analytics.readonly`, `youtube.readonly`. Upload (`youtube.upload`) only after the read path works.
4. Policy constraints to implement: refresh/delete stored API data within the policy windows (30-day limits for certain data); delete on revoke; no audiovisual download; no engagement automation; user-selected privacy on upload; unverified projects' uploads may be locked private until Google audit.
5. Store imports with `analytics_imports.source = 'api:youtube'` so disconnect deletes them.

## TikTok
Direct Post requires a registered app, approved `video.publish`, creator-info query, explicit consent UI; unaudited clients may only post privately. Do not show public auto-publish as available until audited. Docs: https://developers.tiktok.com/doc/content-posting-api-get-started

## Monetization note
YouTube's policy update (July 15, 2025) treats repetitive/mass-produced content as inauthentic and ineligible; reused content needs significant original commentary or transformation. QA flags lightly-modified reuse on YouTube derivatives (`transformative` check) but never predicts YPP decisions. https://support.google.com/youtube/answer/1311392

## Licensing of reference projects
No code was copied from Postiz (AGPL-3.0), Content Foundry or Open Agentic CMO; only workflow patterns informed the design.
