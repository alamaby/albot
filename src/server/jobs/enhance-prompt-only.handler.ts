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
import { buildBotMessage, buildEnhanceOnlyMessage } from "@/server/telegram/messages";
import { logStructured } from "@/server/observability/logger";
import type { ProviderErrorShape } from "@/server/providers/errors";

export type EnhancePromptOnlyHandlerDeps = {
  enhancePrompt?: EnhancePromptUseCase;
  jobRepository?: JobRepository;
  retry?: EnhancementJobRetry;
  sendMessage?: (token: string, chatId: bigint, text: string) => Promise<unknown>;
};

type EnhanceOnlyPayload = {
  telegramUserId: bigint;
  telegramChatId: bigint;
  sourcePrompt: string;
};

function parsePayload(payload: Record<string, unknown>): EnhanceOnlyPayload | null {
  const userId = payload["telegram_user_id"];
  const chatId = payload["telegram_chat_id"];
  const sourcePrompt = payload["source_prompt"];
  if (
    (typeof userId !== "string" && typeof userId !== "number") ||
    (typeof chatId !== "string" && typeof chatId !== "number") ||
    typeof sourcePrompt !== "string" ||
    sourcePrompt.length === 0
  ) {
    return null;
  }
  return {
    telegramUserId: BigInt(userId),
    telegramChatId: BigInt(chatId),
    sourcePrompt,
  };
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

  constructor(deps: EnhancePromptOnlyHandlerDeps = {}) {
    this.enhancePrompt = deps.enhancePrompt ?? new EnhancePromptUseCase();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.retry = deps.retry ?? new EnhancementJobRetry(this.jobRepository);
    this.sendMessage = deps.sendMessage ?? sendMessage;
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
      });

      const env = getServerEnv();
      try {
        await this.sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          payload.telegramChatId,
          buildEnhanceOnlyMessage(outcome.prompt),
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
        // Terminal failure: tell the user best-effort.
        try {
          const env = getServerEnv();
          await this.sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            payload.telegramChatId,
            buildBotMessage("enhance_only_failed"),
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
