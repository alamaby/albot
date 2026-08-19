import { describe, expect, it } from "vitest";
import {
  classifyGenerationError,
  computeGenerationBackoffCapMs,
  GENERATION_MAX_ATTEMPTS,
  GENERATION_BASE_DELAY_MS,
  GENERATION_MAX_DELAY_MS,
} from "@/server/jobs/generation-retry";
import { makeRetryable, makeNonRetryable } from "@/server/providers/errors";

describe("computeGenerationBackoffCapMs", () => {
  it("doubles the base delay per attempt and caps at the maximum", () => {
    expect(computeGenerationBackoffCapMs(1)).toBe(GENERATION_BASE_DELAY_MS);
    expect(computeGenerationBackoffCapMs(2)).toBe(GENERATION_BASE_DELAY_MS * 2);
    expect(computeGenerationBackoffCapMs(3)).toBe(GENERATION_BASE_DELAY_MS * 4);
    expect(computeGenerationBackoffCapMs(10)).toBe(GENERATION_MAX_DELAY_MS);
  });
});

describe("classifyGenerationError", () => {
  it("retries retryable errors while attempts remain", () => {
    const decision = classifyGenerationError(makeRetryable("provider_rate_limited", "429"), 1);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBe(GENERATION_BASE_DELAY_MS);
  });

  it("retries network and timeout errors", () => {
    expect(
      classifyGenerationError(makeRetryable("provider_network_failed", "net"), 1).shouldRetry,
    ).toBe(true);
    expect(
      classifyGenerationError(makeRetryable("provider_timeout", "timeout"), 1).shouldRetry,
    ).toBe(true);
  });

  it("never retries auth/authorization errors", () => {
    expect(
      classifyGenerationError(makeNonRetryable("provider_authentication_failed", "401"), 1)
        .shouldRetry,
    ).toBe(false);
    expect(
      classifyGenerationError(makeNonRetryable("provider_authorization_failed", "403"), 1)
        .shouldRetry,
    ).toBe(false);
  });

  it("never retries request-invalid / content-rejected / response-invalid", () => {
    expect(
      classifyGenerationError(makeNonRetryable("provider_request_invalid", "400"), 1).shouldRetry,
    ).toBe(false);
    expect(
      classifyGenerationError(makeNonRetryable("provider_content_rejected", "policy"), 1)
        .shouldRetry,
    ).toBe(false);
    expect(
      classifyGenerationError(makeNonRetryable("provider_response_invalid", "bad output"), 1)
        .shouldRetry,
    ).toBe(false);
  });

  it("never retries once attempts are exhausted even for retryable errors", () => {
    const decision = classifyGenerationError(
      makeRetryable("provider_rate_limited", "429"),
      GENERATION_MAX_ATTEMPTS,
    );
    expect(decision.shouldRetry).toBe(false);
  });

  it("goes terminal for delivery failures", () => {
    const decision = classifyGenerationError(
      makeNonRetryable("telegram_delivery_failed", "delivery"),
      1,
    );
    expect(decision.shouldRetry).toBe(false);
  });
});
