// enhance_only job handler (/enhance-prompt command).
//
// Session-less enhancement: reads the raw prompt from the job payload, runs
// the provider enhancement (audit + key cooldown handled by the use case's
// enhanceOnly method), and replies with the enhanced prompt as plain copyable
// text. No session, revision, or generation happens here. Provider failures
// follow the same bounded retry classification as enhance_prompt; a terminal
// failure sends a plain failure message (no keyboard — there is no session to
// retry from; the user re-sends the command).

import type { JobRow } from "@/server/jobs/processor";
import { EnhancePromptUseCase } from "@/server/application/enhance-prompt";
import { JobRepository } from "@/server/repositories/job.repository";
import { EnhancementJobRetry } from "./retry";
import { getServerEnv } from "@/env";
import { sendMessage } from "@/server/telegram/client";
import {
  getBotMessage,
  getEnhanceOnlyMessage,
  failureContextFromError,
} from "@/server/telegram/messages";
import { logStructured } from "@/server/observability/logger";
import type { ProviderErrorShape } from "@/server/providers/errors";

export type EnhancePromptOnlyHandlerDeps = {
  enhancePrompt?: EnhancePromptUseCase;
  jobRepository?: JobRepository;
  retry?: EnhancementJobRetry;
  sendMessage?: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  providerConfigRepository?: {
    getById(id: string): Promise<{ name: string; model: string | null } | null>;
  };
};

type EnhanceOnlyPayload = {
  telegramUserId: bigint;
  telegramChatId: bigint;
  sourcePrompt: string;
  preferredReasoningConfigId?: string | null;
};

function parsePayload(payload: Record<string, unknown>): EnhanceOnlyPayload | null {
  const userId = payload["telegram_user_id"];
  const chatId = payload["telegram_chat_id"];
  const sourcePrompt = payload["source_prompt"];
  const preferredConfigId = payload["preferred_reasoning_config_id"];
  if (
    (typeof userId !== "string" && typeof userId !== "number") ||
    (typeof chatId !== "string" && typeof chatId !== "number") ||
    typeof sourcePrompt !== "string" ||
    sourcePrompt.length === 0 ||
    (preferredConfigId !== undefined && typeof preferredConfigId !== "string")
  ) {
    return null;
  }
  try {
    return {
      telegramUserId: BigInt(userId),
      telegramChatId: BigInt(chatId),
      sourcePrompt,
      preferredReasoningConfigId: typeof preferredConfigId === "string" ? preferredConfigId : null,
    };
  } catch {
    // Non-numeric ids: malformed beyond repair — the caller marks the job
    // failed immediately instead of burning retry attempts.
    return null;
  }
}

function normalizeToProviderError(error: unknown): ProviderErrorShape {
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

export class EnhancePromptOnlyHandler {
  private readonly enhancePrompt: EnhancePromptUseCase;
  private readonly jobRepository: JobRepository;
  private readonly retry: EnhancementJobRetry;
  private readonly sendMessage: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  private readonly providerConfigRepository: EnhancePromptOnlyHandlerDeps["providerConfigRepository"];

  constructor(deps: EnhancePromptOnlyHandlerDeps = {}) {
    this.enhancePrompt = deps.enhancePrompt ?? new EnhancePromptUseCase();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.retry = deps.retry ?? new EnhancementJobRetry(this.jobRepository);
    this.sendMessage = deps.sendMessage ?? sendMessage;
    this.providerConfigRepository = deps.providerConfigRepository;
  }

  async handle(job: JobRow, workerId: string): Promise<void> {
    const payload = parsePayload((job.payload as Record<string, unknown> | null) ?? {});
    if (!payload) {
      // Malformed payload is non-retryable: no amount of retries fixes it.
      await this.jobRepository.markFailed(job.id, workerId, {
        errorCode: "malformed_payload",
        errorMessageRedacted: "enhance_only payload missing required fields",
      });
      return;
    }

    try {
      const outcome = await this.enhancePrompt.enhanceOnly({
        jobId: job.id,
        sourcePrompt: payload.sourcePrompt,
        preferredConfigId: payload.preferredReasoningConfigId,
        telegramUserId: payload.telegramUserId,
      });

      const env = getServerEnv();
      // Best-effort provider label for the result text (which reasoning model
      // produced the enhancement). Never blocks delivery.
      let reasoningLine: string | null = null;
      try {
        const { ProviderConfigRepository } =
          await import("@/server/repositories/provider-config.repository");
        const repo = this.providerConfigRepository as unknown as
          InstanceType<typeof ProviderConfigRepository> | undefined;
        const cfgRepo = repo ?? new ProviderConfigRepository();
        const cfg = await cfgRepo.getById(outcome.providerConfigId);
        if (cfg) {
          const p = cfg.name?.trim() ?? "";
          const m = cfg.model?.trim() ?? "";
          reasoningLine =
            p && m && p !== m && !p.includes(m)
              ? `Reasoning: ${p} · ${m} ✓`
              : `Reasoning: ${p || m} ✓`;
        }
      } catch {
        reasoningLine = null;
      }
      try {
        await this.sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          payload.telegramChatId,
          await getEnhanceOnlyMessage(outcome.prompt, reasoningLine),
        );
      } catch (error) {
        // Delivery failed after a successful provider call: the job is done
        // (provider cost incurred, result not persisted anywhere) — log and
        // succeed; the user can re-run the command.
        const detail = error instanceof Error ? error.message : "unknown";
        logStructured("error", "enhance_only.send_failed", { jobId: job.id, detail });
      }

      await this.jobRepository.markSucceeded(job.id, workerId);
    } catch (error) {
      const providerError = normalizeToProviderError(error);
      const retried = await this.retry.apply(
        { id: job.id, attemptCount: job.attempt_count },
        workerId,
        providerError,
      );

      if (!retried) {
        // Terminal failure: tell the user best-effort. Distinguish a
        // content-policy refusal (which the same input cannot resolve) so the
        // user knows the prompt was declined rather than "failed". The message
        // names the provider + error (redacted) for diagnostics.
        try {
          const env = getServerEnv();
          await this.sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            payload.telegramChatId,
            await getBotMessage(
              providerError.code === "provider_content_rejected"
                ? "content_policy_declined"
                : "enhance_only_failed",
              { failure: failureContextFromError(providerError) },
            ),
          );
        } catch (sendError) {
          const detail = sendError instanceof Error ? sendError.message : "unknown";
          logStructured("error", "enhance_only.failure_send_failed", { jobId: job.id, detail });
        }
      }
    }
  }
}

// Registered processor entry point (matches the JobHandler signature).
export const enhancePromptOnlyHandler = async (job: JobRow): Promise<void> => {
  const workerId = job.locked_by ?? "processor-unknown";
  await new EnhancePromptOnlyHandler().handle(job, workerId);
};
