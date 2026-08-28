// Initialize the provider registry with all available adapters.
// Adapters register themselves when imported.
// Factories prefer `base_url`/`model` from the provider config row (H8) and
// fall back to provider-specific defaults when the row does not provide them.

import { getProviderRegistry } from "./registry";
import { OpenAICompatibleReasoningAdapter } from "./reasoning/openai-compatible.adapter";
import { PixazoImageAdapter } from "./image/pixazo.adapter";
import { PollinationsImageAdapter } from "./image/pollinations.adapter";
import { BynaraImageAdapter } from "./image/bynara.adapter";

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

// Pollinations reasoning (fallback, gpt-oss) - reuses OpenAI-compatible adapter
registry.registerReasoning("pollinations", (config, apiKey) => {
  return new OpenAICompatibleReasoningAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://gen.pollinations.ai/v1",
      model: (config["model"] as string) ?? "gpt-oss",
      timeoutMs: (config["timeout_ms"] as number) ?? 60000,
    },
    apiKey,
  );
});

// Bynara reasoning router - reuses OpenAI-compatible adapter
registry.registerReasoning("bynara", (config, apiKey) => {
  return new OpenAICompatibleReasoningAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://router.bynara.id/v1",
      model: (config["model"] as string) ?? "laguna-s-2.1",
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

// Pollinations image (fallback, flux) - single type, model via config.model
registry.registerImage("pollinations_image", (config, apiKey) => {
  return new PollinationsImageAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://gen.pollinations.ai/v1",
      model: (config["model"] as string) ?? "flux",
      timeoutMs: (config["timeout_ms"] as number) ?? 120000,
    },
    apiKey,
  );
});

// Bynara image generation - OpenAI-compatible, model via config.model
registry.registerImage("bynara_image", (config, apiKey) => {
  return new BynaraImageAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://api-images.bynara.id/v1",
      model: (config["model"] as string) ?? "agnes-image-2.1-flash",
      timeoutMs: (config["timeout_ms"] as number) ?? 40000,
    },
    apiKey,
  );
});

// Bynara image picker models - one adapter_type per model so the Telegram
// model picker can route by adapter_type. Uses BynaraImageAdapter (b64_json).
registry.registerImage("bynara_a20f", (config, apiKey) => {
  return new BynaraImageAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://api-images.bynara.id/v1",
      model: (config["model"] as string) ?? "agnes-image-2.0-flash",
      timeoutMs: (config["timeout_ms"] as number) ?? 40000,
    },
    apiKey,
  );
});

registry.registerImage("bynara_a21f", (config, apiKey) => {
  return new BynaraImageAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://api-images.bynara.id/v1",
      model: (config["model"] as string) ?? "agnes-image-2.1-flash",
      timeoutMs: (config["timeout_ms"] as number) ?? 40000,
    },
    apiKey,
  );
});

registry.registerImage("bynara_grok", (config, apiKey) => {
  return new BynaraImageAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://api-images.bynara.id/v1",
      model: (config["model"] as string) ?? "grok-imagine",
      timeoutMs: (config["timeout_ms"] as number) ?? 40000,
    },
    apiKey,
  );
});

registry.registerImage("bynara_nbn", (config, apiKey) => {
  return new BynaraImageAdapter(
    {
      baseUrl: (config["base_url"] as string) ?? "https://api-images.bynara.id/v1",
      model: (config["model"] as string) ?? "nano-banana-pro",
      timeoutMs: (config["timeout_ms"] as number) ?? 40000,
    },
    apiKey,
  );
});

// Export mock factories for testing.
export { createDefaultMockReasoningProvider } from "./mock/mock-reasoning.adapter";
export { createDefaultMockImageProvider } from "./mock/mock-image.adapter";
