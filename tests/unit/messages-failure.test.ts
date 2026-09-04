import { describe, expect, it } from "vitest";
import {
  buildBotMessage,
  buildGenerationStatusMessage,
  failureContextFromError,
  formatFailureDetail,
} from "@/server/telegram/messages";
import { makeErrorFromHttpStatus, withProviderContext } from "@/server/providers/errors";

describe("formatFailureDetail", () => {
  it("returns null without context", () => {
    expect(formatFailureDetail(null)).toBeNull();
    expect(formatFailureDetail(undefined)).toBeNull();
    expect(formatFailureDetail({})).toBeNull();
  });

  it("renders provider, code, status, and safeMessage", () => {
    expect(
      formatFailureDetail({
        providerLabel: "Bynara Agnes 2.5 Flash",
        model: "agnes-2.5-flash",
        errorCode: "provider_request_invalid",
        httpStatus: 400,
        safeMessage: "openai-compatible provider returned 400",
      }),
    ).toBe(
      "Bynara Agnes 2.5 Flash · agnes-2.5-flash\nprovider_request_invalid HTTP 400 — openai-compatible provider returned 400",
    );
  });

  it("collapses a label that already contains the model", () => {
    expect(
      formatFailureDetail({ providerLabel: "Bynara laguna-s-2.1", model: "laguna-s-2.1" }),
    ).toBe("Bynara laguna-s-2.1");
  });

  it("renders code-only context", () => {
    expect(formatFailureDetail({ errorCode: "provider_timeout" })).toBe("provider_timeout");
  });

  it("redacts secrets embedded in the safeMessage", () => {
    // Split literal: the value is fake, but keeps gitleaks from flagging the
    // test fixture itself as a leaked key.
    const fakeKey = "sk-" + "abcdef1234567890abcdef";
    const detail = formatFailureDetail({
      errorCode: "provider_upstream_failed",
      safeMessage: `upstream denied ${fakeKey} revoked`,
    });
    expect(detail).toContain("[REDACTED]");
    expect(detail).not.toContain("abcdef1234567890abcdef");
  });

  it("truncates long safeMessages", () => {
    const detail = formatFailureDetail({
      errorCode: "provider_upstream_failed",
      safeMessage: "x".repeat(500),
    });
    expect(detail!.length).toBeLessThan("provider_upstream_failed — ".length + 201);
  });
});

describe("failure messages with provider context", () => {
  it("enhancement_failed stays generic without context", () => {
    expect(buildBotMessage("enhancement_failed")).toBe(
      "Gagal memproses prompt. Silakan coba lagi.",
    );
  });

  it("enhancement_failed names the provider and error with context", () => {
    const text = buildBotMessage("enhancement_failed", {
      failure: {
        providerLabel: "Bynara Agnes 2.5 Flash",
        model: "agnes-2.5-flash",
        errorCode: "provider_request_invalid",
        httpStatus: 400,
        safeMessage: "openai-compatible provider returned 400",
      },
    });
    expect(text.startsWith("Gagal memproses prompt. Silakan coba lagi.\n")).toBe(true);
    expect(text).toContain("Bynara Agnes 2.5 Flash · agnes-2.5-flash");
    expect(text).toContain("provider_request_invalid HTTP 400");
  });

  it("enhance_only_failed carries the same detail shape", () => {
    const text = buildBotMessage("enhance_only_failed", {
      failure: { errorCode: "provider_rate_limited", httpStatus: 429 },
    });
    expect(text).toContain("Gagal menyempurnakan prompt");
    expect(text).toContain("provider_rate_limited HTTP 429");
  });

  it("generation status failed carries provider detail", () => {
    const text = buildGenerationStatusMessage("failed", {
      failure: {
        providerLabel: "Aichixia Flux 2 Dev",
        errorCode: "provider_timeout",
        safeMessage: "aichixia request timed out",
      },
    });
    expect(text).toContain("Gagal membuat gambar");
    expect(text).toContain("Aichixia Flux 2 Dev");
    expect(text).toContain("provider_timeout");
  });

  it("failureContextFromError maps an attributed error", () => {
    const error = withProviderContext(makeErrorFromHttpStatus(400, "bad request"), {
      label: "Bynara Qwen 3.8 27B",
      model: "qwen3.8-27b",
    });
    expect(failureContextFromError(error)).toEqual({
      providerLabel: "Bynara Qwen 3.8 27B",
      model: "qwen3.8-27b",
      errorCode: "provider_request_invalid",
      httpStatus: 400,
      safeMessage: "bad request",
    });
  });
});
