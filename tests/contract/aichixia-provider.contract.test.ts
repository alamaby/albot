import { afterEach, describe, expect, it, vi } from "vitest";
import { AichixiaImageAdapter } from "@/server/providers/image/aichixia.adapter";
import type { GenerateImageInput } from "@/server/domain/provider";
import { ProviderError } from "@/server/providers/errors";

const mockFetch = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("AichixiaImageAdapter", () => {
  const adapter = new AichixiaImageAdapter(
    { baseUrl: "https://www.aichixia.xyz/api/v1", model: "flux-2-dev" },
    "test-api-key",
  );

  it("posts to /images/generations with Bearer, prompt/model/size/b64_json and native negative_prompt", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "req-123" }),
      json: async () => ({ data: [{ b64_json: Buffer.from("img").toString("base64") }] }),
    });

    const input: GenerateImageInput = {
      prompt: "a cat in space",
      negativePrompt: "blurry",
      aspectRatio: "1:1",
      parameters: { seed: 42 },
    };
    const result = await adapter.generateImage(input);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.imageBytes).toBeInstanceOf(Uint8Array);
      expect(result.mimeType).toBe("image/png");
      expect(result.metadata).toMatchObject({ model: "flux-2-dev" });
    }
    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.aichixia.xyz/api/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["prompt"]).toBe("a cat in space");
    expect(body["model"]).toBe("flux-2-dev");
    expect(body["n"]).toBe(1);
    expect(body["size"]).toBe("1024x1024");
    expect(body["response_format"]).toBe("b64_json");
    expect(body["negative_prompt"]).toBe("blurry");
    expect(body["seed"]).toBe(42);
    const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("maps all aspect ratio variants with unknown fallback", async () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, "1024x1024"],
      ["1:1", "1024x1024"],
      ["16:9", "1792x1024"],
      ["9:16", "1024x1792"],
      ["4:3", "1152x896"],
      ["3:4", "896x1152"],
      ["unknown", "1024x1024"],
    ];
    for (const [ratio, expected] of cases) {
      vi.stubGlobal("fetch", mockFetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
      });
      await adapter.generateImage({ prompt: "test", aspectRatio: ratio, parameters: {} });
      const body = JSON.parse(mockFetch.mock.calls.at(-1)![1].body as string) as Record<
        string,
        unknown
      >;
      expect(body["size"], `ratio ${ratio}`).toBe(expected);
    }
  });

  it("supports url fallback when b64_json is absent", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ url: "https://cdn.aichixia.xyz/img.png" }] }),
    });
    const result = await adapter.generateImage({ prompt: "test", parameters: {} });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.imageUrl).toBe("https://cdn.aichixia.xyz/img.png");
      expect(result.imageBytes).toBeUndefined();
    }
  });

  it("rejects non-https url in data[0]", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ url: "http://insecure/img.png" }] }),
    });
    await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
    });
  });

  it("rejects invalid b64_json", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ b64_json: "@@@" }] }),
    });
    await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
    });
  });

  it("throws on invalid data array", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [] }),
    });
    await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
    });
  });

  it("does not send empty negative_prompt and omits absent optional fields", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
    });
    await adapter.generateImage({ prompt: "test", negativePrompt: "   ", parameters: {} });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["negative_prompt"]).toBeUndefined();
    expect(body["seed"]).toBeUndefined();
    expect(body["steps"]).toBeUndefined();
    expect(body["guidance"]).toBeUndefined();
  });

  it("forwards steps and guidance when provided", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
    });
    await adapter.generateImage({
      prompt: "test",
      parameters: { steps: 30, guidance: 3.5 },
    });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["steps"]).toBe(30);
    expect(body["guidance"]).toBe(3.5);
  });

  it("gemini-3-pro-image omits size/steps/seed/guidance/negative_prompt", async () => {
    const gemini = new AichixiaImageAdapter(
      { baseUrl: "https://www.aichixia.xyz/api/v1", model: "gemini-3-pro-image" },
      "test-api-key",
    );
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
    });
    await gemini.generateImage({
      prompt: "a cat",
      negativePrompt: "blurry",
      aspectRatio: "16:9",
      parameters: { seed: 1, steps: 30, guidance: 4 },
    });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("gemini-3-pro-image");
    expect(body["size"]).toBeUndefined();
    expect(body["seed"]).toBeUndefined();
    expect(body["steps"]).toBeUndefined();
    expect(body["guidance"]).toBeUndefined();
    expect(body["negative_prompt"]).toBeUndefined();
  });

  it("gemini forwards a data URL image parameter and rejects non-data-url", async () => {
    const gemini = new AichixiaImageAdapter(
      { baseUrl: "https://www.aichixia.xyz/api/v1", model: "gemini-3-pro-image" },
      "test-api-key",
    );
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }),
    });
    await gemini.generateImage({
      prompt: "edit this",
      parameters: { image: "data:image/png;base64,QUJD" },
    });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["image"]).toBe("data:image/png;base64,QUJD");

    await expect(
      gemini.generateImage({ prompt: "edit", parameters: { image: "https://x/y.png" } }),
    ).rejects.toMatchObject({ code: "provider_request_invalid" });
  });

  it("rejects empty prompt", async () => {
    await expect(adapter.generateImage({ prompt: "   ", parameters: {} })).rejects.toMatchObject({
      code: "provider_request_invalid",
    });
  });

  it("rejects invalid seed, steps and guidance", async () => {
    await expect(
      adapter.generateImage({ prompt: "test", parameters: { seed: "not-a-number" } }),
    ).rejects.toMatchObject({ code: "provider_request_invalid" });
    await expect(
      adapter.generateImage({ prompt: "test", parameters: { seed: 1.5 } }),
    ).rejects.toMatchObject({ code: "provider_request_invalid" });
    await expect(
      adapter.generateImage({ prompt: "test", parameters: { steps: -1 } }),
    ).rejects.toMatchObject({ code: "provider_request_invalid" });
    await expect(
      adapter.generateImage({ prompt: "test", parameters: { guidance: 0 } }),
    ).rejects.toMatchObject({ code: "provider_request_invalid" });
  });

  it("rejects non-https baseUrl and empty apiKey in constructor", () => {
    expect(
      () => new AichixiaImageAdapter({ baseUrl: "http://bad", model: "flux-2-dev" }, "k"),
    ).toThrow(ProviderError);
    expect(
      () =>
        new AichixiaImageAdapter(
          { baseUrl: "https://www.aichixia.xyz/api/v1", model: "flux-2-dev" },
          "   ",
        ),
    ).toThrow(ProviderError);
    expect(
      () =>
        new AichixiaImageAdapter({ baseUrl: "https://www.aichixia.xyz/api/v1", model: "  " }, "k"),
    ).toThrow(ProviderError);
  });

  it("handles AbortError as provider_timeout", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject({
      code: "provider_timeout",
      retryable: true,
    });
  });

  it("classifies 401/429/500 from upstream", async () => {
    for (const [status, code] of [
      [401, "provider_authentication_failed"],
      [429, "provider_rate_limited"],
      [500, "provider_upstream_failed"],
    ] as Array<[number, string]>) {
      vi.stubGlobal("fetch", mockFetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        headers: new Headers(),
        text: async () => "err",
      });
      await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject(
        {
          code,
          httpStatus: status,
        },
      );
    }
  });

  it("prefers body request id over header id", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "header-id" }),
      json: async () => ({
        id: "body-id",
        data: [{ b64_json: Buffer.from("x").toString("base64") }],
      }),
    });
    const result = await adapter.generateImage({ prompt: "test", parameters: {} });
    if (result.status === "completed") {
      expect(result.providerRequestId).toBe("body-id");
    }
  });
});
