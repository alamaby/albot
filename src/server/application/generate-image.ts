// Image generation use case (Milestone 5).
//
// Runs the generate_image job: selects an image provider + key from the DB,
// records a provider_requests audit row, invokes the adapter (sync-only; a
// pending result is rejected as non-retryable), sends the resulting image to
// Telegram via sendPhoto-by-URL, and only after the delivery outcome is known
// marks the attempt succeeded and transitions the session to result_ready.
// The job-level retry/terminal decision is made by the caller
// (generate-image.handler) based on thrown ProviderError.

import { getServerEnv } from "@/env";
// Side-effect import: registers the built-in reasoning/image adapters on the
// provider registry (see providers/index.ts).
import "@/server/providers/index";
import { getProviderRegistry } from "@/server/providers/registry";
import { ProviderSelector, type SelectedProvider } from "@/server/providers/selector";
import { ProviderError } from "@/server/providers/errors";
import { isHttpsUrl } from "@/server/providers/http";
import { logStructured } from "@/server/observability/logger";
import { ProviderConfigRepository } from "@/server/repositories/provider-config.repository";
import { ProviderKeyRepository } from "@/server/repositories/provider-key.repository";
import { ProviderKeyVaultRepository } from "@/server/repositories/provider-key-vault.repository";
import { parseEncryptionKey } from "@/server/security/encryption";
import {
  GenerationRepository,
  type GenerationAttemptSafe,
} from "@/server/repositories/generation.repository";
import {
  EnhancementRepository,
  type RevisionSafe,
} from "@/server/repositories/enhancement.repository";
import { SessionRepository, type SessionSafe } from "@/server/repositories/session.repository";
import type { JobSafe } from "@/server/repositories/job.repository";
import { isSessionExpired } from "./session-expiry-check";
import { buildGenerationStatusMessage } from "@/server/telegram/messages";

export type GenerateImageOutcome =
  | { status: "completed"; session: SessionSafe; attempt: GenerationAttemptSafe }
  | { status: "expired" };

export type GenerateImageDeps = {
  providerConfigRepository?: ProviderConfigRepository;
  providerKeyRepository?: ProviderKeyRepository;
  providerKeyVaultRepository?: ProviderKeyVaultRepository;
  generationRepository?: GenerationRepository;
  enhancementRepository?: EnhancementRepository;
  sessionRepository?: SessionRepository;
  selector?: ProviderSelector;
  now?: () => Date;
  // Attaches the created attempt to the durable job row so a retried claim can
  // find and mark it failed. Injected for tests; production default persists
  // via JobRepository.
  attachGenerationAttempt?: (jobId: string, attemptId: string) => Promise<void>;
  // Photo delivery with the result action keyboard. The attempt is only marked
  // succeeded after this resolves; a delivery failure is terminal for the
  // attempt. Injected so tests can stub it; production default sends via
  // Telegram sendPhoto-by-URL.
  sendPhoto?: (input: {
    session: SessionSafe;
    revision: RevisionSafe;
    attempt: GenerationAttemptSafe;
    imageUrl: string;
  }) => Promise<{ messageId: number }>;
  // Edits the persisted "Sedang membuat gambar..." message to the final
  // outcome. Best-effort: a failure must not fail generation. Injected for
  // tests; production default edits via Telegram editMessageText.
  editStatusMessage?: (input: { session: SessionSafe; text: string }) => Promise<void>;
};

function parseEncryptionKeyFromEnv(): Buffer {
  const { PROVIDER_KEY_ENCRYPTION_KEY } = getServerEnv();
  return parseEncryptionKey(PROVIDER_KEY_ENCRYPTION_KEY);
}

export class GenerateImageUseCase {
  private readonly providerConfigRepository: ProviderConfigRepository;
  private readonly providerKeyRepository: ProviderKeyRepository;
  private readonly providerKeyVaultRepository: ProviderKeyVaultRepository;
  private readonly generationRepository: GenerationRepository;
  private readonly enhancementRepository: EnhancementRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly selector: ProviderSelector;
  private readonly now: () => Date;
  private readonly attachGenerationAttempt: (jobId: string, attemptId: string) => Promise<void>;
  private readonly sendPhoto: (input: {
    session: SessionSafe;
    revision: RevisionSafe;
    attempt: GenerationAttemptSafe;
    imageUrl: string;
  }) => Promise<{ messageId: number }>;
  private readonly editStatusMessage: (input: {
    session: SessionSafe;
    text: string;
  }) => Promise<void>;

