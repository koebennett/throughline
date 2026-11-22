import { existsSync } from "node:fs";
import { openDb } from "./db/db.js";
import { loadConfig, type Config } from "./config.js";
import { createCtx } from "./context.js";
import { WorkflowEngine } from "./agent/engine.js";
import { registerTasks } from "./agent/tasks.js";
import { createApp } from "./app.js";
import { enforceRetention } from "./services/youtube.js";
import type { ModelProvider } from "./providers/model/types.js";

export function loadEnvFile() {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function bootstrap(config: Config = loadConfig(), opts: { model?: ModelProvider; allowAnyHost?: boolean } = {}) {
  const db = openDb(config.dbPath);
  const ctx = createCtx(db, config, { model: opts.model });
  const engine = new WorkflowEngine(ctx);
  registerTasks(engine);
  const interrupted = engine.recoverInterrupted();
  enforceRetention(ctx);
  const app = createApp(ctx, engine, { allowAnyHost: opts.allowAnyHost });
  return { db, ctx, engine, app, interrupted };
}
