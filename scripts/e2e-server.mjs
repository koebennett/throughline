// Starts the built server against a throwaway DB for Playwright. Never points at your real data.
import { rmSync } from "node:fs";
const db = process.env.CSA_DB_PATH || "data/e2e.sqlite";
if (process.env.CSA_E2E_RESET === "1" && db.includes("e2e")) for (const f of [db, `${db}-wal`, `${db}-shm`]) rmSync(f, { force: true });
process.env.ANTHROPIC_API_KEY = "";
process.env.CSA_LOG = "silent";
await import("../dist/server/server/index.js");