  constructor(deps: GenerateImageDeps = {}) {
    this.providerConfigRepository = deps.providerConfigRepository ?? new ProviderConfigRepository();
    this.providerKeyRepository =
      deps.providerKeyRepository ?? new ProviderKeyRepository(parseEncryptionKeyFromEnv());
    this.providerKeyVaultRepository =
      deps.providerKeyVaultRepository ??
      new ProviderKeyVaultRepository(parseEncryptionKeyFromEnv());
    this.generationRepository = deps.generationRepository ?? new GenerationRepository();
    this.enhancementRepository = deps.enhancementRepository ?? new EnhancementRepository();
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.selector = deps.selector ?? new ProviderSelector();
    this.now = deps.now ?? (() => new Date());
    this.attachGenerationAttempt =
      deps.attachGenerationAttempt ??
      (async (jobId, attemptId) => {
        const { JobRepository } = await import("@/server/repositories/job.repository");
        await new JobRepository().attachGenerationAttempt(jobId, attemptId);
      });
    this.sendPhoto = deps.sendPhoto ?? this.defaultSendPhoto;
    this.editStatusMessage = deps.editStatusMessage ?? this.defaultEditStatusMessage;
  }

  // Production default: send the photo with the result action keyboard.
  private async defaultSendPhoto(input: {
    session: SessionSafe;
    revision: RevisionSafe;
    attempt: GenerationAttemptSafe;
    imageUrl: string;
  }): Promise<{ messageId: number }> {
    const env = getServerEnv();
    const { sendPhotoByUrl } = await import("@/server/telegram/client");
    const { resultKeyboard } = await import("@/server/telegram/keyboards");
    const { buildResultCaption } = await import("@/server/telegram/messages");

    return sendPhotoByUrl(env.TELEGRAM_BOT_TOKEN, input.session.telegramChatId, input.imageUrl, {
      caption: buildResultCaption({
        attemptNumber: input.attempt.attemptNumber,
        revisionNumber: input.revision.revisionNumber,
      }),
      replyMarkup: resultKeyboard(input.session.id),
    });
  }

  // Production default: edit the persisted status message to the outcome. A
  // no-op when the session has no status message id (e.g. a legacy session).
  private async defaultEditStatusMessage(input: {
    session: SessionSafe;
    text: string;
  }): Promise<void> {
    if (input.session.telegramStatusMessageId === null) return;
    const env = getServerEnv();
    const { editMessageText } = await import("@/server/telegram/client");
    await editMessageText(
      env.TELEGRAM_BOT_TOKEN,
      input.session.telegramChatId,
      input.session.telegramStatusMessageId,
      input.text,
    );
  }

