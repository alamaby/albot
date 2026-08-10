import { afterEach, describe, expect, it, vi } from "vitest";
import { PixazoImageAdapter } from "@/server/providers/image/pixazo.adapter";
import type { GenerateImageInput } from "@/server/domain/provider";
import { ProviderError } from "@/server/providers/errors";

const mockFetch = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("PixazoImageAdapter - Flux Schnell", () => {
  const adapter = new PixazoImageAdapter(
    {
      baseUrl: "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
      model: "flux-1-schnell",
      responseKind: "flux",
    },
    "test-subscription-key",
  );

  it("sends correct request to Flux Schnell endpoint", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        output: "https://cdn.example.invalid/test.png",
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
    expect(result.imageUrl).toBe("https://cdn.example.invalid/test.png");
  });

  it("maps empty output to provider_response_invalid", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ output: "" }),
    });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("rejects non-https output url", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ output: "http://cdn.example.invalid/insecure.png" }),
    });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("captures request_id from response body", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        output: "https://cdn.example.invalid/with-request-id.png",
        request_id: "flux-req-77",
      }),
    });

    const result = await adapter.generateImage({ prompt: "Test", parameters: {} });
    expect(result.providerRequestId).toBe("flux-req-77");
    expect(result.metadata).toMatchObject({ model: "flux-1-schnell" });
  });

  it("classifies 429 as retryable rate limit", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
      httpStatus: 429,
    });
  });

  it("classifies 401 as non-retryable authentication failure", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toMatchObject({
      code: "provider_authentication_failed",
      retryable: false,
      httpStatus: 401,
    });
  });

  it("rejects non-https base urls", () => {
    expect(
      () =>
        new PixazoImageAdapter(
          { baseUrl: "http://insecure.example.com", model: "flux-1-schnell", responseKind: "flux" },
          "key",
        ),
    ).toThrow(ProviderError);
  });
});

describe("PixazoImageAdapter - SDXL", () => {
  const adapter = new PixazoImageAdapter(
    {
      baseUrl: "https://gateway.pixazo.ai/getImage/v1/getSDXLImage",
      model: "stable-diffusion-xl-base-1.0",
      responseKind: "sdxl",
    },
    "test-subscription-key",
  );

  it("sends correct request to SDXL endpoint", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        imageUrl: "https://cdn.example.invalid/sdxl-test.png",
      }),
    });

    const input: GenerateImageInput = {
      prompt: "A sparrow on a branch",
      parameters: { num_steps: 20, guidance_scale: 5, seed: 40 },
    };

    const result = await adapter.generateImage(input);

    expect(result.status).toBe("completed");
    expect(result.imageUrl).toBe("https://cdn.example.invalid/sdxl-test.png");
  });

  it("maps empty imageUrl to provider_response_invalid", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ imageUrl: "" }),
    });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("rejects non-https imageUrl", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ imageUrl: "http://cdn.example.invalid/insecure.png" }),
    });

    await expect(adapter.generateImage({ prompt: "Test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("prefers request_id over id from response body", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        imageUrl: "https://cdn.example.invalid/sdxl-request-id.png",
        request_id: "sdxl-req-1",
        id: "sdxl-req-2",
      }),
    });

    const result = await adapter.generateImage({ prompt: "Test", parameters: {} });
    expect(result.providerRequestId).toBe("sdxl-req-1");
    expect(result.metadata).toMatchObject({ model: "stable-diffusion-xl-base-1.0" });
  });

  it("parses SDXL responses even when the model name does not contain sdxl", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        imageUrl: "https://cdn.example.invalid/sdxl-schema.png",
        id: "req-123",
      }),
    });

    const result = await adapter.generateImage({ prompt: "Test", parameters: {} });
    expect(result.status).toBe("completed");
    expect(result.imageUrl).toBe("https://cdn.example.invalid/sdxl-schema.png");
    expect(result.providerRequestId).toBe("req-123");
  });
});
