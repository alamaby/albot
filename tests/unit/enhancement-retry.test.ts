import { describe, expect, it } from "vitest";
import {
  classifyEnhancementError,
  computeBackoffDelayMs,
  ENHANCEMENT_MAX_ATTEMPTS,
  ENHANCEMENT_BASE_DELAY_MS,
  ENHANCEMENT_MAX_DELAY_MS,
} from "@/server/application/enhancement-retry";
import {
  makeRetryable,
  makeNonRetryable,
  makeErrorFromHttpStatus,
} from "@/server/providers/errors";

describe("computeBackoffDelayMs", () => {
  it("grows exponentially from the base and caps at the max", () => {
    expect(computeBackoffDelayMs(1)).toBe(ENHANCEMENT_BASE_DELAY_MS);
    expect(computeBackoffDelayMs(2)).toBe(ENHANCEMENT_BASE_DELAY_MS * 2);
    expect(computeBackoffDelayMs(3)).toBe(ENHANCEMENT_BASE_DELAY_MS * 4);
    expect(computeBackoffDelayMs(10)).toBe(ENHANCEMENT_MAX_DELAY_MS);
  });
});

describe("classifyEnhancementError", () => {
  it("retries retryable errors while attempts remain", () => {
    const error = makeRetryable("provider_timeout", "timeout");
    const decision = classifyEnhancementError(error, 1);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBe(ENHANCEMENT_BASE_DELAY_MS);
  });

  it("does not retry after max attempts", () => {
    const error = makeRetryable("provider_timeout", "timeout");
    const decision = classifyEnhancementError(error, ENHANCEMENT_MAX_ATTEMPTS);
    expect(decision.shouldRetry).toBe(false);
  });

  it("treats 401 as terminal (non-retryable)", () => {
    const error = makeErrorFromHttpStatus(401, "unauthorized");
    const decision = classifyEnhancementError(error, 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.code).toBe("provider_authentication_failed");
  });

  it("treats 429 as retryable rate limit", () => {
    const error = makeErrorFromHttpStatus(429, "rate limited");
    const decision = classifyEnhancementError(error, 1);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.code).toBe("provider_rate_limited");
  });

  it("treats 500 as retryable upstream failure", () => {
    const error = makeErrorFromHttpStatus(500, "upstream");
    const decision = classifyEnhancementError(error, 1);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.code).toBe("provider_upstream_failed");
  });

  it("treats provider_response_invalid as terminal even when flagged retryable", () => {
    // Structured output validation failures are never retried (the model output
    // is malformed, retrying the same input is unlikely to help).
    const error = makeNonRetryable("provider_response_invalid", "bad output");
    const decision = classifyEnhancementError(error, 1);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.code).toBe("provider_response_invalid");
  });

  it("maps 408/502/503/504 to retryable", () => {
    for (const status of [408, 502, 503, 504]) {
      const error = makeErrorFromHttpStatus(status, `status ${status}`);
      expect(classifyEnhancementError(error, 1).shouldRetry).toBe(true);
    }
  });
});
