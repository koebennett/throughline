// Reusable server start: used by the CLI entry (index.ts) and the Windows desktop app (desktop/main.mjs).
import { serve, type ServerType } from "@hono/node-server";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrap } from "./bootstrap.js";
import type { Config } from "./config.js";
import { log } from "./lib/log.js";

const MIME: Record<string, string> = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml", png: "image/png", woff: "font/woff", woff2: "font/woff2", ico: "image/x-icon", map: "application/json" };

export interface StartOptions {
  /** Directory containing the built UI (index.html + assets/). */
  clientDir?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
  ctx: ReturnType<typeof bootstrap>["ctx"];
  engine: ReturnType<typeof bootstrap>["engine"];
}

export function startServer(config: Config, opts: StartOptions = {}): Promise<RunningServer> {
  const { app, ctx, engine, db, interrupted } = bootstrap(config);
  const clientDir = resolve(opts.clientDir ?? "dist/client");
  if (existsSync(resolve(clientDir, "index.html"))) {
    const indexHtml = readFileSync(resolve(clientDir, "index.html"), "utf8");
    app.use("*", async (c, next) => {
      await next();
      c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      c.header("X-Frame-Options", "DENY");
      c.header("Referrer-Policy", "no-referrer");
    });
    // Serve hashed build assets from the absolute client dir. Uses plain fs so it also works inside
    // Electron's app.asar (serveStatic resolves against the cwd and cannot reach into the archive).
    const assetsDir = resolve(clientDir, "assets");
    const cache = new Map<string, Buffer>();
    app.get("/assets/:name", (c) => {
      const name = c.req.param("name");
      if (!/^[\w.-]+\.(js|css|svg|png|woff2?|ico|map)$/.test(name) || name.includes("..")) return c.notFound();
      let body = cache.get(name);
      if (!body) {
        const file = resolve(assetsDir, name);
        if (!file.startsWith(assetsDir) || !existsSync(file)) return c.notFound();
        body = readFileSync(file);
        cache.set(name, body);
      }
      return c.body(new Uint8Array(body), 200, { "Content-Type": MIME[name.split(".").pop()!] ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
    });
    app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
  }
  return new Promise((resolveStart, reject) => {
    let server: ServerType;
    try {
      server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
        const url = `http://${config.host}:${info.port}`;
        log.info("Throughline API listening", { url, model: ctx.model().live ? ctx.model().models.strong : "offline-scaffold", db: config.dbPath, interruptedRuns: interrupted });
        if (config.host !== "127.0.0.1" && config.host !== "localhost") log.warn("HOST is not loopback. The API has no login — only expose it on a trusted network.");
        resolveStart({
          port: info.port,
          url,
          ctx,
          engine,
          close: () => new Promise<void>((r) => server.close(() => (db.close(), r()))),
        });
      });
      server.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}
