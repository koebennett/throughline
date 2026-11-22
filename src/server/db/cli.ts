// npm run db:migrate | db:seed-demo | db:backup
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadEnvFile, bootstrap } from "../bootstrap.js";
import { loadConfig } from "../config.js";
import { openDb } from "./db.js";
import { seedDemo } from "../demo.js";

loadEnvFile();
const cmd = process.argv[2];
const config = loadConfig();

if (cmd === "migrate") {
  const db = openDb(config.dbPath);
  console.log(`Migrations up to date for ${config.dbPath}`);
  db.close();
} else if (cmd === "seed-demo") {
  const { ctx, engine, db } = bootstrap(config);
  const r = await seedDemo(ctx, engine);
  console.log(r.created ? `Demo brand created (${r.brandId}).` : `Demo brand already exists (${r.brandId}).`);
  db.close();
} else if (cmd === "backup") {
  const db = openDb(config.dbPath);
  const dir = join(dirname(config.dbPath), "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `throughline-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log(`Backup written to ${file}\nRestore: stop the server, copy this file over ${config.dbPath} (keep data/secret.key alongside it).`);
  db.close();
} else {
  console.log("Usage: tsx src/server/db/cli.ts <migrate|seed-demo|backup>");
  process.exit(1);
}
