import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, answerCallbackQuery, redactTelegramError } from "@/server/telegram/client";

function fakeResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendMessage", () => {
  it("posts to the bot API and returns the message id", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(fakeResponse({ ok: true, result: { message_id: 99 } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessage("123:abc", 456n, "hello");
    expect(result.messageId).toBe(99);

    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe("456");
    expect(body.text).toBe("hello");
  });

  it("throws a redacted error when the API reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          fakeResponse({ ok: false, error_code: 429, description: "Too many requests" }),
        ),
      ),
    );

    await expect(sendMessage("123:abc", 456n, "hello")).rejects.toThrow("code 429");
  });

  it("never leaks the raw error description in the thrown message", async () => {
    const secretEcho = "description contains: xyz-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(fakeResponse({ ok: false, error_code: 400, description: secretEcho })),
      ),
    );

    try {
      await sendMessage("123:abc", 456n, "hello");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("xyz-secret-token");
      expect(String(error)).toContain("code 400");
    }
  });
});

describe("answerCallbackQuery", () => {
  it("posts to the bot API with the callback query id", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(fakeResponse({ ok: true, result: true })));
    vi.stubGlobal("fetch", fetchMock);

    await answerCallbackQuery("123:abc", "cb-1");
    const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/answerCallbackQuery");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.callback_query_id).toBe("cb-1");
  });

  it("throws a redacted error on API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(fakeResponse({ ok: false, error_code: 400, description: "Bad" })),
      ),
    );
    await expect(answerCallbackQuery("123:abc", "cb-1")).rejects.toThrow("code 400");
  });
});

describe("redactTelegramError", () => {
  it("returns only the numeric code", () => {
    expect(
      redactTelegramError({ ok: false, error_code: 403, description: "sensitive payload echo" }),
    ).toBe("code 403");
  });
});
