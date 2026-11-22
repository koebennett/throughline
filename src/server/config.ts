import { resolve, dirname, join } from "node:path";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  secretKeyHex?: string;
  secretKeyFile: string;
  anthropicApiKey?: string;
  anthropicBaseURL?: string;
  strongModel: string;
  fastModel: string;
  youtubeClientId?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dbPath = env.CSA_DB_PATH === ":memory:" ? ":memory:" : resolve(env.CSA_DB_PATH || "data/throughline.sqlite");
  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || "127.0.0.1",
    dbPath,
    secretKeyHex: env.CSA_SECRET_KEY || undefined,
    secretKeyFile: dbPath === ":memory:" ? ":memory:" : join(dirname(dbPath), "secret.key"),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicBaseURL: env.CSA_ANTHROPIC_BASE_URL || undefined,
    strongModel: env.CSA_MODEL_STRONG || "claude-opus-5-5",
    fastModel: env.CSA_MODEL_FAST || "claude-haiku-5-5",
    youtubeClientId: env.YOUTUBE_OAUTH_CLIENT_ID || undefined,
  };
}
