import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrap, loadEnvFile } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { log } from "./lib/log.js";

loadEnvFile();
const config = loadConfig();
const { app, ctx, interrupted } = bootstrap(config);

// Serve the built UI (npm run build) with a strict CSP. In development Vite serves the UI instead.
const clientDir = resolve("dist/client");
if (existsSync(clientDir)) {
  const indexHtml = readFileSync(resolve(clientDir, "index.html"), "utf8");
  app.use("*", async (c, next) => {
    await next();
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
  });
  app.use("/assets/*", serveStatic({ root: "./dist/client" }));
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log.info("Throughline API listening", { url: `http://${config.host}:${info.port}`, model: ctx.model().live ? ctx.model().models.strong : "offline-scaffold", db: config.dbPath, interruptedRuns: interrupted });
  if (config.host !== "127.0.0.1" && config.host !== "localhost") log.warn("HOST is not loopback. The API has no login — only expose it on a trusted network.");
});
