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
import { logStructured } from "@/server/observability/logger";
import { ProviderError, withProviderContext } from "@/server/providers/errors";
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
import { PromptAuditRepository } from "@/server/repositories/prompt-audit.repository";
import {
  PromptConfigRepository,
  PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA,
} from "@/server/repositories/prompt-config.repository";
import { redactJson, redactSensitive } from "@/server/observability/redact";
import { OpenAICompatibleReasoningAdapter } from "@/server/providers/reasoning/openai-compatible.adapter";
import { isSessionExpired } from "./session-expiry-check";

// The enhancement system prompt instructs the model to answer with a JSON
// object. Parsing + zod validation lives in prompt-structure.ts.
//
// Split into persona (DB-configurable) + immutable shape tail (code) so prompt
// tunability does not break structured parsing. The persona is loaded from
// prompt_configs (strict-error); shape tail is always appended.
export const ENHANCEMENT_SYSTEM_PROMPT_PERSONA = [
  "You are a professional prompt engineer for an AI image generation bot.",
  "Rewrite the user's prompt into a detailed, high-quality image generation prompt.",
].join("\n");

export const ENHANCEMENT_SYSTEM_PROMPT_SHAPE = [
  "Respond with a single JSON object and nothing else, using exactly this shape:",
  '{"prompt": "...", "negative_prompt": "...", "aspect_ratio": "..."}',
  '"prompt" is required; "negative_prompt" and "aspect_ratio" are optional strings.',
].join("\n");

// Backward-compatible combined prompt (persona + shape). Used as seed value and
// by existing tests that import the constant.
export const ENHANCEMENT_SYSTEM_PROMPT = `${ENHANCEMENT_SYSTEM_PROMPT_PERSONA}\n${ENHANCEMENT_SYSTEM_PROMPT_SHAPE}`;

export function buildEnhancementSystemPrompt(persona: string): string {
  return `${persona.trim()}\n${ENHANCEMENT_SYSTEM_PROMPT_SHAPE}`;
}

export type EnhancementOutcome =
  | {
      status: "completed";
      session: SessionSafe;
      revision: RevisionSafe;
      prompt: EnhancedPromptStructured;
    }
  | { status: "expired" };

// Result of the session-less enhance-only flow (/enhance-prompt): the
// structured prompt plus the provider config used (for diagnostics).
export type EnhanceOnlyOutcome = {
  prompt: EnhancedPromptStructured;
  providerConfigId: string;
};

