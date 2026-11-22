import type { GenerateRequest, GenerateResult, ModelProvider } from "./types.js";
import { ZERO_USAGE } from "./types.js";

/**
 * Offline scaffold engine: deterministic, template-based output built from the user's own brand data.
 * It is NOT an AI model and is labelled "offline-scaffold" everywhere it appears in the product.
 */
export class OfflineProvider implements ModelProvider {
  id = "offline";
  label = "Offline scaffold engine (no AI model connected)";
  live = false;
  models = { fast: "offline-scaffold", strong: "offline-scaffold" };
  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const data = req.schema.parse(req.offline());
    return { data, provider: this.id, model: "offline-scaffold", usage: { ...ZERO_USAGE } };
  }
}
