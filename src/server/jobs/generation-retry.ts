// Job-level retry/terminal handling for the generation processor (M5).
// Mirrors the M4 EnhancementJobRetry but with image-specific classification:
// auth/content/response-invalid errors are never retried (failover must not
// mask a malformed request or policy rejection), while 408/429/5xx/network
// follow bounded exponential backoff.

import { JobRepository } from "@/server/repositories/job.repository";
import type { ProviderErrorShape } from "@/server/providers/errors";

// Total attempts (initial claim + retries) before the job goes terminal.
export const GENERATION_MAX_ATTEMPTS = 4;
export const GENERATION_BASE_DELAY_MS = 60_000;
export const GENERATION_MAX_DELAY_MS = 8 * 60_000;

export type GenerationRetryDecision = {
  shouldRetry: boolean;
  retryable: boolean;
  code: string;
  delayMs: number;
};

// Exponential backoff: base * 2^(attempt-1), capped.
export function computeGenerationBackoffDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = GENERATION_BASE_DELAY_MS * 2 ** exponent;
  return Math.min(raw, GENERATION_MAX_DELAY_MS);
}

// Errors that must go terminal regardless of retry headroom: malformed request,
// auth/authorization, content policy, and invalid provider output. Everything
// else retryable is retried while attempts remain.
const NON_RETRYABLE_CODES = new Set([
  "provider_request_invalid",
  "provider_authentication_failed",
  "provider_authorization_failed",
  "provider_content_rejected",
  "provider_response_invalid",
]);

export function classifyGenerationError(
  error: ProviderErrorShape,
  attemptCount: number,
): GenerationRetryDecision {
  const code = error.code;
  const canRetry =
    error.retryable && attemptCount < GENERATION_MAX_ATTEMPTS && !NON_RETRYABLE_CODES.has(code);

  if (!canRetry) {
    return { shouldRetry: false, retryable: error.retryable, code, delayMs: 0 };
  }

  return {
    shouldRetry: true,
    retryable: true,
    code,
    delayMs: computeGenerationBackoffDelayMs(attemptCount),
  };
}

export class GenerationJobRetry {
  constructor(private readonly jobRepository: JobRepository) {}

  // Applies the retry decision to a claimed job. Returns true when the job was
  // rescheduled for another attempt, false when it went terminal.
  async apply(
    job: { id: string; attemptCount: number },
    workerId: string,
    error: ProviderErrorShape,
  ): Promise<boolean> {
    const decision = classifyGenerationError(error, job.attemptCount);

    if (decision.shouldRetry) {
      const availableAt = new Date(Date.now() + decision.delayMs).toISOString();
      await this.jobRepository.markRetryScheduled(job.id, workerId, availableAt, decision.code);
      return true;
    }

    await this.jobRepository.markFailed(job.id, workerId, {
      errorCode: decision.code,
      errorMessageRedacted: decision.code,
    });
    return false;
  }
}
