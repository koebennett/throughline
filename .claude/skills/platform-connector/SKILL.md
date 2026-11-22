---
name: platform-connector
description: Use when adding or enabling a publishing/analytics connector (YouTube, TikTok, Meta, LinkedIn, Buffer/Postiz provider). Covers doc re-verification, OAuth, scopes, gates and tests.
---

# Implementing a platform connector

Never enable a live write path without doing every step.

1. **Re-verify official docs today** (scopes, app review/audit, formats, rate limits, retention/deletion rules). Record the date and findings in `docs/INTEGRATIONS.md`. Platform rules in code comments are not authoritative.
2. Implement `PlatformConnector` (`src/server/connectors/types.ts`):
   - `status(ctx)` must reflect reality: `needs_credentials` / `needs_oauth` / `needs_provider_approval` until a real token is stored and verified.
   - `validate(payload)` → preflight issues (format, length, media, privacy allowed for an unaudited app).
   - `publish(ctx, payload, idempotencyKey)` → return `ambiguous` on timeouts/network errors after sending; never throw away a provider ID.
   - `checkStatus(ctx, key)` → look up whether the post exists (needed before any retry of an ambiguous job).
3. OAuth: authorization code + PKCE, least-privilege scopes, tokens only via `ctx.secrets` (encrypted), refresh + revoke, and `disconnect` deletes tokens and API-sourced data (`analytics_imports.source = 'api:<id>'`).
4. Register it in `connectors/registry.ts`. The publish gate (`services/publishing.ts`) already enforces kill switch, approval of current variant, preview-hash confirmation and idempotency — do not add a second path around it.
5. Tests: copy `tests/integration/publishing.test.ts` patterns (kill switch, stale preview, duplicate, ambiguous → check → retry, audit events). Use mocked HTTP; never hit a live account in CI.
6. YouTube specifics: no downloading audiovisual content, no engagement automation, explicit user-selected privacy, respect 30-day stored-data refresh and deletion on revoke.
