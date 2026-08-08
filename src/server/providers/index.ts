// Initialize the provider registry with all available adapters.
// Adapters register themselves when imported.

import { getProviderRegistry } from "./registry";
import { OpenAICompatibleReasoningAdapter } from "./reasoning/openai-compatible.adapter";
import { PixazoImageAdapter } from "./image/pixazo.adapter";
import { createDefaultMockReasoningProvider } from "./mock/mock-reasoning.adapter";
import { createDefaultMockImageProvider } from "./mock/mock-image.adapter";

const registry = getProviderRegistry();

// Register OpenAI-compatible reasoning adapter.
registry.registerReasoning("openai_compatible", (config, apiKey) => {
  return new OpenAICompatibleReasoningAdapter(
    {
      baseUrl: config["base_url"] as string,
      model: config["model"] as string,
      timeoutMs: (config["timeout_ms"] as number) ?? 60000,
    },
    apiKey,
  );
});

// Register Pixazo image adapters.
registry.registerImage("pixazo_flux_schnell", (config, apiKey) => {
  return new PixazoImageAdapter(
    {
      baseUrl: "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
      model: "flux-1-schnell",
      timeoutMs: (config["timeout_ms"] as number) ?? 120000,
    },
    apiKey,
  );
});

registry.registerImage("pixazo_sdxl", (config, apiKey) => {
  return new PixazoImageAdapter(
    {
      baseUrl: "https://gateway.pixazo.ai/getImage/v1/getSDXLImage",
      model: "stable-diffusion-xl-base-1.0",
      timeoutMs: (config["timeout_ms"] as number) ?? 120000,
    },
    apiKey,
  );
});

// Export mock factories for testing.
export { createDefaultMockReasoningProvider } from "./mock/mock-reasoning.adapter";
export { createDefaultMockImageProvider } from "./mock/mock-image.adapter";
