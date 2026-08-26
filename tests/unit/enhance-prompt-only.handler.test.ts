import { afterEach, describe, expect, it, vi } from "vitest";
import { EnhancePromptOnlyHandler } from "@/server/jobs/enhance-prompt-only.handler";
import type { JobRow } from "@/server/jobs/processor";
import { makeRetryable, makeNonRetryable } from "@/server/providers/errors";
import { resetServerEnvCache } from "@/env";

function withEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
  process.env.JOB_PROCESSOR_SECRET = "job-processor-secret-0123456789abcdef";
  resetServerEnvCache();
}

afterEach(() => {
  vi.restoreAllMocks();
  resetServerEnvCache();
});

function jobRow(overrides: Partial<Record<string, unknown>> = {}): JobRow {
  return {
    id: "job-1",
    job_type: "enhance_only",
    prompt_session_id: null,
    prompt_revision_id: null,
    generation_attempt_id: null,
    status: "processing",
    payload: {
      telegram_user_id: "123",
      telegram_chat_id: "456",
      source_prompt: "kucing oren",
    },
    attempt_count: 1,
    max_attempts: 3,
    available_at: "2026-01-01T00:00:00Z",
    locked_at: "2026-01-01T00:00:00Z",
    locked_by: "processor-abc",
    lease_expires_at: "2026-01-01T01:00:00Z",
    last_error_code: null,
    last_error_message_redacted: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  } as JobRow;
}

function buildHandler(
  overrides: {
    enhanceOutcome?: unknown;
    enhanceError?: unknown;
    retryResult?: boolean;
  } = {},
) {
  const enhancePrompt = {
    enhanceOnly: vi.fn(async () => {
      if (overrides.enhanceError) throw overrides.enhanceError;
      return (
        overrides.enhanceOutcome ?? {
          prompt: { prompt: "kucing oren yang megah", negative_prompt: "blur" },
          providerConfigId: "config-1",
        }
      );
    }),
  };
  const markSucceeded = vi.fn(async () => {});
  const markFailed = vi.fn(async () => {});
  const markRetryScheduled = vi.fn(async () => {});
  const retry = {
    apply: vi.fn(async () => overrides.retryResult ?? false),
  };
  const sentMessages: { chatId: bigint; text: string }[] = [];
  const handler = new EnhancePromptOnlyHandler({
    enhancePrompt: enhancePrompt as never,
    jobRepository: {
      markSucceeded,
      markFailed,
      markRetryScheduled,
    } as never,
    retry: retry as never,
    sendMessage: vi.fn(async (_token: string, chatId: bigint, text: string) => {
      sentMessages.push({ chatId, text });
    }),
  });
  return {
    handler,
    enhancePrompt,
    markSucceeded,
    markFailed,
    markRetryScheduled,
    retry,
    sentMessages,
  };
}

describe("EnhancePromptOnlyHandler", () => {
  it("replies with the enhanced prompt and succeeds", async () => {
    withEnv();
    const { handler, markSucceeded, markFailed, sentMessages } = buildHandler();
    await handler.handle(jobRow(), "worker-1");

    expect(markSucceeded).toHaveBeenCalledWith("job-1", "worker-1");
    expect(markFailed).not.toHaveBeenCalled();
    const reply = sentMessages.find((m) => m.text.includes("Prompt hasil penyempurnaan"));
    expect(reply).toBeDefined();
    expect(reply!.text).toContain("kucing oren yang megah");
    expect(reply!.text).toContain("Negative prompt: blur");
    expect(reply!.chatId).toBe(456n);
  });

  it("fails fast on a malformed payload without retry", async () => {
    withEnv();
    const { handler, enhancePrompt, markSucceeded, markFailed, retry, sentMessages } =
      buildHandler();
    await handler.handle(jobRow({ payload: { telegram_user_id: "123" } }), "worker-1");

    expect(enhancePrompt.enhanceOnly).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith("job-1", "worker-1", expect.anything());
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(retry.apply).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(0);
  });

  it("fails fast on non-numeric ids instead of throwing into retry", async () => {
    withEnv();
    const { handler, enhancePrompt, markSucceeded, markFailed, retry, sentMessages } =
      buildHandler();
    await handler.handle(
      jobRow({ payload: { telegram_user_id: "abc", telegram_chat_id: "456", source_prompt: "x" } }),
      "worker-1",
    );

    expect(enhancePrompt.enhanceOnly).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith("job-1", "worker-1", expect.anything());
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(retry.apply).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(0);
  });

  it("retries a retryable provider error and sends nothing yet", async () => {
    withEnv();
    const { handler, markSucceeded, markRetryScheduled, retry, sentMessages } = buildHandler({
      enhanceError: makeRetryable("provider_rate_limited", "rate limited", { httpStatus: 429 }),
      retryResult: true,
    });
    await handler.handle(jobRow(), "worker-1");

    expect(retry.apply).toHaveBeenCalled();
    expect(markRetryScheduled).toBeDefined();
    expect(markSucceeded).not.toHaveBeenCalled();
    expect(sentMessages).toHaveLength(0);
  });

  it("sends a plain failure message on terminal failure", async () => {
    withEnv();
    const { handler, markSucceeded, retry, sentMessages } = buildHandler({
      enhanceError: makeNonRetryable("provider_response_invalid", "invalid output"),
      retryResult: false,
    });
    await handler.handle(jobRow(), "worker-1");

    expect(retry.apply).toHaveBeenCalled();
    expect(markSucceeded).not.toHaveBeenCalled();
    const failure = sentMessages.find((m) => m.text.includes("Gagal menyempurnakan prompt"));
    expect(failure).toBeDefined();
  });
});
