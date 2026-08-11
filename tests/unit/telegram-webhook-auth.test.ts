import { describe, expect, it } from "vitest";
import { safeEqual } from "@/server/telegram/webhook-auth";
import { verifyProcessorSecret } from "@/server/jobs/auth";

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("secret-value", "secret-value")).toBe(true);
  });

  it("returns false for a missing header", () => {
    expect(safeEqual(null, "secret-value")).toBe(false);
    expect(safeEqual(undefined, "secret-value")).toBe(false);
  });

  it("returns false for an empty header", () => {
    expect(safeEqual("", "secret-value")).toBe(false);
  });

  it("returns false for a different-length secret", () => {
    expect(safeEqual("short", "a-much-longer-secret-value")).toBe(false);
  });

  it("returns false for an equal-length but different secret", () => {
    expect(safeEqual("abc12345", "abc12346")).toBe(false);
  });
});

describe("verifyProcessorSecret", () => {
  it("accepts a valid bearer token", () => {
    expect(verifyProcessorSecret("Bearer top-secret-value", "top-secret-value")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyProcessorSecret(null, "top-secret-value")).toBe(false);
    expect(verifyProcessorSecret(undefined, "top-secret-value")).toBe(false);
  });

  it("rejects a non-bearer scheme", () => {
    expect(verifyProcessorSecret("Basic dG9wLXNlY3JldC12YWx1ZQ==", "top-secret-value")).toBe(false);
  });

  it("rejects a wrong token", () => {
    expect(verifyProcessorSecret("Bearer wrong-value", "top-secret-value")).toBe(false);
  });

  it("rejects an empty bearer token", () => {
    expect(verifyProcessorSecret("Bearer ", "top-secret-value")).toBe(false);
  });
});
