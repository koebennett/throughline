---
name: release-check
description: Use before tagging a release or handing a build to a user — verifies install, migrations, security posture and docs accuracy.
---

# Release check

1. Clean install on a fresh clone: `npm ci && npm run build && npm start` (Node ≥ 22.13). Repeat on Windows if possible.
2. `npm run check` and `npm run test:e2e` green.
3. Migrations: start against a COPY of a previous-version DB; confirm data intact and new migrations applied. Never reset user data.
4. Security: `npm run check:secrets`; `.env`, `data/*.sqlite*`, `data/secret.key` untracked; no secrets in `dist/client` (`grep -rE "sk-ant-[A-Za-z0-9_-]{20}" dist/` must be empty; the settings placeholder text is expected); CSP header present on `/`.
5. Honest status: Settings → Integrations shows nothing as connected that isn't; publishing kill switch defaults OFF on a fresh DB.
6. Docs: README commands still correct; `docs/KNOWN_LIMITATIONS.md` and `docs/INTEGRATIONS.md` reflect reality (dates updated).
