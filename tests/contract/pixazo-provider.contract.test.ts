import { describe, expect, it, vi } from "vitest";
import { PixazoImageAdapter } from "@/server/providers/image/pixazo.adapter";
import type { GenerateImageInput } from "@/server/domain/provider";
import { ProviderError } from "@/server/providers/errors";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("PixazoImageAdapter - Flux Schnell", () => {
  const adapter = new PixazoImageAdapter(
    { baseUrl: "https://gateway.pixazo.ai/flux-1-schnell/v1/getData", model: "flux-1-schnell" },
    "test-subscription-key",
  );

  it("sends correct request to Flux Schnell endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        output: "https://pub-582b7213209642b9b995c96c95a30381.r2.dev/test.png",
      }),
    });

    const input: GenerateImageInput = {
      prompt: "A futuristic city",
      parameters: { num_steps: 4, seed: 42 },
    };

    const result = await adapter.generateImage(input);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "Ocp-Apim-Subscription-Key": "test-subscription-key",
        }),
      }),
    );
    expect(result.status).toBe("completed");
    expect(result.imageUrl).toBe("https://pub-582b7213209642b9b995c96c95a30381.r2.dev/test.png");
  });

  it("maps empty output to provider_response_invalid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ output: "" }),
    });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toThrow();
  });
});

describe("PixazoImageAdapter - SDXL", () => {
  const adapter = new PixazoImageAdapter(
    { baseUrl: "https://gateway.pixazo.ai/getImage/v1/getSDXLImage", model: "sdxl" },
    "test-subscription-key",
  );

  it("sends correct request to SDXL endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        imageUrl: "https://pub-582b7213209642b9b995c96c95a30381.r2.dev/sdxl-test.png",
      }),
    });

    const input: GenerateImageInput = {
      prompt: "A sparrow on a branch",
      parameters: { num_steps: 20, guidance_scale: 5, seed: 40 },
    };

    const result = await adapter.generateImage(input);

    expect(result.status).toBe("completed");
    expect(result.imageUrl).toBe(
      "https://pub-582b7213209642b9b995c96c95a30381.r2.dev/sdxl-test.png",
    );
  });

  it("maps empty imageUrl to provider_response_invalid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ imageUrl: "" }),
    });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toThrow();
  });
});
