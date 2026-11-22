# Known limitations (honest status)

Updated 2026-11-22. Nothing below is hidden in the UI — statuses are labelled where they appear.

## Not verified live
- **Claude API calls have not been executed against the real API** in the build environment (no key was available). The provider is tested at the SDK boundary (request shape, structured-output parsing, refusals, truncation, web-search source/citation extraction, paused turns) and the exact SDK call typechecks against `@anthropic-ai/sdk@1.12.0`. First real run: Settings → Integrations → paste key → **Test connection**, then run "Ask the strategist".
- Structured-output schemas use `z.number().min/max`; if the API's JSON-schema subset rejects a constraint, the SDK helper normally strips it — if a 400 occurs, relax the constraint in `src/shared/schemas.ts`.

## Not built yet
- **YouTube** read-only analytics is implemented but untested against a real Google account; YouTube **upload** is not built (videos aren't stored by the app). **Other live connectors** (TikTok, Meta, LinkedIn, Buffer/Postiz) need provider approval. The connector interface, honest status registry, and the full publish gate (kill switch, approval binding, preview-hash confirmation, idempotency, ambiguous-outcome check, audit) exist and are tested with a mock connector. Use CSV import + manual hand-off meanwhile.
- **Per-channel automatic publishing** policies (the setting exists but nothing auto-publishes; every post needs a human confirmation).
- **Scheduled background jobs** (e.g. weekly summary, timed publishing): there is no scheduler; the Command Center computes the summary on view.
- **Embeddings/vector retrieval**: Brand Brain uses SQLite FTS5 (BM25). `services/brain.ts#retrieve` is the seam to add vectors.
- **Media processing**: video/audio files are recorded as metadata only (bytes not stored, no transcription, no clip rendering). Paste or upload transcripts (.txt/.srt/.vtt). Edit clips from your original files.
- **Email/push notifications**: the desktop app shows native notifications when an agent run awaits approval; nothing is emailed.
- **Windows app**: the portable `.exe` was built, and its exact app payload was launch- and function-tested (UI renders, demo pipeline, exports) under Electron on Linux. It has not been run on a Windows PC by the author. It is unsigned (SmartScreen warning). The NSIS installer is built by GitHub Actions on a Windows runner because Wine crashes in the build container.
- **Multi-user / hosted mode**: single user, no login; the API trusts any local caller on 127.0.0.1. Do not expose it on a network. PostgreSQL/auth would be needed for hosting.

## Behavioural limits
- Without a Claude key, all generated strategy/ideas/briefs/drafts are **offline scaffolds**: deterministic structures from your profile with `[insert: …]` markers. QA blocks approval until markers are replaced. They are useful structure, not finished content.
- QA rubric dimension scores without a model are **heuristics** (keyword overlap, structure, length). Hard blockers are reliable rule checks; nuanced judgement (accuracy, originality of insight) needs the model or you.
- Platform length limits are commonly documented values surfaced as **warnings** with "verify" wording.
- Analytics comparisons are descriptive (ratio to own median); small samples are labelled low confidence. No causal claims.
- Opportunity scores are prioritisation aids; missing data is penalised and shown, never assumed.
- Cost figures are estimates from list prices.
- Calendar month/week grids display in the browser's time zone; each entry stores its own IANA time zone label.
- `node:sqlite` prints an experimental warning on Node 22 (suppressed in npm scripts). Requires Node ≥ 22.13.
