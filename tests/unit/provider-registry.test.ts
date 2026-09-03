import { describe, expect, it } from "vitest";
import { getProviderRegistry } from "@/server/providers/registry";
import { ProviderError } from "@/server/providers/errors";
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

  it("resolves aichixia image adapters (4 models)", () => {
    const registry = getProviderRegistry();
    for (const [type, model] of [
      ["aichixia_flux2", "flux-2-dev"],
      ["aichixia_lucid", "lucid-origin"],
      ["aichixia_phoenix", "phoenix-1.0"],
      ["aichixia_gemini", "gemini-3-pro-image"],
    ] as const) {
      const provider = registry.createImageProvider(
        type,
        { base_url: "https://www.aichixia.xyz/api/v1", model },
        "test-api-key",
      );
      expect(provider).toBeDefined();
      expect(typeof provider.generateImage).toBe("function");
      expect(registry.getCapability(type)).toBe("image_generation");
    }
  });

  it("throws for unknown adapter type", () => {
    const registry = getProviderRegistry();
    expect(() => registry.createReasoningProvider("unknown_adapter", {}, "key")).toThrow(
      "unknown provider adapter type",
    );
  });

  it("throws ProviderError for unknown adapter type", () => {
    const registry = getProviderRegistry();
    expect(() => registry.createReasoningProvider("unknown_adapter", {}, "key")).toThrow(
      ProviderError,
    );
    expect(() => registry.createReasoningProvider("unknown_adapter", {}, "key")).toThrowError(
      expect.objectContaining({ code: "provider_adapter_unknown", retryable: false }),
    );
  });

  it("rejects reasoning adapter requested as image (capability mismatch)", () => {
    const registry = getProviderRegistry();
    expect(() => registry.createImageProvider("openai_compatible", {}, "key")).toThrowError(
      expect.objectContaining({ code: "provider_capability_mismatch", retryable: false }),
    );
  });

  it("createProviderForConfig enforces capability match", () => {
    const registry = getProviderRegistry();
    expect(() =>
      registry.createProviderForConfig(
        { capability: "image_generation", adapterType: "openai_compatible" },
        {},
        "key",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "provider_capability_mismatch", retryable: false }),
    );

    const provider = registry.createProviderForConfig(
      { capability: "reasoning", adapterType: "openai_compatible" },
      { base_url: "https://api.openai.com", model: "gpt-4" },
      "key",
    );
    expect(provider).toBeDefined();
  });

  it("reports capability per adapter type", () => {
    const registry = getProviderRegistry();
    expect(registry.getCapability("openai_compatible")).toBe("reasoning");
    expect(registry.getCapability("pixazo_flux_schnell")).toBe("image_generation");
    expect(registry.getCapability("does_not_exist")).toBeNull();
  });

  it("registers mock adapters", () => {
    const mockReasoning = createDefaultMockReasoningProvider();
    const mockImage = createDefaultMockImageProvider();
    expect(mockReasoning).toBeDefined();
    expect(mockImage).toBeDefined();
  });
});
