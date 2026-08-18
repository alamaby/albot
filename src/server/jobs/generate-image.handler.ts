// generate_image job handler (Milestone 5).
//
// Wraps the generation use case with durable job lifecycle: successful
// generation completes the job; provider failures are classified into bounded
// retry (future available_at) or terminal failure. The use case owns the
// generation attempt lifecycle (creates, marks processing, marks failed on any
// error path), so the handler only transitions the session to generation_failed
// when a job goes terminal — giving the user a retry path.

import type { JobRow } from "@/server/jobs/processor";
import { GenerateImageUseCase } from "@/server/application/generate-image";
import { SessionRepository } from "@/server/repositories/session.repository";
import { JobRepository, type JobSafe } from "@/server/repositories/job.repository";
import { GenerationJobRetry } from "./generation-retry";
import type { ProviderErrorShape } from "@/server/providers/errors";

export type GenerateImageHandlerDeps = {
  generateImage?: GenerateImageUseCase;
  sessionRepository?: SessionRepository;
  jobRepository?: JobRepository;
  retry?: GenerationJobRetry;
};

export class GenerateImageHandler {
  private readonly generateImage: GenerateImageUseCase;
  private readonly sessionRepository: SessionRepository;
  private readonly jobRepository: JobRepository;
  private readonly retry: GenerationJobRetry;

  constructor(deps: GenerateImageHandlerDeps = {}) {
    this.generateImage = deps.generateImage ?? new GenerateImageUseCase();
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.retry = deps.retry ?? new GenerationJobRetry(this.jobRepository);
  }

  async handle(job: JobRow, workerId: string): Promise<void> {
    // The generate_image job carries the revision to generate from; the
    // generation attempt is created by the use case (job.generation_attempt_id
    // may be null on the first claim).
    const sessionId = job.prompt_session_id ?? "";

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
      const outcome = await this.generateImage.execute(jobSafe);

      if (outcome.status === "expired") {
        // Expired session: no provider call, no attempt was created, terminal.
        await this.jobRepository.markFailed(job.id, workerId, {
          errorCode: "session_expired",
          errorMessageRedacted: "session expired before generation",
        });
        return;
      }

      await this.jobRepository.markSucceeded(job.id, workerId);
    } catch (error) {
      const providerError = normalizeToProviderError(error);

      // Bounded retry or terminal failure. The use case already marked the
      // attempt failed (if one was created), so a retried claim can create a
      // fresh attempt.
      const retried = await this.retry.apply(
        { id: job.id, attemptCount: job.attempt_count },
        workerId,
        providerError,
      );

      if (!retried && sessionId) {
        // Terminal failure: give the user a retry path by moving the session
        // out of generating. Best-effort — the job state is the durable truth.
        try {
          await this.transitionSessionToFailed(sessionId);
        } catch (transitionError) {
          const detail = transitionError instanceof Error ? transitionError.message : "unknown";
          console.error(
            `generate-image: session transition to generation_failed failed (${detail})`,
          );
        }
      }
    }
  }

  // CAS from generating -> generation_failed (guard: only from generating, so a
  // stale worker cannot clobber a session another worker already moved on).
  private async transitionSessionToFailed(sessionId: string): Promise<void> {
    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: sessionId,
        p_expected_status: "generating",
        p_new_status: "generation_failed",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      // The session moved on (e.g. another worker already completed it). This
      // is fine; nothing to do.
      return;
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
    safeMessage: "image generation failed unexpectedly",
    cause: error,
  };
}

// Registered processor entry point (matches the JobHandler signature).
export const generateImageHandler = async (job: JobRow): Promise<void> => {
  const workerId = job.locked_by ?? "processor-unknown";
  await new GenerateImageHandler().handle(job, workerId);
};
