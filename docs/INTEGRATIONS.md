# Integrations — status and notes

Last reviewed: **2026-11-22**. Platform rules change: re-check the official docs before enabling any live connector (see `.claude/skills/platform-connector`). The table reflects what the code actually does.

| Integration | Status in this release | What works today |
|---|---|---|
| Claude (Anthropic API) | **Implemented.** Live when `ANTHROPIC_API_KEY` is set or a key is saved in Settings (verified with a models lookup, stored encrypted). | Structured strategy/ideas/briefs/drafts/QA judgement/analytics narrative, cited web research, section regeneration. **Not verified against the live API in the build environment (no key available) — covered by SDK-boundary tests.** |
| Claude web search | Implemented (server tool `web_search_20260209`, bounded by `maxWebSearchesPerRun`). | Sources saved with URL, title, page age, cited text. Requires web search enabled for your Anthropic org. |
| Public page import | Implemented, no setup. | SSRF-safe fetch of a public URL → dated source with excerpt. |
| Manual hand-off | Implemented. | Markdown package, copy, CSV/ICS calendar export, “mark published” with URL. |
| YouTube Analytics (read-only) | **Implemented**: OAuth 2.0 + PKCE (Desktop-app client, loopback redirect), encrypted tokens, refresh, revoke, per-video sync, 30-day retention. **Not verified against a live Google account** (needs your OAuth client). Uploads are deliberately not built. | Settings → paste client → Connect → Analytics Lab → Sync YouTube. CSV import still works. |
| TikTok Content Posting API | `needs_provider_approval` | Hand-off only. |
| Instagram/Facebook (Meta Graph) | `needs_provider_approval` | CSV import + hand-off. |
| LinkedIn | `needs_provider_approval` | Hand-off only. |
| Buffer / Postiz-style provider | `not_implemented` (interface ready) | Hand-off only. |

## Anthropic setup
1. Create a key at console.anthropic.com.
2. Either put `ANTHROPIC_API_KEY=...` in `.env`, or paste it in **Settings → Integrations** (verified, then stored encrypted in the local DB).
3. Optional: `CSA_MODEL_STRONG` (default `claude-opus-5-5`), `CSA_MODEL_FAST` (default `claude-haiku-5-5`).
4. Costs are estimated from list prices in `src/server/providers/model/pricing.ts` (Opus 5.5 $4/$20, Haiku 5.5 $0.10/$0.50 per MTok, web search $10/1k). Per-run and monthly caps are in Settings.

## YouTube (read-only analytics)
Setup (about 10 minutes, no Google review needed for your own channel):
1. https://console.cloud.google.com → new project → APIs & Services → enable **YouTube Analytics API** and **YouTube Data API v3**.
2. OAuth consent screen → External → add your Google account under **Test users**.
3. Credentials → Create credentials → OAuth client ID → **Application type: Desktop app**. (Desktop clients accept loopback redirects on any port, which the desktop app needs because it picks a free port.)
4. Throughline → Settings → Integrations → YouTube → paste client ID + secret → **Connect YouTube (read-only)** → approve in the browser.
5. Analytics Lab → Import data → **Sync YouTube**.

What the code does: scopes `yt-analytics.readonly` + `youtube.readonly` only; refuses to store tokens if either scope is missing; requests `dimensions=video`, `sort=-views`, up to 200 videos with views, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, likes, comments, shares, subscribersGained; looks up titles/durations (≤3 min → Shorts) via the Data API in batches of 50. Each sync replaces the previous API import (source `api:youtube`). API data older than 30 days is deleted at startup and before analysis; disconnect revokes the token at Google and deletes tokens and API data.

**Verification status (2026-11-22):** the endpoints (`accounts.google.com/o/oauth2/v2/auth`, `oauth2.googleapis.com/token|revoke`, `youtubeanalytics.googleapis.com/v2/reports`, `www.googleapis.com/youtube/v3/videos|channels`), scopes and metric names follow Google's published documentation as known to the author, but `developers.google.com` was unreachable from the build environment, so they were **not re-fetched today**. Re-check: OAuth native apps https://developers.google.com/identity/protocols/oauth2/native-app · reports.query https://developers.google.com/youtube/analytics/reference/reports/query · policies https://developers.google.com/youtube/terms/developer-policies. Flow tested against a mocked Google (PKCE, state single-use, refresh, revoke, retention).

## TikTok
Direct Post requires a registered app, approved `video.publish`, creator-info query, explicit consent UI; unaudited clients may only post privately. Do not show public auto-publish as available until audited. Docs: https://developers.tiktok.com/doc/content-posting-api-get-started

## Monetization note
YouTube's policy update (July 15, 2025) treats repetitive/mass-produced content as inauthentic and ineligible; reused content needs significant original commentary or transformation. QA flags lightly-modified reuse on YouTube derivatives (`transformative` check) but never predicts YPP decisions. https://support.google.com/youtube/answer/1311392

## Licensing of reference projects
No code was copied from Postiz (AGPL-3.0), Content Foundry or Open Agentic CMO; only workflow patterns informed the design.
