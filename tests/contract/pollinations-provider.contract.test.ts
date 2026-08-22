import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleReasoningAdapter } from "@/server/providers/reasoning/openai-compatible.adapter";
import { PollinationsImageAdapter } from "@/server/providers/image/pollinations.adapter";
import type { EnhancePromptInput, GenerateImageInput } from "@/server/domain/provider";
import { ProviderError } from "@/server/providers/errors";

const mockFetch = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("Pollinations reasoning (via OpenAICompatible adapter with pollinations baseUrl)", () => {
  const adapter = new OpenAICompatibleReasoningAdapter(
    { baseUrl: "https://gen.pollinations.ai/v1", model: "gpt-oss" },
    "test-api-key",
  );

  it("sends to /chat/completions with Bearer and injects model gpt-oss", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [
          {
            message: { content: '{"prompt":"enhanced","negative_prompt":"","aspect_ratio":"1:1"}' },
          },
        ],
        model: "gpt-oss",
      }),
    });

    const input: EnhancePromptInput = {
      sourcePrompt: "a cat",
      systemPrompt: "sys",
      options: {},
    };
    const result = await adapter.enhancePrompt(input);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://gen.pollinations.ai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
          "HTTP-Referer": "https://albot-ten.vercel.app",
        }),
      }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-oss");
    expect(result.prompt.length).toBeGreaterThan(0);
  });

  it("rejects non-https baseUrl", () => {
    expect(
      () => new OpenAICompatibleReasoningAdapter({ baseUrl: "http://bad", model: "gpt-oss" }, "k"),
    ).toThrow(ProviderError);
  });
});

describe("PollinationsImageAdapter", () => {
  const adapter = new PollinationsImageAdapter(
    { baseUrl: "https://gen.pollinations.ai/v1", model: "flux" },
    "test-api-key",
  );

  it("posts to /v1/images/generations with prompt/model/size/url and injects negativePrompt", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "req-123" }),
      json: async () => ({
        created: 1,
        data: [{ url: "https://media.pollinations.ai/img.png", revised_prompt: "rev" }],
      }),
    });

    const input: GenerateImageInput = {
      prompt: "a cat in space",
      negativePrompt: "blurry",
      aspectRatio: "1:1",
      parameters: {},
    };
    const result = await adapter.generateImage(input);
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.imageUrl).toBe("https://media.pollinations.ai/img.png");
      expect(result.mimeType).toBe("image/png");
      expect(result.metadata).toMatchObject({ model: "flux" });
    }
    expect(mockFetch).toHaveBeenCalledWith(
      "https://gen.pollinations.ai/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["prompt"]).toBe("a cat in space Avoid: blurry");
    expect(body["model"]).toBe("flux");
    expect(body["size"]).toBe("1024x1024");
    expect(body["response_format"]).toBe("url");
    const headers = mockFetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-api-key");
  });

  it("maps 16:9 to 1792x1024", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ created: 1, data: [{ url: "https://x/y.png" }] }),
    });
    await adapter.generateImage({ prompt: "test", aspectRatio: "16:9", parameters: {} });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body["size"]).toBe("1792x1024");
  });

  it("supports b64_json fallback", async () => {
    vi.stubGlobal("fetch", mockFetch);
    const b64 = Buffer.from("hello").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ created: 1, data: [{ b64_json: b64 }] }),
    });
    const result = await adapter.generateImage({ prompt: "test", parameters: {} });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.imageBytes).toBeInstanceOf(Uint8Array);
    }
  });

  it("rejects non-https baseUrl", () => {
    expect(
      () => new PollinationsImageAdapter({ baseUrl: "http://bad", model: "flux" }, "k"),
    ).toThrow(ProviderError);
  });

  it("throws on invalid data array", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ created: 1, data: [] }),
    });
    await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject({
      code: "provider_response_invalid",
    });
  });

  it("classifies 402 as retryable false rate_limited", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      headers: new Headers(),
      text: async () => "no pollen",
    });
    await expect(adapter.generateImage({ prompt: "test", parameters: {} })).rejects.toMatchObject({
      code: "provider_rate_limited",
      httpStatus: 402,
    });
  });
});
