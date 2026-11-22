# Throughline — Content Strategy Agent

An evidence-led content strategist and operating system for creators and small teams. It helps you decide **what** to publish, **who** it's for, **why** it should work, **how** to make it, **where/when** to ship it, and **what to change** after results arrive:

research → evidence audit → strategy → ideas → briefs → platform-native drafts → QA → approval → calendar/hand-off → analytics → learning.

- **Honest by construction**: sources are dated, and unsourced "facts" are downgraded to inferences automatically. Scores are labelled triage aids, metrics always show their source and data window, and no mock is ever shown as live.
- **Human in control**: drafts by default. Strategy changes, calendar writes and learnings need your approval. Publishing is OFF by default and gated by deterministic code.
- **Works without any API key**: an explicit offline scaffold engine builds structures from your own data. Add a Claude key for researched, synthesised work.
- **Local-first**: one SQLite file on your machine.

## Windows desktop app
Download **`Throughline-x.y.z-portable.exe`** from the repository's **Releases** page and double-click it. It's a single self-contained file with nothing to install. An installer (`Throughline-x.y.z-setup.exe`, adds Start-menu and desktop shortcuts) is also built there. Both are unsigned, so Windows SmartScreen may warn: choose *More info → Run anyway*. The portable app unpacks itself to a temp folder on each launch, so the first start takes a few seconds.
- Data lives in `%APPDATA%\Throughline\` (database, encrypted-key file, backups). **File → Open data folder** and **File → Back up database…** are in the menu.
- To use Claude, paste your key in **Settings → Integrations**, or put `ANTHROPIC_API_KEY=...` in `%APPDATA%\Throughline\.env`.
- You get a desktop notification when an agent run is waiting for your approval.
- To build it yourself, run `npm ci` then `npm run dist:win` (portable + installer). On Linux, `npm run dist:win-portable` builds just the portable exe. The output goes to `release\`. `npm run desktop` runs it without packaging.

## Use Throughline from Claude Desktop / Claude Code (MCP)
With the app running, add this to Claude Desktop's `claude_desktop_config.json` (adjust the path):
```json
{ "mcpServers": { "throughline": { "command": "node", "args": ["C:\\path\\to\\throughline\\dist\\server\\mcp\\server.js"] } } }
```
It finds the desktop app automatically (via `%APPDATA%\Throughline\runtime.json`), or set `THROUGHLINE_URL=http://127.0.0.1:8787`. Tools include list_brands, command_center, get_brand, search_brand_docs, list_evidence, list_ideas, list_content, get_content, get_analytics, get_run, add_evidence, add_idea and run_task. There are **no** approve, publish or delete tools: those stay with you in the app.

## Requirements
- **Node.js 22.13 or newer** (uses the built-in `node:sqlite`, so there are no native build tools to install). Check with `node -v`.
- Windows 10/11, macOS or Linux.

## Install & run

### Windows (PowerShell)
```powershell
git clone <your-repo-url> throughline
cd throughline
npm install
copy .env.example .env      # optional: add ANTHROPIC_API_KEY
npm run build
npm start
```

### macOS / Linux
```bash
git clone <your-repo-url> throughline && cd throughline
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY
npm run build
npm start
```

Open **http://127.0.0.1:8787**. On first run choose **Explore with demo data** (fictional, clearly labelled) or create your brand.

### Development (hot reload)
```bash
npm run dev
```
The UI runs at http://localhost:5173 and proxies `/api` to the server on :8787.

## Connect Claude (optional, recommended)
Either set `ANTHROPIC_API_KEY` in `.env` and restart, or paste a key in **Settings → Integrations**, where it is verified and then stored encrypted. Defaults: `claude-opus-5-5` for strategy, research synthesis and drafting; `claude-haiku-5-5` for QA judgement. Per-run and monthly cost caps are in **Settings → Agent, budgets & QA**. Details: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Test & check
```bash
npm run check            # typecheck + lint + unit/integration tests + secret scan
npm run e2e:install      # once: download Playwright's Chromium
npm run test:e2e         # builds, starts on :8799 with a throwaway DB, drives the UI
```

## Data, backup, restore
- Data lives in `data/throughline.sqlite`, and saved keys are encrypted with `data/secret.key`. Keep the two together, and never commit or share them.
- Back up with `npm run db:backup`, which writes a snapshot to `data/backups/`.
- To restore, stop the server, copy a backup over `data/throughline.sqlite`, then start again.
- To export one brand, use **Settings → Data & privacy → Download full brand export (JSON)**.
- To delete a brand and all its data, use **Settings → Data & privacy**.
- `npm run db:seed-demo` creates the demo brand from the CLI.

## Configuration (`.env`)
| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude |
| `CSA_MODEL_STRONG` / `CSA_MODEL_FAST` | `claude-opus-5-5` / `claude-haiku-5-5` | Model tiers |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Keep loopback: the API has no login |
| `CSA_DB_PATH` | `data/throughline.sqlite` | Database file |
| `CSA_SECRET_KEY` | generated in `data/secret.key` | 64-hex key for secrets at rest |
| `YOUTUBE_OAUTH_CLIENT_ID/SECRET` | — | Reserved for the YouTube connector (not built yet) |

## What's where
| Area | Path |
|---|---|
| Command Center, Brand Brain, Research, Strategy, Ideas, Briefs, Studio, Repurposing, Calendar, Analytics, Agent, Settings | `src/client/pages/` |
| API | `src/server/app.ts` |
| Domain services & gates | `src/server/services/` |
| Agent workflow (engine, tasks, prompts, offline scaffolds) | `src/server/agent/` |
| Scoring, state machine, schemas, platform specs, metrics | `src/shared/` |
| Architecture & security model | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Limitations | [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) |
| Plan / checklist | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |

## Troubleshooting
- **`No such built-in module: node:sqlite`**: upgrade Node to 22.13 or newer.
- **Port in use**: set `PORT=8788` in `.env`.
- **"Host not allowed" or 403 on writes**: open the app via `127.0.0.1` or `localhost`. Cross-site requests are blocked on purpose.
- **Claude key rejected**: use **Settings → Integrations → Test connection**. Check billing, and that the model is enabled for your organization.
- **A run failed with "budget reached"**: raise the run budget in Settings, then **Retry from failed step**. Completed steps are kept.
- **A run shows "interrupted"**: the server restarted mid-run. Press **Resume**.
- **E2E can't find a browser**: run `npm run e2e:install`, or set `PLAYWRIGHT_CHROMIUM_PATH` to a Chromium binary.

## Product principles
No guarantees of virality, growth, revenue or monetization. No scraping behind logins, engagement automation or reposting others' media. Competitor research is for spotting patterns and gaps, not copying. Recommendations come with their evidence, assumptions, confidence, next action and success metric.
