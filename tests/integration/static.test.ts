import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "../../src/server/server.js";
import { loadConfig } from "../../src/server/config.js";

// Regression: the packaged desktop app serves the UI from a directory outside the cwd (inside app.asar).
let srv: RunningServer;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "tl-client-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), '<!doctype html><script type="module" src="/assets/app-abc123.js"></script>');
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log('ok')");
  srv = await startServer({ ...loadConfig({ CSA_DB_PATH: ":memory:" } as any), port: 0, anthropicApiKey: undefined }, { clientDir: dir });
});
afterAll(() => srv.close());

describe("static UI serving", () => {
  it("serves hashed assets with the right type from a client dir outside the cwd", async () => {
    const r = await fetch(`${srv.url}/assets/app-abc123.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
    expect(await r.text()).toBe("console.log('ok')");
  });
  it("404s missing or traversal asset paths instead of returning the HTML shell", async () => {
    expect((await fetch(`${srv.url}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${srv.url}/assets/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
  });
  it("serves the SPA shell with a strict CSP for app routes", async () => {
    const r = await fetch(`${srv.url}/calendar`);
    expect(await r.text()).toContain("/assets/app-abc123.js");
    expect(r.headers.get("content-security-policy")).toContain("script-src 'self'");
  });
});
