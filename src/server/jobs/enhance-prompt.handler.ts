// enhance_prompt job handler (Milestone 4).
//
// Wraps the enhancement use case with durable job lifecycle: successful
// enhancement completes the job; provider failures are classified into bounded
// retry (future available_at) or terminal failure; expired sessions go terminal
// without any provider call. On a terminal failure the handler transitions the
// session to enhancement_failed and sends a retry message with a "Coba Lagi"
// keyboard — giving the user a retry path (mirrors the generate handler's
// generation_failed transition).

import type { JobRow } from "@/server/jobs/processor";
import { EnhancePromptUseCase } from "@/server/application/enhance-prompt";
import { EnhancementRepository } from "@/server/repositories/enhancement.repository";
import { SessionRepository, type SessionSafe } from "@/server/repositories/session.repository";
import { JobRepository, type JobSafe } from "@/server/repositories/job.repository";
import { EnhancementJobRetry } from "./retry";
import { logStructured } from "@/server/observability/logger";
import type { ProviderErrorShape } from "@/server/providers/errors";
import { buildBotMessage } from "@/server/telegram/messages";

export type EnhancePromptHandlerDeps = {
  enhancePrompt?: EnhancePromptUseCase;
  enhancementRepository?: EnhancementRepository;
  sessionRepository?: SessionRepository;
  jobRepository?: JobRepository;
  retry?: EnhancementJobRetry;
  // Sends a retry message with the "Coba Lagi" keyboard after a terminal
  // enhancement failure. When contentPolicy is true, adds a "Prompt Baru"
  // button and a content-policy message (retrying the same input cannot
  // resolve a refusal). Best-effort; injected for tests.
  sendRetryMessage?: (input: { session: SessionSafe; contentPolicy?: boolean }) => Promise<void>;
};

export class EnhancePromptHandler {
  private readonly enhancePrompt: EnhancePromptUseCase;
  private readonly enhancementRepository: EnhancementRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly jobRepository: JobRepository;
  private readonly retry: EnhancementJobRetry;
  private readonly sendRetryMessage: (input: {
    session: SessionSafe;
    contentPolicy?: boolean;
  }) => Promise<void>;

  constructor(deps: EnhancePromptHandlerDeps = {}) {
    this.enhancePrompt = deps.enhancePrompt ?? new EnhancePromptUseCase();
    this.enhancementRepository = deps.enhancementRepository ?? new EnhancementRepository();
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.retry = deps.retry ?? new EnhancementJobRetry(this.jobRepository);
    this.sendRetryMessage =
      deps.sendRetryMessage ??
      (async (input) => {
        const env = (await import("@/env")).getServerEnv();
        const { sendMessageWithKeyboard } = await import("@/server/telegram/client");
        const { retryKeyboard } = await import("@/server/telegram/keyboards");
        await sendMessageWithKeyboard(
          env.TELEGRAM_BOT_TOKEN,
          input.session.telegramChatId,
          buildBotMessage(input.contentPolicy ? "content_policy_declined" : "enhancement_failed"),
          retryKeyboard(input.session.id, { showNewPrompt: input.contentPolicy }),
        );
      });
  }

  async handle(job: JobRow, workerId: string): Promise<void> {
    const revisionId = job.prompt_revision_id ?? "";
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

      const retried = await this.retry.apply(
        { id: job.id, attemptCount: job.attempt_count },
        workerId,
        providerError,
      );

      if (!retried && sessionId) {
        // Terminal failure: give the user a retry path by moving the session
        // out of enhancing. Best-effort — the job state is the durable truth.
        try {
          await this.transitionSessionToFailed(sessionId);
        } catch (transitionError) {
          const detail = transitionError instanceof Error ? transitionError.message : "unknown";
          logStructured("error", "enhance.session_transition_failed", {
            sessionId,
            detail,
          });
        }
        // Tell the user the outcome with a retry keyboard. Best-effort.
        // A content-policy refusal is terminal for the same input, so surface
        // a "Prompt Baru" button instead of a pointless retry.
        await this.sendRetryTo(sessionId, providerError.code === "provider_content_rejected");
      }
    }
  }

  // CAS from enhancing -> enhancement_failed (guard: only from enhancing, so a
  // stale worker cannot clobber a session another worker already moved on).
  private async transitionSessionToFailed(sessionId: string): Promise<void> {
    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: sessionId,
        p_expected_status: "enhancing",
        p_new_status: "enhancement_failed",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      // The session moved on (e.g. another worker already completed it). This
      // is fine; nothing to do.
      return;
    }
  }

  // Best-effort retry message. Loads the session fresh so it can never act on
  // stale ids.
  private async sendRetryTo(sessionId: string, contentPolicy = false): Promise<void> {
    try {
      const session = await this.sessionRepository.getById(sessionId);
      if (!session) return;
      await this.sendRetryMessage({ session, contentPolicy });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "enhance.retry_message_failed", { sessionId, detail });
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
