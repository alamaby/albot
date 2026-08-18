// Enhancement use case (Milestone 4).
//
// Runs the enhance_prompt job: selects a reasoning provider + key from the DB,
// records a provider_requests audit row, invokes the adapter, validates the
// structured output, persists the completed revision, and transitions the
// session to awaiting_confirmation. The job-level retry/terminal decision is
// made by the caller (enhance-prompt.handler) based on thrown ProviderError.

import { getServerEnv } from "@/env";
// Side-effect import: registers the built-in reasoning/image adapters on the
// provider registry (see providers/index.ts). Without this the registry is
// empty at runtime and every adapter lookup fails with provider_adapter_unknown.
import "@/server/providers/index";
import { getProviderRegistry } from "@/server/providers/registry";
import { ProviderSelector, type SelectedProvider } from "@/server/providers/selector";
import { ProviderError } from "@/server/providers/errors";
import {
  parseEnhancedPromptContent,
  StructuredPromptError,
  type EnhancedPromptStructured,
} from "@/server/providers/prompt-structure";
import { ProviderConfigRepository } from "@/server/repositories/provider-config.repository";
import { ProviderKeyRepository } from "@/server/repositories/provider-key.repository";
import { ProviderKeyVaultRepository } from "@/server/repositories/provider-key-vault.repository";
import { parseEncryptionKey } from "@/server/security/encryption";
import {
  EnhancementRepository,
  type RevisionSafe,
} from "@/server/repositories/enhancement.repository";
import { SessionRepository, type SessionSafe } from "@/server/repositories/session.repository";
import type { JobSafe } from "@/server/repositories/job.repository";
import { isSessionExpired } from "./session-expiry-check";

// The enhancement system prompt instructs the model to answer with a JSON
// object. Parsing + zod validation lives in prompt-structure.ts.
export const ENHANCEMENT_SYSTEM_PROMPT = [
  "You are a professional prompt engineer for an AI image generation bot.",
  "Rewrite the user's prompt into a detailed, high-quality image generation prompt.",
  "Respond with a single JSON object and nothing else, using exactly this shape:",
  '{"prompt": "...", "negative_prompt": "...", "aspect_ratio": "..."}',
  '"prompt" is required; "negative_prompt" and "aspect_ratio" are optional strings.',
].join("\n");

export type EnhancementOutcome =
  | {
      status: "completed";
      session: SessionSafe;
      revision: RevisionSafe;
      prompt: EnhancedPromptStructured;
    }
  | { status: "expired" };

export type EnhancePromptDeps = {
  providerConfigRepository?: ProviderConfigRepository;
  providerKeyRepository?: ProviderKeyRepository;
  providerKeyVaultRepository?: ProviderKeyVaultRepository;
  enhancementRepository?: EnhancementRepository;
  sessionRepository?: SessionRepository;
  selector?: ProviderSelector;
  now?: () => Date;
  // Best-effort confirmation message with inline keyboard. Injected so tests
  // can stub it; the production default sends via Telegram.
  sendConfirmation?: (input: {
    session: SessionSafe;
    revision: RevisionSafe;
    prompt: EnhancedPromptStructured;
  }) => Promise<void>;
};

function parseEncryptionKeyFromEnv(): Buffer {
  const { PROVIDER_KEY_ENCRYPTION_KEY } = getServerEnv();
  // Reuse the shared strict parser so validation is identical to env.ts.
  return parseEncryptionKey(PROVIDER_KEY_ENCRYPTION_KEY);
}

export class EnhancePromptUseCase {
  private readonly providerConfigRepository: ProviderConfigRepository;
  private readonly providerKeyRepository: ProviderKeyRepository;
  private readonly providerKeyVaultRepository: ProviderKeyVaultRepository;
  private readonly enhancementRepository: EnhancementRepository;
  private readonly sessionRepository: SessionRepository;
  private readonly selector: ProviderSelector;
  private readonly now: () => Date;
  private readonly sendConfirmation: (input: {
    session: SessionSafe;
    revision: RevisionSafe;
    prompt: EnhancedPromptStructured;
  }) => Promise<void>;