export type EnhancePromptDeps = {
  providerConfigRepository?: ProviderConfigRepository;
  providerKeyRepository?: ProviderKeyRepository;
  providerKeyVaultRepository?: ProviderKeyVaultRepository;
  enhancementRepository?: EnhancementRepository;
  sessionRepository?: SessionRepository;
  selector?: ProviderSelector;
  promptAuditRepository?: PromptAuditRepository;
  promptConfigRepository?: PromptConfigRepository;
  now?: () => Date;
  // Best-effort confirmation message with inline keyboard. Injected so tests
  // can stub it; the production default sends via Telegram.
  sendConfirmation?: (input: {
    session: SessionSafe;
    revision: RevisionSafe;
    prompt: EnhancedPromptStructured;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
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
  private readonly promptAuditRepository: PromptAuditRepository;
  private readonly promptConfigRepository: PromptConfigRepository;
  private readonly now: () => Date;
  private readonly sendConfirmation: (input: {
    session: SessionSafe;
    revision: RevisionSafe;
    prompt: EnhancedPromptStructured;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
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
    this.promptAuditRepository = deps.promptAuditRepository ?? new PromptAuditRepository();
    this.promptConfigRepository = deps.promptConfigRepository ?? new PromptConfigRepository();
    this.now = deps.now ?? (() => new Date());
    this.sendConfirmation = deps.sendConfirmation ?? this.defaultSendConfirmation;
  }

  // Production default: send the enhanced prompt with the confirmation keyboard (with model).
  private async defaultSendConfirmation(input: {
    session: SessionSafe;
    revision: RevisionSafe;
    prompt: EnhancedPromptStructured;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
  }): Promise<void> {
    const env = getServerEnv();
    const { sendMessageWithKeyboard } = await import("@/server/telegram/client");
    const {
      confirmationKeyboardWithModel,
      ADAPTER_TO_MODEL_CODE,
      MODEL_CODE_LABEL,
      REASONING_ADAPTER_TO_CODE,
    } = await import("@/server/telegram/keyboards");
    const { buildEnhancedPromptMessage } = await import("@/server/telegram/messages");

    // Resolve reasoning provider/model label (priority: passed-in selected, then revision FK lookup)
    let reasoningProviderLabel = input.reasoningProviderLabel ?? null;
    let reasoningModel = input.reasoningModel ?? null;
    // Reasoning picker code = the adapter of the provider that actually
    // produced this enhancement (displayed as "Reasoning: X ✓" on the picker row).
    let reasoningCode: import("@/server/telegram/keyboards").ReasoningShortCode | null = null;
    if (input.revision.reasoningProviderConfigId) {
      try {
        const rcfg = await this.providerConfigRepository.getById(
          input.revision.reasoningProviderConfigId,
        );
        if (rcfg) {
          reasoningProviderLabel = reasoningProviderLabel ?? rcfg.name;
          reasoningModel = reasoningModel ?? rcfg.model;
          reasoningCode = REASONING_ADAPTER_TO_CODE[rcfg.adapterType] ?? null;
        }
      } catch {
        // ignore
      }
    }

    // Resolve selected image model label from session preferred provider (hybrid)
    let selectedCode: import("@/server/telegram/keyboards").ModelShortCode | null = null;
    let selectedLabel: string | null = null;
    if (input.session.preferredImageProviderConfigId) {
      try {
        const cfg = await this.providerConfigRepository.getById(
          input.session.preferredImageProviderConfigId,
        );
        if (cfg) {
          selectedCode = ADAPTER_TO_MODEL_CODE[cfg.adapterType] ?? null;
          if (selectedCode) selectedLabel = MODEL_CODE_LABEL[selectedCode];
        }
      } catch {
        // ignore
      }
    } else {
      // Fallback to user default preference for display even if session not yet has preferred
      try {
        const { UserImagePreferenceRepository } =
          await import("@/server/repositories/user-image-preference.repository");
        const prefRepo = new UserImagePreferenceRepository();
        const pref = await prefRepo.getByTelegramUserId(input.session.telegramUserId);
        if (pref) {
          const cfg = await this.providerConfigRepository.getById(pref.preferredProviderConfigId);
          if (cfg) {
            selectedCode = ADAPTER_TO_MODEL_CODE[cfg.adapterType] ?? null;
            if (selectedCode) selectedLabel = MODEL_CODE_LABEL[selectedCode];
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      await sendMessageWithKeyboard(
        env.TELEGRAM_BOT_TOKEN,
        input.session.telegramChatId,
        buildEnhancedPromptMessage({
          enhancedPrompt: input.prompt.prompt,
          revisionNumber: input.revision.revisionNumber,
          sourcePrompt: input.revision.sourcePrompt,
          reasoningProviderLabel,
          reasoningModel,
          imageModelLabel: selectedLabel,
          selectedModelLabel: selectedLabel,
        }),
        confirmationKeyboardWithModel(input.session.id, selectedCode, reasoningCode),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "enhance.confirmation_send_failed", {
        sessionId: input.session.id,
        detail,
      });
    }
  }

  private async resolveSystemPrompt(): Promise<string> {
    const persona = await this.promptConfigRepository.getActivePersona(
      PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA,
    );
    return buildEnhancementSystemPrompt(persona);
  }

  // Session-less enhancement for /enhance-prompt: provider select, audit row,
  // adapter call, structured validation. No session/revision writes — the
  // caller owns the job lifecycle and user messaging. Throws ProviderError on
  // failure (caller decides retry). `preferredConfigId` (from the job payload,
  // set via the user's default reasoning preference) is honored when eligible;
  // otherwise the selector fallback applies.
  async enhanceOnly(input: {
    jobId: string;
    sourcePrompt: string;
    preferredConfigId?: string | null;
    telegramUserId?: bigint;
  }): Promise<EnhanceOnlyOutcome> {
    const systemPrompt = await this.resolveSystemPrompt();
    const { selected, startedAt } = await this.selectProvider(input.jobId, {
      preferredConfigId: input.preferredConfigId ?? null,
      telegramUserId: input.telegramUserId,
    });

    const requestId = await this.enhancementRepository.recordProviderRequest({
      jobId: input.jobId,
      providerConfigId: selected.config.id,
      providerKeyId: selected.key.id,
      capability: "reasoning",
    });

    try {
      const adapter = await this.createAdapter(selected);

      const result = await adapter.enhancePrompt({
        sourcePrompt: input.sourcePrompt,
        systemPrompt,
        options: {
          ...(selected.config.settings["response_format"] !== undefined
            ? { response_format: selected.config.settings["response_format"] }
            : {}),
        },
      });

      const structured = parseEnhancedPromptContent(result.prompt);

      await this.enhancementRepository.markProviderRequestSucceeded({
        requestId,
        providerRequestId: result.metadata["providerRequestId"] as string | undefined,
        httpStatus: 200,
        latencyMs: Date.now() - startedAt,
      });

      await this.providerKeyRepository.markSuccess({
        keyId: selected.key.id,
        providerConfigId: selected.config.id,
      });

      return { prompt: structured, providerConfigId: selected.config.id };
    } catch (error) {
      const providerError = withProviderContext(normalizeEnhancementError(error), {
        label: selected.config.name,
        model: selected.config.model,
      });
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

    const systemPrompt = await this.resolveSystemPrompt();
    const { selected, startedAt } = await this.selectProvider(session.id, {
      preferredConfigId: session.preferredReasoningProviderConfigId,
      telegramUserId: session.telegramUserId,
    });

    // Build the audit capture (request messages + model snapshot) before the
    // outbound call so even a network failure leaves a record. redactJson
    // is defense-in-depth against accidental key leakage in user content.
    const adapter = await this.createAdapter(selected);
    const requestMessages =
      typeof (adapter as OpenAICompatibleReasoningAdapter).buildMessagesForAudit === "function"
        ? redactJson(
            (adapter as OpenAICompatibleReasoningAdapter).buildMessagesForAudit({
              sourcePrompt: revision.sourcePrompt,
              previousPrompt: revision.previousPrompt ?? undefined,
              revisionInstruction: revision.revisionInstruction ?? undefined,
              systemPrompt,
              options: {},
            }),
          )
        : undefined;

    const requestId = await this.enhancementRepository.recordProviderRequest({
      jobId: job.id,
      providerConfigId: selected.config.id,
      providerKeyId: selected.key.id,
      capability: "reasoning",
      requestMessages,
      reasoningModel: selected.config.model,
      telegramUserId: session.telegramUserId,
      telegramChatId: session.telegramChatId,
    });

    // Audit: capture the input that will be sent to the reasoning provider
    // (best-effort; never blocks the job on insert failure).
    await this.promptAuditRepository.insert({
      sessionId: session.id,
      revisionId: revision.id,
      telegramUserId: session.telegramUserId,
      telegramChatId: session.telegramChatId,
      stage: "enhance_input",
      sourcePrompt: revision.sourcePrompt,
      previousPrompt: revision.previousPrompt,
      revisionInstruction: revision.revisionInstruction,
      providerConfigId: selected.config.id,
      providerRequestId: requestId,
      model: selected.config.model,
      status: "ok",
    });

    try {
      const result = await adapter.enhancePrompt({
        sourcePrompt: revision.sourcePrompt,
        previousPrompt: revision.previousPrompt ?? undefined,
        revisionInstruction: revision.revisionInstruction ?? undefined,
        systemPrompt,
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

      // Audit: capture the structured enhanced prompt returned by the provider.
      await this.promptAuditRepository.insert({
        sessionId: session.id,
        revisionId: revision.id,
        telegramUserId: session.telegramUserId,
        telegramChatId: session.telegramChatId,
        stage: "enhance_output",
        enhancedPrompt: structured.prompt,
        providerConfigId: selected.config.id,
        providerRequestId: requestId,
        model: selected.config.model,
        status: "ok",
      });

      const latencyMs = Date.now() - startedAt;
      await this.enhancementRepository.markProviderRequestSucceeded({
        requestId,
        providerRequestId: result.metadata["providerRequestId"] as string | undefined,
        httpStatus: 200,
        latencyMs,
        responseContent: redactSensitive(result.prompt),
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
        revision: { ...revision, reasoningProviderConfigId: selected.config.id },
        prompt: structured,
        reasoningProviderLabel: selected.config.name,
        reasoningModel: selected.config.model,
      });

      return { status: "completed", session: finalSession, revision, prompt: structured };
    } catch (error) {
      const providerError = withProviderContext(normalizeEnhancementError(error), {
        label: selected.config.name,
        model: selected.config.model,
      });
      await this.enhancementRepository.markProviderRequestFailed({
        requestId,
        errorCode: providerError.code,
        httpStatus: providerError.httpStatus,
        responseContent: redactSensitive(providerError.safeMessage ?? ""),
      });

      // Audit the failure so post-purge RCA can still see which prompt
      // hit which error.
      await this.promptAuditRepository.insert({
        sessionId: session.id,
        revisionId: revision.id,
        telegramUserId: session.telegramUserId,
        telegramChatId: session.telegramChatId,
        stage: "enhance_output",
        sourcePrompt: revision.sourcePrompt,
        providerConfigId: selected.config.id,
        providerRequestId: requestId,
        model: selected.config.model,
        status: "failed",
        errorCode: providerError.code,
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
    options?: { preferredConfigId?: string | null; telegramUserId?: bigint },
  ): Promise<{ selected: SelectedProvider; startedAt: number }> {
    const configs = await this.providerConfigRepository.listActive("reasoning");
    const keysByConfig = new Map<
      string,
      Awaited<ReturnType<ProviderKeyRepository["listSafeKeys"]>>
    >();
    for (const config of configs) {
      keysByConfig.set(config.id, await this.providerKeyRepository.listSafeKeys(config.id));
    }

    // Hybrid: honor the per-session preferred reasoning provider (set via the
    // Telegram reasoning picker) when it is active and has an eligible key;
    // otherwise fall back to the per-user default, then the selector.
    const tryPreferredId =
      options?.preferredConfigId ??
      (options?.telegramUserId
        ? await this.getUserDefaultPreferredId(options.telegramUserId)
        : null);

    if (tryPreferredId) {
      const preferredConfig = configs.find((c) => c.id === tryPreferredId && c.isActive);
      if (!preferredConfig && tryPreferredId) {
        logStructured("warn", "enhance.preferred_reasoning_inactive", {
          sessionId,
          preferredConfigId: tryPreferredId,
        });
      }
      if (preferredConfig) {
        const keys = keysByConfig.get(preferredConfig.id) ?? [];
        const hasEligibleKey = keys.some(
          (k) =>
            k.isActive && (!k.cooldownUntil || new Date(k.cooldownUntil).getTime() <= Date.now()),
        );
        if (hasEligibleKey) {
          const selected = await this.selector.selectProvider(
            "reasoning",
            [preferredConfig],
            new Map([[preferredConfig.id, keys]]),
            { seed: sessionId },
          );
          return { selected, startedAt: Date.now() };
        }
        logStructured("warn", "enhance.preferred_reasoning_not_eligible", {
          sessionId,
          preferredConfigId: tryPreferredId,
        });
      }
    }

    const selected = await this.selector.selectProvider("reasoning", configs, keysByConfig, {
      seed: sessionId,
    });
    return { selected, startedAt: Date.now() };
  }

  private async getUserDefaultPreferredId(telegramUserId: bigint): Promise<string | null> {
    try {
      const { UserReasoningPreferenceRepository } =
        await import("@/server/repositories/user-reasoning-preference.repository");
      const repo = new UserReasoningPreferenceRepository();
      const pref = await repo.getByTelegramUserId(telegramUserId);
      return pref?.preferredProviderConfigId ?? null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "enhance.user_default_lookup_failed", { detail });
      return null;
    }
  }

  // Adapter factories read base_url/model from the config payload; merge the
  // DB row's columns (baseUrl, model) into the settings so the adapter hits
  // the configured endpoint instead of the factory default.
  private async createAdapter(selected: SelectedProvider) {
    return getProviderRegistry().createReasoningProvider(
      selected.config.adapterType,
      {
        ...selected.config.settings,
        base_url: selected.config.baseUrl,
        model: selected.config.model,
      },
      await this.decryptKey(selected),
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
    // Content-policy refusal is terminal with an explicit code + message so
    // the user is told the prompt was declined; malformed output keeps the
    // generic provider_response_invalid.
    if (error.reason === "refusal") {
      return new ProviderError({
        code: "provider_content_rejected",
        retryable: false,
        message: "enhancement refused by content policy",
        cause: error,
      });
    }
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
