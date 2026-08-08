import { describe, expect, it } from "vitest";
import { getProviderRegistry } from "@/server/providers/registry";
import {
  createDefaultMockReasoningProvider,
  createDefaultMockImageProvider,
} from "@/server/providers";

describe("ProviderRegistry", () => {
  it("resolves openai_compatible reasoning adapter", () => {
    const registry = getProviderRegistry();
    const provider = registry.createReasoningProvider(
      "openai_compatible",
      { base_url: "https://api.openai.com", model: "gpt-4" },
      "test-api-key",
    );
    expect(provider).toBeDefined();
    expect(typeof provider.enhancePrompt).toBe("function");
  });

  it("resolves pixazo_flux_schnell image adapter", () => {
    const registry = getProviderRegistry();
    const provider = registry.createImageProvider(
      "pixazo_flux_schnell",
      { base_url: "https://gateway.pixazo.ai/flux-1-schnell/v1/getData", model: "flux-1-schnell" },
      "test-subscription-key",
    );
    expect(provider).toBeDefined();
    expect(typeof provider.generateImage).toBe("function");
  });

  it("resolves pixazo_sdxl image adapter", () => {
    const registry = getProviderRegistry();
    const provider = registry.createImageProvider(
      "pixazo_sdxl",
      {
        base_url: "https://gateway.pixazo.ai/getImage/v1/getSDXLImage",
        model: "stable-diffusion-xl-base-1.0",
      },
      "test-subscription-key",
    );
    expect(provider).toBeDefined();
    expect(typeof provider.generateImage).toBe("function");
  });

  it("throws for unknown adapter type", () => {
    const registry = getProviderRegistry();
    expect(() => registry.createReasoningProvider("unknown_adapter", {}, "key")).toThrow(
      "unknown reasoning adapter type",
    );
  });

  it("registers mock adapters", () => {
    const mockReasoning = createDefaultMockReasoningProvider();
    const mockImage = createDefaultMockImageProvider();
    expect(mockReasoning).toBeDefined();
    expect(mockImage).toBeDefined();
  });
});
