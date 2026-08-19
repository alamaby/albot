// enhance_prompt job handler (Milestone 4).
//
// Wraps the enhancement use case with durable job lifecycle: successful
// enhancement completes the job; provider failures are classified into bounded
// retry (future available_at) or terminal failure; expired sessions go terminal
// without any provider call.

import type { JobRow } from "@/server/jobs/processor";
import { EnhancePromptUseCase } from "@/server/application/enhance-prompt";
import { EnhancementRepository } from "@/server/repositories/enhancement.repository";
import { SessionRepository } from "@/server/repositories/session.repository";
import { JobRepository, type JobSafe } from "@/server/repositories/job.repository";
import { EnhancementJobRetry } from "./retry";
import { logStructured } from "@/server/observability/logger";
import type { ProviderErrorShape } from "@/server/providers/errors";

export type EnhancePromptHandlerDeps = {
  enhancePrompt?: EnhancePromptUseCase;
  enhancementRepository?: EnhancementRepository;
  sessionRepository?: SessionRepository;
  jobRepository?: JobRepository;
  retry?: EnhancementJobRetry;
};

export class EnhancePromptHandler {
  private readonly enhancePrompt: EnhancePromptUseCase;
  private readonly enhancementRepository: EnhancementRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly jobRepository: JobRepository;
  private readonly retry: EnhancementJobRetry;

  constructor(deps: EnhancePromptHandlerDeps = {}) {
    this.enhancePrompt = deps.enhancePrompt ?? new EnhancePromptUseCase();
    this.enhancementRepository = deps.enhancementRepository ?? new EnhancementRepository();
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.retry = deps.retry ?? new EnhancementJobRetry(this.jobRepository);
  }

  async handle(job: JobRow, workerId: string): Promise<void> {
    const revisionId = job.prompt_revision_id ?? "";

    // Normalize the claimed row into the use-case shape (camelCase JobSafe).
    const jobSafe: JobSafe = {
      id: job.id,
      jobType: job.job_type,
      promptSessionId: job.prompt_session_id,
      promptRevisionId: job.prompt_revision_id,
      generationAttemptId: job.generation_attempt_id,
      status: job.status,
      payload: (job.payload as Record<string, unknown> | null) ?? {},
      attemptCount: job.attempt_count,
      maxAttempts: job.max_attempts,
      availableAt: job.available_at,
      lockedBy: job.locked_by,
      lastErrorCode: job.last_error_code,
      lastErrorMessageRedacted: job.last_error_message_redacted,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at,
    };

    try {
      const outcome = await this.enhancePrompt.execute(jobSafe);

      if (outcome.status === "expired") {
        // Expired session: no provider call, terminal failure, no retry.
        await this.enhancementRepository.markRevisionFailed(
          revisionId,
          "session_expired",
          "session expired before enhancement",
        );
        await this.jobRepository.markFailed(job.id, workerId, {
          errorCode: "session_expired",
          errorMessageRedacted: "session expired before enhancement",
        });
        return;
      }

      await this.jobRepository.markSucceeded(job.id, workerId);
    } catch (error) {
      const providerError = normalizeToProviderError(error);

      // Record the failure on the revision (guard-patched: only touches a
      // revision still in processing).
      try {
        await this.enhancementRepository.markRevisionFailed(
          revisionId,
          providerError.code,
          providerError.safeMessage,
        );
      } catch (markError) {
        const detail = markError instanceof Error ? markError.message : "unknown";
        logStructured("error", "enhance.mark_revision_failed_error", { jobId: job.id, detail });
      }

      await this.retry.apply(
        { id: job.id, attemptCount: job.attempt_count },
        workerId,
        providerError,
      );
    }
  }
}

function normalizeToProviderError(error: unknown): ProviderErrorShape {
  // ProviderError already carries the normalized shape; anything else is a
  // defensive non-retryable fallback (job goes terminal, no hot loop).
  if (typeof error === "object" && error !== null && "code" in error && "retryable" in error) {
    return error as ProviderErrorShape;
  }
  return {
    code: "provider_unknown_error",
    retryable: false,
    safeMessage: "enhancement failed unexpectedly",
    cause: error,
  };
}

// Registered processor entry point (matches the JobHandler signature).
export const enhancePromptHandler = async (job: JobRow): Promise<void> => {
  const workerId = job.locked_by ?? "processor-unknown";
  await new EnhancePromptHandler().handle(job, workerId);
};