  constructor(deps: EnhancePromptDeps = {}) {
    this.providerConfigRepository = deps.providerConfigRepository ?? new ProviderConfigRepository();
    this.providerKeyRepository =
      deps.providerKeyRepository ?? new ProviderKeyRepository(parseEncryptionKeyFromEnv());
    this.providerKeyVaultRepository =
      deps.providerKeyVaultRepository ??
      new ProviderKeyVaultRepository(parseEncryptionKeyFromEnv());
    this.enhancementRepository = deps.enhancementRepository ?? new EnhancementRepository();
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.selector = deps.selector ?? new ProviderSelector();
    this.now = deps.now ?? (() => new Date());
    this.sendConfirmation = deps.sendConfirmation ?? this.defaultSendConfirmation;
  }

  // Production default: send the enhanced prompt with the confirmation keyboard.
  private async defaultSendConfirmation(input: {
    session: SessionSafe;
    revision: RevisionSafe;
    prompt: EnhancedPromptStructured;
  }): Promise<void> {
    const env = getServerEnv();
    const { sendMessageWithKeyboard } = await import("@/server/telegram/client");
    const { confirmationKeyboard } = await import("@/server/telegram/keyboards");
    const { buildEnhancedPromptMessage } = await import("@/server/telegram/messages");

    try {
      await sendMessageWithKeyboard(
        env.TELEGRAM_BOT_TOKEN,
        input.session.telegramChatId,
        buildEnhancedPromptMessage({
          enhancedPrompt: input.prompt.prompt,
          revisionNumber: input.revision.revisionNumber,
          sourcePrompt: input.revision.sourcePrompt,
        }),
        confirmationKeyboard(input.session.id),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`enhance-prompt: confirmation send failed (${detail})`);
    }
  }

  async execute(job: JobSafe): Promise<EnhancementOutcome> {
    const session = await this.sessionRepository.getById(job.promptSessionId ?? "");
    if (!session) {
      throw new Error(`enhancement: session ${job.promptSessionId} not found`);
    }

    if (isSessionExpired(session, this.now())) {
      return { status: "expired" };
    }

    const revision = await this.enhancementRepository.getRevisionById(job.promptRevisionId ?? "");
    if (!revision) {
      throw new Error(`enhancement: revision ${job.promptRevisionId} not found`);
    }

    // Transition session to enhancing (CAS). The expected status depends on the
    // flow: first prompt starts from 'received'; a revision re-runs from
    // 'awaiting_revision_input' (already transitioned by revision-input) or a
    // retried claim that already moved to 'enhancing'.
    const expectedStatus =
      session.status === "received" || session.status === "awaiting_revision_input"
        ? session.status
        : "enhancing";

    const { data: transitioned } = await this.transitionSession(
      session.id,
      expectedStatus,
      "enhancing",
    );
    if (!transitioned) {
      // Stale claim (another worker won the CAS, or session moved on). Treat as
      // terminal-success so the job is not retried pointlessly.
      return { status: "completed", session, revision, prompt: parseCachedEnhanced(revision) };
    }

    // Mark the revision as processing before any outbound call so the
    // mark_revision_failed RPC guard (status='processing') can later mark it
    // failed without racing a completed revision.
    await this.enhancementRepository.markRevisionProcessing(revision.id);

    const { selected, startedAt } = await this.selectProvider(session.id);

    const requestId = await this.enhancementRepository.recordProviderRequest({
      jobId: job.id,
      providerConfigId: selected.config.id,
      providerKeyId: selected.key.id,
      capability: "reasoning",
    });

    try {
      // Adapter factories read base_url/model from the config payload; merge
      // the DB row's columns (baseUrl, model) into the settings so the adapter
      // hits the configured endpoint instead of the factory default.
      const adapter = getProviderRegistry().createReasoningProvider(
        selected.config.adapterType,
        {
          ...selected.config.settings,
          base_url: selected.config.baseUrl,
          model: selected.config.model,
        },
        await this.decryptKey(selected),
      );

      const result = await adapter.enhancePrompt({
        sourcePrompt: revision.sourcePrompt,
        previousPrompt: revision.previousPrompt ?? undefined,
        revisionInstruction: revision.revisionInstruction ?? undefined,
        systemPrompt: ENHANCEMENT_SYSTEM_PROMPT,
        options: {
          ...(selected.config.settings["response_format"] !== undefined
            ? { response_format: selected.config.settings["response_format"] }
            : {}),
        },
      });

      const structured = parseEnhancedPromptContent(result.prompt);

      await this.enhancementRepository.saveEnhancedPrompt({
        revisionId: revision.id,
        enhancedPrompt: structured.prompt,
        negativePrompt: structured.negative_prompt,
        aspectRatio: structured.aspect_ratio,
        reasoningProviderConfigId: selected.config.id,
      });

      const latencyMs = Date.now() - startedAt;
      await this.enhancementRepository.markProviderRequestSucceeded({
        requestId,
        providerRequestId: result.metadata["providerRequestId"] as string | undefined,
        httpStatus: 200,
        latencyMs,
      });

      await this.providerKeyRepository.markSuccess({
        keyId: selected.key.id,
        providerConfigId: selected.config.id,
      });

      const finalSession = await this.transitionSessionOrThrow(
        session.id,
        "enhancing",
        "awaiting_confirmation",
      );

      await this.sendConfirmation({
        session: finalSession,
        revision,
        prompt: structured,
      });

      return { status: "completed", session: finalSession, revision, prompt: structured };
    } catch (error) {
      const providerError = normalizeEnhancementError(error);
      await this.enhancementRepository.markProviderRequestFailed({
        requestId,
        errorCode: providerError.code,
        httpStatus: providerError.httpStatus,
      });

      if (
        providerError.code === "provider_rate_limited" ||
        providerError.code === "provider_authentication_failed" ||
        providerError.code === "provider_authorization_failed"
      ) {
        await this.providerKeyRepository.markFailure({
          keyId: selected.key.id,
          providerConfigId: selected.config.id,
        });
      }

      throw providerError;
    }
  }

