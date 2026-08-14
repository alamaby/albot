// Enhancement retry classification and bounded backoff (Milestone 4).
//
// Pure logic, no I/O: converts a normalized ProviderError into a retry
// decision. Full recovery (jitter, dead-job state, cooldown monitoring) is
// Milestone 6; this module keeps M4 bounded and deterministic.

import type { ProviderErrorShape } from "@/server/providers/errors";

// Total attempts (initial claim + retries) before the job goes terminal.
export const ENHANCEMENT_MAX_ATTEMPTS = 4;

export const ENHANCEMENT_BASE_DELAY_MS = 60_000;
export const ENHANCEMENT_MAX_DELAY_MS = 8 * 60_000;

export type EnhancementRetryDecision = {
  shouldRetry: boolean;
  retryable: boolean;
  code: string;
  delayMs: number;
};

// Exponential backoff: base * 2^(attempt-1), capped. `attemptCount` is the
// job's attempt_count after the current (failed) claim, i.e. >= 1.
export function computeBackoffDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = ENHANCEMENT_BASE_DELAY_MS * 2 ** exponent;
  return Math.min(raw, ENHANCEMENT_MAX_DELAY_MS);
}

export function classifyEnhancementError(
  error: ProviderErrorShape,
  attemptCount: number,
): EnhancementRetryDecision {
  const code = error.code;
  const canRetry =
    error.retryable &&
    attemptCount < ENHANCEMENT_MAX_ATTEMPTS &&
    code !== "provider_response_invalid";

  if (!canRetry) {
    return { shouldRetry: false, retryable: error.retryable, code, delayMs: 0 };
  }

  return {
    shouldRetry: true,
    retryable: true,
    code,
    delayMs: computeBackoffDelayMs(attemptCount),
  };
}
