import { describe, expect, it } from "vitest";
import { redactSensitive, redactError } from "@/server/observability/redact";
import { ProviderError } from "@/server/providers/errors";

describe("redactSensitive", () => {
  it("redacts a Telegram bot token", () => {
    const input = "token 123456789:AAExampleBotToken0123456789_abcdef used";
    const out = redactSensitive(input);
    expect(out).not.toContain("AAExampleBotToken");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a Bearer token", () => {
    const input = "Authorization: Bearer abc.def.ghi-jkl0123456789";
    const out = redactSensitive(input);
    expect(out).not.toContain("abc.def.ghi");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts an OpenAI-style sk- key", () => {
    const input = "key=sk-proj-0123456789abcdef0123456789abcdef";
    const out = redactSensitive(input);
    expect(out).not.toContain("sk-proj");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a JWT-shaped service role key", () => {
    const input =
      "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactSensitive(input);
    expect(out).not.toContain("eyJhbGci");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts x-api-key header values", () => {
    const input = 'x-api-key: "live_secret_0123456789abcdef"';
    const out = redactSensitive(input);
    expect(out).not.toContain("live_secret");
  });

  it("keeps plain text untouched", () => {
    expect(redactSensitive("hello world, nothing sensitive here")).toBe(
      "hello world, nothing sensitive here",
    );
  });
});

describe("redactError", () => {
  it("prefers safeMessage from a ProviderError", () => {
    const error = new ProviderError({
      code: "provider_upstream_failed",
      retryable: true,
      message: "raw upstream detail with token 123456789:AAExampleBotToken0123456789_abcdef",
      cause: { secret: "should never surface" },
    });
    const { message } = redactError(error);
    expect(message).not.toContain("AAExampleBotToken");
    expect(message).toContain("[REDACTED]");
  });

  it("falls back to message for generic errors", () => {
    const error = new Error("boom happened");
    expect(redactError(error)).toEqual({ message: "boom happened" });
  });

  it("returns a generic message for non-error values", () => {
    expect(redactError(null)).toEqual({ message: "unknown error" });
    expect(redactError("just a string")).toEqual({ message: "unknown error" });
  });
});
