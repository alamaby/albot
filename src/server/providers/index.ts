// Initialize the provider registry with all available adapters.
// Adapters register themselves when imported.
// Factories prefer `base_url`/`model` from the provider config row (H8) and
// fall back to provider-specific defaults when the row does not provide them.

import { getProviderRegistry } from "./registry";
import { OpenAICompatibleReasoningAdapter } from "./reasoning/openai-compatible.adapter";
import { PixazoImageAdapter } from "./image/pixazo.adapter";

const registry = getProviderRegistry();

// Register OpenAI-compatible reasoning adapter.
registry.registerReasoning("openai_compatible", (config, apiKey) => {
  return new OpenAICompatibleReasoningAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://api.openai.com/v1",
      model: (config["model"] as string) ?? "gpt-4",
      timeoutMs: (config["timeout_ms"] as number) ?? 60000,
    },
    apiKey,
  );
});

// Register Pixazo image adapters.
registry.registerImage("pixazo_flux_schnell", (config, apiKey) => {
  return new PixazoImageAdapter(
    {
      baseUrl:
        (config["base_url"] as string) ?? "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
      model: (config["model"] as string) ?? "flux-1-schnell",
      responseKind: "flux",
      timeoutMs: (config["timeout_ms"] as number) ?? 120000,
    },
    apiKey,
  );
});

registry.registerImage("pixazo_sdxl", (config, apiKey) => {
  return new PixazoImageAdapter(
    {
      baseUrl:
        (config["base_url"] as string) ?? "https://gateway.pixazo.ai/getImage/v1/getSDXLImage",
      model: (config["model"] as string) ?? "sdxl",
      responseKind: "sdxl",
      timeoutMs: (config["timeout_ms"] as number) ?? 120000,
    },
    apiKey,
  );
});

// Export mock factories for testing.
export { createDefaultMockReasoningProvider } from "./mock/mock-reasoning.adapter";
export { createDefaultMockImageProvider } from "./mock/mock-image.adapter";