  async execute(job: JobSafe): Promise<GenerateImageOutcome> {
    const session = await this.sessionRepository.getById(job.promptSessionId ?? "");
    if (!session) {
      throw new Error(`generate-image: session ${job.promptSessionId} not found`);
    }

    if (isSessionExpired(session, this.now())) {
      return { status: "expired" };
    }

    const revision = await this.enhancementRepository.getRevisionById(job.promptRevisionId ?? "");
    if (!revision) {
      throw new Error(`generate-image: revision ${job.promptRevisionId} not found`);
    }
    if (!revision.enhancedPrompt || revision.enhancedPrompt.trim().length === 0) {
      throw new Error(`generate-image: revision ${revision.id} has no enhanced prompt`);
    }

    // Transition the session to generating (CAS). The callback already moved
    // awaiting_confirmation -> generating before inserting the job, so the
    // expected status is the current one unless a retried claim raced ahead.
    const { data: transitioned } = await this.transitionSession(
      session.id,
      session.status,
      "generating",
    );
    if (!transitioned) {
      // Stale claim (another worker won the CAS, or session moved on). Treat as
      // terminal-success so the job is not retried pointlessly.
      const attempt = job.generationAttemptId
        ? await this.generationRepository.getAttemptById(job.generationAttemptId)
        : null;
      if (!attempt) {
        throw new Error("generate-image: stale claim without a generation attempt");
      }
      // The real worker already delivered the photo and edited the status
      // message; only a session that still has an unedited status message needs
      // a generic update. Best-effort.
      try {
        await this.editStatusMessage({
          session,
          text: buildGenerationStatusMessage("succeeded_generic"),
        });
      } catch (editError) {
        const detail = editError instanceof Error ? editError.message : "unknown";
        logStructured("error", "generate.stale_status_edit_failed", {
          sessionId: session.id,
          detail,
        });
      }
      return { status: "completed", session, attempt };
    }

    // Create the attempt and mark it processing before any outbound call so
    // the guarded mark_*_failed RPCs can always act: whatever fails next, the
    // attempt is in processing and can be marked failed (never left queued).
    const { attemptId } = await this.generationRepository.createAttempt({
      sessionId: session.id,
      revisionId: revision.id,
    });
    await this.generationRepository.markProcessing(attemptId);

    // Persist the linkage job -> attempt so a retried claim can find it. This
    // is best-effort; a failed attach does not block generation (the attempt is
    // marked failed by this use case on any error path below).
    try {
      await this.attachGenerationAttempt(job.id, attemptId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "generate.attach_attempt_failed", { attemptId, detail });
    }

    let requestId: string | null = null;
    let requestMarkedSucceeded = false;
    let selected: SelectedProvider | null = null;
    const startedAt = Date.now();

    try {
      selected = await this.selectProvider(session.id);

      // New seed per attempt so regenerate produces a different image from the
      // same revision. Persisted on the attempt for audit along with the
      // selected provider config.
      const seed = this.now().getTime();
      await this.generationRepository.attachProviderToAttempt(attemptId, selected.config.id, {
        seed,
      });

      const attempt = await this.generationRepository.getAttemptById(attemptId);
      if (!attempt) {
        throw new Error(`generate-image: attempt ${attemptId} not found after creation`);
      }

      requestId = await this.generationRepository.recordProviderRequest({
        jobId: job.id,
        providerConfigId: selected.config.id,
        providerKeyId: selected.key.id,
        capability: "image_generation",
      });

      const adapter = getProviderRegistry().createImageProvider(
        selected.config.adapterType,
        {
          ...selected.config.settings,
          base_url: selected.config.baseUrl,
          model: selected.config.model,
        },
        await this.decryptKey(selected),
      );

      const result = await adapter.generateImage({
        prompt: revision.enhancedPrompt,
        negativePrompt: revision.negativePrompt ?? undefined,
        aspectRatio: revision.aspectRatio ?? undefined,
        parameters: { seed },
      });

      if (result.status === "pending") {
        throw new ProviderError({
          code: "provider_response_invalid",
          retryable: false,
          message: "pending image generation is not supported",
        });
      }

      const imageUrl = result.imageUrl;
      if (!imageUrl || !isHttpsUrl(imageUrl)) {
        throw new ProviderError({
          code: "provider_response_invalid",
          retryable: false,
          message: "image generation returned an invalid image url",
        });
      }

      // Delivery outcome must be known before the attempt is marked succeeded.
      let sent: { messageId: number };
      try {
        // Update the "Sedang membuat gambar..." message to the success outcome
        // before sending the photo. Best-effort: a failed edit (e.g. message
        // deleted) must not block delivery.
        try {
          await this.editStatusMessage({
            session,
            text: buildGenerationStatusMessage("succeeded", {
              attemptNumber: attempt.attemptNumber,
              revisionNumber: revision.revisionNumber,
            }),
          });
        } catch (editError) {
          const detail = editError instanceof Error ? editError.message : "unknown";
          logStructured("error", "generate.status_edit_failed", {
            sessionId: session.id,
            detail,
          });
        }
        sent = await this.sendPhoto({ session, revision, attempt, imageUrl });
      } catch (error) {
        // Delivery failure is terminal for this attempt; the session moves to
        // generation_failed so the user can retry manually.
        throw new ProviderError({
          code: "telegram_delivery_failed",
          retryable: false,
          message: "telegram photo delivery failed",
          cause: error,
        });
      }

      const latencyMs = Date.now() - startedAt;
      await this.generationRepository.markProviderRequestSucceeded({
        requestId,
        providerRequestId: result.providerRequestId,
        httpStatus: 200,
        latencyMs,
      });
      requestMarkedSucceeded = true;

      await this.providerKeyRepository.markSuccess({
        keyId: selected.key.id,
        providerConfigId: selected.config.id,
      });

      await this.generationRepository.markAttemptSucceeded(
        attemptId,
        result.providerRequestId ?? null,
        sent.messageId,
      );

      const finalSession = await this.transitionSessionOrThrow(
        session.id,
        "generating",
        "result_ready",
      );

      const finalAttempt = await this.generationRepository.getAttemptById(attemptId);
      if (!finalAttempt) {
        throw new Error(`generate-image: attempt ${attemptId} not found after success`);
      }

      return { status: "completed", session: finalSession, attempt: finalAttempt };
    } catch (error) {
      const providerError = normalizeGenerationError(error);

      // The attempt must never be left in processing: mark it failed (guarded
      // RPC — a stale/raced completion simply makes this a no-op error we
      // swallow) so a retry or complete is never blocked.
      try {
        await this.generationRepository.markAttemptFailed(
          attemptId,
          providerError.code,
          providerError.safeMessage,
        );
      } catch (markError) {
        const detail = markError instanceof Error ? markError.message : "unknown";
        logStructured("error", "generate.mark_attempt_failed_error", { attemptId, detail });
      }

      if (requestId && !requestMarkedSucceeded) {
        await this.generationRepository.markProviderRequestFailed({
          requestId,
          errorCode: providerError.code,
          httpStatus: providerError.httpStatus,
        });
      }

      if (
        selected &&
        (providerError.code === "provider_rate_limited" ||
          providerError.code === "provider_authentication_failed" ||
          providerError.code === "provider_authorization_failed")
      ) {
        await this.providerKeyRepository.markFailure({
          keyId: selected.key.id,
          providerConfigId: selected.config.id,
        });
      }

      throw providerError;
    }
  }

