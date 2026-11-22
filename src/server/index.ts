import { loadEnvFile } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

loadEnvFile();
await startServer(loadConfig());
