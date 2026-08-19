// Job-level retry/terminal handling for the enhancement processor (M4).
// Bridges the pure retry classification into durable job state: bounded retry
// with future available_at, or a terminal failed state. Worker ownership guards
// every update so a stale worker cannot mutate a re-claimed job.

import { JobRepository } from "@/server/repositories/job.repository";
import {
  classifyEnhancementError,
  ENHANCEMENT_MAX_ATTEMPTS,
  ENHANCEMENT_BASE_DELAY_MS,
  ENHANCEMENT_MAX_DELAY_MS,
} from "@/server/application/enhancement-retry";
import { computeBackoffDelayMs } from "./backoff";
import type { ProviderErrorShape } from "@/server/providers/errors";

export class EnhancementJobRetry {
  constructor(private readonly jobRepository: JobRepository) {}

  // Applies the retry decision to a claimed job. Returns true when the job was
  // rescheduled for another attempt, false when it went terminal.
  async apply(
    job: { id: string; attemptCount: number },
    workerId: string,
    error: ProviderErrorShape,
  ): Promise<boolean> {
    const decision = classifyEnhancementError(error, job.attemptCount);

    if (decision.shouldRetry) {
      // Full jitter on the retry delay so a burst of failures does not re-fire
      // in lockstep: delay in [0, min(base * 2^(attempt-1), max)].
      const delayMs = computeBackoffDelayMs(job.attemptCount, {
        baseMs: ENHANCEMENT_BASE_DELAY_MS,
        maxMs: ENHANCEMENT_MAX_DELAY_MS,
      });
      const availableAt = new Date(Date.now() + delayMs).toISOString();
      await this.jobRepository.markRetryScheduled(job.id, workerId, availableAt, decision.code);
      return true;
    }

    await this.jobRepository.markFailed(job.id, workerId, {
      errorCode: decision.code,
      errorMessageRedacted: decision.code,
    });
    return false;
  }

  // True when a claimed job still has retry headroom regardless of error class
  // (used for terminal failure paths like expired sessions).
  hasRemainingAttempts(job: { attemptCount: number }): boolean {
    return job.attemptCount < ENHANCEMENT_MAX_ATTEMPTS;
  }
}

export { ENHANCEMENT_MAX_ATTEMPTS };