  private async selectProvider(sessionId: string): Promise<SelectedProvider> {
    const configs = await this.providerConfigRepository.listActive("image_generation");
    const keysByConfig = new Map<
      string,
      Awaited<ReturnType<ProviderKeyRepository["listSafeKeys"]>>
    >();
    for (const config of configs) {
      keysByConfig.set(config.id, await this.providerKeyRepository.listSafeKeys(config.id));
    }
    return this.selector.selectProvider(
      "image_generation",
      configs,
      keysByConfig,
      "priority_failover",
      { seed: sessionId },
    );
  }

  private async decryptKey(selected: SelectedProvider): Promise<string> {
    const handle = await this.providerKeyVaultRepository.getDecryptableKey(
      selected.config.id,
      selected.key.id,
    );
    if (!handle) {
      throw new ProviderError({
        code: "provider_key_unavailable",
        retryable: false,
        message: "decryption of selected provider key failed",
      });
    }
    return handle.plaintext;
  }

  private async transitionSession(
    sessionId: string,
    expected: string,
    next: string,
  ): Promise<{ data: unknown | null }> {
    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: sessionId,
        p_expected_status: expected,
        p_new_status: next,
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    return { data };
  }

  private async transitionSessionOrThrow(
    sessionId: string,
    expected: string,
    next: string,
  ): Promise<SessionSafe> {
    const { data } = await this.transitionSession(sessionId, expected, next);
    if (!data) {
      throw new Error(`session transition ${expected} -> ${next} lost the CAS`);
    }
    const session = await this.sessionRepository.getById(sessionId);
    if (!session) {
      throw new Error(`session ${sessionId} not found after transition`);
    }
    return session;
  }
}

// Normalizes any thrown error into a ProviderError shape.
function normalizeGenerationError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError({
    code: "provider_unknown_error",
    retryable: false,
    message: "image generation failed",
    cause: error,
  });
}
