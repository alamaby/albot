import { afterEach, describe, expect, it, vi } from "vitest";
import { EnhancePromptHandler } from "@/server/jobs/enhance-prompt.handler";
import type { JobRow } from "@/server/jobs/processor";
import { makeRetryable, makeNonRetryable } from "@/server/providers/errors";
import { resetServerEnvCache } from "@/env";

const rpcMock = vi.hoisted(() => ({
  transition: null as unknown,
  calls: [] as { rpcName: string; args: Record<string, unknown> }[],
}));

vi.mock("@/server/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: (rpcName: string, args: Record<string, unknown>) => {
      rpcMock.calls.push({ rpcName, args });
      return {
        maybeSingle: vi.fn(async () => ({ data: rpcMock.transition, error: null })),
      };
    },
  }),
}));

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
  rpcMock.transition = null;
  rpcMock.calls.length = 0;
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
    retryResult?: boolean;
    session?: { id: string; telegramChatId: bigint };
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
    apply: vi.fn(async () => overrides.retryResult ?? true),
  } as unknown as { apply: ReturnType<typeof vi.fn> };

  const sendRetryMessage = vi.fn(async () => {});

  const handler = new EnhancePromptHandler({
    enhancePrompt: enhancePrompt as never,
    enhancementRepository: {
      markRevisionFailed,
    } as never,
    sessionRepository: {
      getById: vi.fn(
        async () =>
          overrides.session ?? {
            id: "session-1",
            telegramUserId: 123n,
            telegramChatId: 456n,
            status: "enhancing",
            activeRevisionId: "revision-1",
            activeGenerationAttemptId: null,
            telegramStatusMessageId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            expiresAt: "2026-01-02T00:00:00Z",
            completedAt: null,
          },
      ),
    } as never,
    jobRepository: jobRepository as never,
    retry: retry as never,
    sendRetryMessage,
  });

  return { handler, enhancePrompt, markRevisionFailed, jobRepository, retry, sendRetryMessage };
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

  it("retries a retryable provider error via retry.apply without transitioning the session", async () => {
    withEnv();
    const retryable = makeRetryable("provider_timeout", "timeout");
    const { handler, enhancePrompt, retry, markRevisionFailed, sendRetryMessage } = buildHandler({
      error: retryable,
      retryResult: true,
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
    // Retried jobs do not transition the session to enhancement_failed.
    expect(rpcMock.calls).toEqual([]);
    expect(sendRetryMessage).not.toHaveBeenCalled();
  });

  it("goes terminal on a non-retryable provider error and transitions the session to enhancement_failed", async () => {
    withEnv();
    const nonRetryable = makeNonRetryable("provider_authentication_failed", "bad key");
    rpcMock.transition = { id: "session-1" };

    const { handler, enhancePrompt, retry, sendRetryMessage } = buildHandler({
      error: nonRetryable,
      retryResult: false,
    });
    enhancePrompt.execute.mockRejectedValue(nonRetryable);

    await handler.handle(jobRow(), "processor-abc");

    expect(retry.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "processor-abc",
      expect.objectContaining({ code: "provider_authentication_failed", retryable: false }),
    );
    expect(rpcMock.calls).toContainEqual({
      rpcName: "transition_prompt_session",
      args: {
        p_session_id: "session-1",
        p_expected_status: "enhancing",
        p_new_status: "enhancement_failed",
      },
    });
    expect(sendRetryMessage).toHaveBeenCalledWith(
      expect.objectContaining({ session: expect.objectContaining({ id: "session-1" }) }),
    );
  });

  it("surfaces content-policy refusal with contentPolicy=true so the user gets a Prompt Baru button", async () => {
    withEnv();
    const refused = makeNonRetryable("provider_content_rejected", "content policy");
    rpcMock.transition = { id: "session-1" };

    const { handler, enhancePrompt, retry, sendRetryMessage } = buildHandler({
      error: refused,
      retryResult: false,
    });
    enhancePrompt.execute.mockRejectedValue(refused);

    await handler.handle(jobRow(), "processor-abc");

    expect(retry.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "processor-abc",
      expect.objectContaining({ code: "provider_content_rejected", retryable: false }),
    );
    expect(sendRetryMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: "session-1" }),
        contentPolicy: true,
      }),
    );
  });
});
