---
name: product-qa
description: Use when verifying Throughline end to end after a change — runs checks, exercises the offline pipeline, and inspects the UI for honest labelling, dead controls, and gate bypasses.
---

# Product QA for Throughline

1. `npm run check` — must be fully green (types, lint, 68+ tests, secret scan).
2. `npm run test:e2e` — onboarding → strategy gate → ideas → brief → drafts → QA blockers → human edit → approve → hand-off; analytics import; settings honesty.
   - In a cloud container with preinstalled browsers: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npm run test:e2e`.
3. Manual pass (`npm run build && npm start`, open http://127.0.0.1:8787):
   - Fresh DB → onboarding shows "Explore with demo data"; demo brand shows the DEMO banner everywhere.
   - Top bar shows "Offline scaffold — no AI connected" without a key; never "Claude" unless the key test passes.
   - Every button does something or is disabled with a reason. Every list has loading/empty/error states.
   - Try to bypass gates: approve with blockers, schedule/publish unapproved, edit after approval (must drop to DRAFT).
4. Honesty checks: no metric shown without source + window; scores labelled "not a prediction"; hypotheses vs observations labelled.
5. Mutation-check any new gate: break it locally, confirm a test fails, restore.
