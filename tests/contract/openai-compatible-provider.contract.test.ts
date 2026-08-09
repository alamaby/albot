import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleReasoningAdapter } from "@/server/providers/reasoning/openai-compatible.adapter";
import type { EnhancePromptInput } from "@/server/domain/provider";
import { ProviderError } from "@/server/providers/errors";

const mockFetch = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe("OpenAICompatibleReasoningAdapter", () => {
  const adapter = new OpenAICompatibleReasoningAdapter(
    { baseUrl: "https://api.openai.com", model: "gpt-4" },
    "test-api-key",
  );

  it("sends correct request body", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ message: { content: "This is an enhanced prompt." } }],
        model: "gpt-4",
      }),
    });

    const input: EnhancePromptInput = {
      sourcePrompt: "A cat sitting on a mat",
      systemPrompt: "You are a prompt engineer.",
      options: {},
    };

    const result = await adapter.enhancePrompt(input);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        }),
      }),
    );
    expect(result.prompt).toBe("This is an enhanced prompt.");
  });

  it("returns enhanced prompt with metadata", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ message: { content: "Enhanced prompt text" } }],
        model: "gpt-4",
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const result = await adapter.enhancePrompt({
      sourcePrompt: "Test prompt",
      systemPrompt: "System prompt",
      options: {},
    });

    expect(result.prompt).toBe("Enhanced prompt text");
    expect(result.metadata).toHaveProperty("model", "gpt-4");
    expect(result.metadata).toHaveProperty("usage");
  });

  it("captures provider request id from response headers", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "req-provider-42" }),
      json: async () => ({
        choices: [{ message: { content: "Enhanced" } }],
        model: "gpt-4",
      }),
    });

    const result = await adapter.enhancePrompt({
      sourcePrompt: "Test",
      systemPrompt: "System",
      options: {},
    });
    expect(result.metadata).toHaveProperty("providerRequestId", "req-provider-42");
  });

  it("throws on 401 with non-retryable classification", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() });

    await expect(
      adapter.enhancePrompt({ sourcePrompt: "Test", systemPrompt: "System", options: {} }),
    ).rejects.toMatchObject({
      code: "provider_authentication_failed",
      retryable: false,
      httpStatus: 401,
    });
  });

  it("classifies 429 as retryable rate limit", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() });

    await expect(
      adapter.enhancePrompt({ sourcePrompt: "Test", systemPrompt: "System", options: {} }),
    ).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
      httpStatus: 429,
    });
  });

  it("throws on malformed response", async () => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
    });

    await expect(
      adapter.enhancePrompt({ sourcePrompt: "Test", systemPrompt: "System", options: {} }),
    ).rejects.toMatchObject({ code: "provider_response_invalid", retryable: false });
  });

  it("rejects non-https base urls", () => {
    expect(
      () =>
        new OpenAICompatibleReasoningAdapter(
          { baseUrl: "http://insecure.example.com", model: "gpt-4" },
          "key",
        ),
    ).toThrow(ProviderError);
  });
});
