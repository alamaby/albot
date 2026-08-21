import { describe, expect, it, vi, afterEach } from "vitest";
import { PixazoPixelforgeAdapter } from "@/server/providers/image/pixazo-pixelforge.adapter";
import { ProviderError } from "@/server/providers/errors";

const KEY = "test-key";
const BASE = "https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image";

describe("PixazoPixelforgeAdapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds body with text/type/seed/size and ignores negativePrompt/aspectRatio", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            results: [{ url: "https://images.example.com/a.png", caption: "hi" }],
          }),
        } as unknown as Response;
      }),
    );
    const adapter = new PixazoPixelforgeAdapter(
      { baseUrl: BASE, model: "pixelforge-image-v2" },
      KEY,
    );
    // intercept build via fetch arg
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    await adapter.generateImage({
      prompt: "red dress",
      negativePrompt: "should be ignored",
      aspectRatio: "16:9",
      parameters: { seed: 42 },
    });
    capturedBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(capturedBody).toEqual({
      text: "red dress",
      type: "tags,caption",
      seed: 42,
      size: 1,
    });

    // custom type/size via config
    vi.restoreAllMocks();
    const adapter2 = new PixazoPixelforgeAdapter(
      { baseUrl: BASE, model: "m", type: "tags", size: 5 },
      KEY,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        json: async () => ({ results: [{ url: "https://images.example.com/b.png" }] }),
      })) as unknown as typeof fetch,
    );
    await adapter2.generateImage({ prompt: "p", parameters: {} });
    const body2 = JSON.parse(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body2.type).toBe("tags");
    expect(body2.size).toBe(5);
  });

  it("parses results[0].url https and caption to metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "req-123" },
        json: async () => ({
          results: [{ url: "https://images.example.com/a.png", caption: "A caption" }],
          request_id: "body-req",
        }),
      })) as unknown as typeof fetch,
    );
    const adapter = new PixazoPixelforgeAdapter(
      { baseUrl: BASE, model: "pixelforge-image-v2" },
      KEY,
    );
    const res = await adapter.generateImage({ prompt: "p", parameters: {} });
    expect(res.status).toBe("completed");
    if (res.status === "completed") {
      expect(res.imageUrl).toBe("https://images.example.com/a.png");
      expect(res.metadata.caption).toBe("A caption");
      expect(res.providerRequestId).toBe("body-req");
    }
  });

  it("rejects empty results or non-https url as provider_response_invalid", async () => {
    const adapter = new PixazoPixelforgeAdapter({ baseUrl: BASE, model: "m" }, KEY);
    for (const json of [
      { results: [] },
      { results: [{ url: "http://insecure.com/a.png" }] },
      {},
      { results: [{ caption: "no url" }] },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          headers: { get: () => null },
          json: async () => json,
        })) as unknown as typeof fetch,
      );
      await expect(adapter.generateImage({ prompt: "p", parameters: {} })).rejects.toThrow(
        ProviderError,
      );
      await expect(adapter.generateImage({ prompt: "p", parameters: {} })).rejects.toMatchObject({
        code: "provider_response_invalid",
        retryable: false,
      });
    }
  });

  it("maps http errors via makeErrorFromHttpStatus (retryable for 429)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: () => null },
      })) as unknown as typeof fetch,
    );
    const adapter = new PixazoPixelforgeAdapter({ baseUrl: BASE, model: "m" }, KEY);
    await expect(adapter.generateImage({ prompt: "p", parameters: {} })).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
    });
  });

  it("validates config https and type/size allowlist", () => {
    expect(() => new PixazoPixelforgeAdapter({ baseUrl: "http://bad", model: "m" }, KEY)).toThrow(
      ProviderError,
    );
    expect(
      () => new PixazoPixelforgeAdapter({ baseUrl: BASE, model: "m", type: "invalid" }, KEY),
    ).toThrow(expect.objectContaining({ code: "provider_configuration_invalid" }));
    expect(() => new PixazoPixelforgeAdapter({ baseUrl: BASE, model: "m", size: 0 }, KEY)).toThrow(
      expect.objectContaining({ code: "provider_configuration_invalid" }),
    );
  });
});
