import type { Db } from "./db/db.js";
import type { Config } from "./config.js";
import type { ModelProvider } from "./providers/model/types.js";
import { AnthropicProvider } from "./providers/model/anthropic.js";
import { OfflineProvider } from "./providers/model/offline.js";
import { SecretStore } from "./lib/secrets.js";
import { getSettings, type Settings } from "./services/settings.js";

export interface Ctx {
  db: Db;
  config: Config;
  secrets: SecretStore;
  settings(): Settings;
  model(): ModelProvider;
  /** Re-resolve the model provider (after a key is saved or removed in Settings). */
  refreshModel(): void;
  /** Test hook: force a specific provider. */
  overrideModel?: ModelProvider;
}

export function createCtx(db: Db, config: Config, opts: { model?: ModelProvider } = {}): Ctx {
  const secrets = new SecretStore(db, config.secretKeyHex, config.secretKeyFile);
  let current: ModelProvider;
  const resolveModel = (): ModelProvider => {
    if (opts.model) return opts.model;
    const key = config.anthropicApiKey || secrets.get("anthropic:api_key") || "";
    if (key) return new AnthropicProvider({ apiKey: key, baseURL: config.anthropicBaseURL, strongModel: config.strongModel, fastModel: config.fastModel });
    return new OfflineProvider();
  };
  current = resolveModel();
  return {
    db,
    config,
    secrets,
    settings: () => getSettings(db),
    model: () => current,
    refreshModel: () => {
      current = resolveModel();
    },
  };
}
