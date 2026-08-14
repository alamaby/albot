// Job-level retry/terminal handling for the enhancement processor (M4).
// Bridges the pure retry classification into durable job state: bounded retry
// with future available_at, or a terminal failed state. Worker ownership guards
// every update so a stale worker cannot mutate a re-claimed job.

import { JobRepository } from "@/server/repositories/job.repository";
import {
  classifyEnhancementError,
  computeBackoffDelayMs,
  ENHANCEMENT_MAX_ATTEMPTS,
} from "@/server/application/enhancement-retry";
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

  // True when a claimed job still has retry headroom regardless of error class
  // (used for terminal failure paths like expired sessions).
  hasRemainingAttempts(job: { attemptCount: number }): boolean {
    return job.attemptCount < ENHANCEMENT_MAX_ATTEMPTS;
  }
}

export { computeBackoffDelayMs, ENHANCEMENT_MAX_ATTEMPTS };
