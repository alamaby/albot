import { afterEach, describe, expect, it, vi } from "vitest";
import { EnhancePromptHandler } from "@/server/jobs/enhance-prompt.handler";
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
    job_type: "enhance_prompt",
    prompt_session_id: "session-1",
    prompt_revision_id: "revision-1",
    generation_attempt_id: null,
    status: "processing",
    payload: {},
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
    outcome?: unknown;
    error?: unknown;
    markFailed?: ReturnType<typeof vi.fn>;
    markRetryScheduled?: ReturnType<typeof vi.fn>;
    markSucceeded?: ReturnType<typeof vi.fn>;
    markRevisionFailed?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const enhancePrompt = {
    execute: vi.fn(
      async () =>
        overrides.outcome ?? { status: "completed", session: {}, revision: {}, prompt: {} },
    ),
  } as unknown as { execute: ReturnType<typeof vi.fn> };

  const markRevisionFailed = overrides.markRevisionFailed ?? vi.fn(async () => {});

  const jobRepository = {
    markSucceeded: overrides.markSucceeded ?? vi.fn(async () => {}),
    markRetryScheduled: overrides.markRetryScheduled ?? vi.fn(async () => {}),
    markFailed: overrides.markFailed ?? vi.fn(async () => {}),
  } as unknown as {
    markSucceeded: ReturnType<typeof vi.fn>;
    markRetryScheduled: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };

  const retry = {
    apply: vi.fn(async () => true),
  } as unknown as { apply: ReturnType<typeof vi.fn> };

  const handler = new EnhancePromptHandler({
    enhancePrompt: enhancePrompt as never,
    enhancementRepository: {
      markRevisionFailed,
    } as never,
    sessionRepository: {} as never,
    jobRepository: jobRepository as never,
    retry: retry as never,
  });

  return { handler, enhancePrompt, markRevisionFailed, jobRepository, retry };
}

describe("EnhancePromptHandler", () => {
  it("completes the job on a successful enhancement", async () => {
    withEnv();
    const { handler, jobRepository } = buildHandler({ outcome: { status: "completed" } });
    await handler.handle(jobRow(), "processor-abc");
    expect(jobRepository.markSucceeded).toHaveBeenCalledWith("job-1", "processor-abc");
  });

  it("marks the job failed (terminal) on an expired session without provider call", async () => {
    withEnv();
    const { handler, enhancePrompt, jobRepository, markRevisionFailed } = buildHandler({
      outcome: { status: "expired" },
    });
    await handler.handle(jobRow(), "processor-abc");
    expect(enhancePrompt.execute).toHaveBeenCalled();
    expect(jobRepository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "processor-abc",
      expect.objectContaining({ errorCode: "session_expired" }),
    );
    expect(markRevisionFailed).toHaveBeenCalledWith(
      "revision-1",
      "session_expired",
      expect.any(String),
    );
  });

  it("retries a retryable provider error via retry.apply", async () => {
    withEnv();
    const retryable = makeRetryable("provider_timeout", "timeout");
    const { handler, enhancePrompt, retry, markRevisionFailed } = buildHandler({
      error: retryable,
    });
    enhancePrompt.execute.mockRejectedValue(retryable);

    await handler.handle(jobRow(), "processor-abc");

    expect(markRevisionFailed).toHaveBeenCalledWith(
      "revision-1",
      "provider_timeout",
      expect.any(String),
    );
    expect(retry.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "processor-abc",
      expect.objectContaining({ code: "provider_timeout", retryable: true }),
    );
  });

  it("goes terminal on a non-retryable provider error", async () => {
    withEnv();
    const nonRetryable = makeNonRetryable("provider_authentication_failed", "bad key");
    const { handler, enhancePrompt, retry } = buildHandler({ error: nonRetryable });
    enhancePrompt.execute.mockRejectedValue(nonRetryable);

    await handler.handle(jobRow(), "processor-abc");

    expect(retry.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "processor-abc",
      expect.objectContaining({ code: "provider_authentication_failed", retryable: false }),
    );
  });
});
