import { defineConfig } from "@playwright/test";

// E2E runs against a throwaway database so it never touches your real data.
const port = Number(process.env.E2E_PORT ?? 8799);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `npm run build && node --disable-warning=ExperimentalWarning scripts/e2e-server.mjs`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: String(port), CSA_DB_PATH: "data/e2e.sqlite", CSA_E2E_RESET: "1" },
  },
});
