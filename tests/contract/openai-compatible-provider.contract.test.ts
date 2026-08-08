import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleReasoningAdapter } from "@/server/providers/reasoning/openai-compatible.adapter";
import type { EnhancePromptInput } from "@/server/domain/provider";
import { ProviderError } from "@/server/providers/errors";

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OpenAICompatibleReasoningAdapter", () => {
  const adapter = new OpenAICompatibleReasoningAdapter(
    { baseUrl: "https://api.openai.com", model: "gpt-4" },
    "test-api-key",
  );

  it("sends correct request body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
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

  it("throws on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(
      adapter.enhancePrompt({ sourcePrompt: "Test", systemPrompt: "System", options: {} }),
    ).rejects.toThrow(ProviderError);
  });

  it("throws on malformed response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await expect(
      adapter.enhancePrompt({ sourcePrompt: "Test", systemPrompt: "System", options: {} }),
    ).rejects.toThrow();
  });
});