  private async selectProvider(
    sessionId: string,
  ): Promise<{ selected: SelectedProvider; startedAt: number }> {
    const configs = await this.providerConfigRepository.listActive("reasoning");
    const keysByConfig = new Map<
      string,
      Awaited<ReturnType<ProviderKeyRepository["listSafeKeys"]>>
    >();
    for (const config of configs) {
      keysByConfig.set(config.id, await this.providerKeyRepository.listSafeKeys(config.id));
    }
    const selected = await this.selector.selectProvider(
      "reasoning",
      configs,
      keysByConfig,
      "priority_failover",
      { seed: sessionId },
    );
    return { selected, startedAt: Date.now() };
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
    // The RPC returns the raw snake_case row; reload through the repository so
    // callers get the camelCase SessionSafe shape (telegramChatId etc.).
    const session = await this.sessionRepository.getById(sessionId);
    if (!session) {
      throw new Error(`session ${sessionId} not found after transition`);
    }
    return session;
  }
}

// Normalizes any thrown error into a ProviderError shape. StructuredPromptError
// (invalid model output) maps to provider_response_invalid so retry policy can
// treat it consistently.
function normalizeEnhancementError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof StructuredPromptError) {
    return new ProviderError({
      code: "provider_response_invalid",
      retryable: false,
      message: "enhancement output failed structured validation",
      cause: error,
    });
  }
  return new ProviderError({
    code: "provider_unknown_error",
    retryable: false,
    message: "enhancement failed",
    cause: error,
  });
}

// Fallback for a stale-claim path: the revision may already carry a completed
// enhanced prompt from the winning worker.
function parseCachedEnhanced(revision: RevisionSafe): EnhancedPromptStructured {
  return {
    prompt: revision.enhancedPrompt ?? revision.sourcePrompt,
    ...(revision.negativePrompt ? { negative_prompt: revision.negativePrompt } : {}),
    ...(revision.aspectRatio ? { aspect_ratio: revision.aspectRatio } : {}),
  };
}
