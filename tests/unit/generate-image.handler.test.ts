import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerateImageHandler } from "@/server/jobs/generate-image.handler";
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
    job_type: "generate_image",
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
    retryResult?: boolean;
    session?: { id: string; telegramStatusMessageId: number | null };
  } = {},
) {
  const generateImage = {
    execute: vi.fn(
      async () =>
        overrides.outcome ?? {
          status: "completed",
          session: {},
          attempt: { id: "attempt-1" },
        },
    ),
  } as unknown as { execute: ReturnType<typeof vi.fn> };

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

  const editStatusMessage = vi.fn(async () => {});

  const handler = new GenerateImageHandler({
    generateImage: generateImage as never,
    sessionRepository: {
      getById: vi.fn(
        async () =>
          overrides.session ?? {
            id: "session-1",
            telegramUserId: 123n,
            telegramChatId: 456n,
            status: "generating",
            activeRevisionId: null,
            activeGenerationAttemptId: null,
            telegramStatusMessageId: 777,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            expiresAt: "2099-01-01T00:00:00Z",
            completedAt: null,
          },
      ),
    } as never,
    jobRepository: jobRepository as never,
    retry: retry as never,
    editStatusMessage,
  });

  return { handler, generateImage, jobRepository, retry, editStatusMessage };
}

describe("GenerateImageHandler", () => {
  it("completes the job on a successful generation", async () => {
    withEnv();
    const { handler, jobRepository } = buildHandler({ outcome: { status: "completed" } });
    await handler.handle(jobRow(), "processor-abc");
    expect(jobRepository.markSucceeded).toHaveBeenCalledWith("job-1", "processor-abc");
  });

  it("marks the job failed (terminal) on an expired session without provider call", async () => {
    withEnv();
    const { handler, generateImage, jobRepository, editStatusMessage } = buildHandler({
      outcome: { status: "expired" },
    });
    await handler.handle(jobRow({ generation_attempt_id: "attempt-1" }), "processor-abc");
    expect(generateImage.execute).toHaveBeenCalled();
    expect(jobRepository.markFailed).toHaveBeenCalledWith(
      "job-1",
      "processor-abc",
      expect.objectContaining({ errorCode: "session_expired" }),
    );
    expect(editStatusMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru.",
      }),
    );
  });

  it("retries a retryable provider error via retry.apply without transitioning the session", async () => {
    withEnv();
    const retryable = makeRetryable("provider_timeout", "timeout");
    rpcMock.transition = null;
    const { handler, generateImage, retry } = buildHandler({
      error: retryable,
      retryResult: true,
    });
    generateImage.execute.mockRejectedValue(retryable);

    await handler.handle(jobRow({ generation_attempt_id: "attempt-1" }), "processor-abc");

    expect(retry.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "processor-abc",
      expect.objectContaining({ code: "provider_timeout", retryable: true }),
    );
    // Retried jobs do not transition the session to generation_failed.
    expect(rpcMock.calls).toEqual([]);
  });

  it("goes terminal on a non-retryable provider error and transitions the session to generation_failed", async () => {
    withEnv();
    const nonRetryable = makeNonRetryable("provider_authentication_failed", "bad key");
    rpcMock.transition = { id: "session-1" };

    const { handler, generateImage, retry, editStatusMessage } = buildHandler({
      error: nonRetryable,
      retryResult: false,
    });
    generateImage.execute.mockRejectedValue(nonRetryable);

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
        p_expected_status: "generating",
        p_new_status: "generation_failed",
      },
    });
    expect(editStatusMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.",
      }),
    );
  });

  it("edits the status to the content-policy message on a refusal", async () => {
    withEnv();
    const refused = makeNonRetryable("provider_content_rejected", "content policy");
    rpcMock.transition = { id: "session-1" };

    const { handler, generateImage, retry, editStatusMessage } = buildHandler({
      error: refused,
      retryResult: false,
    });
    generateImage.execute.mockRejectedValue(refused);

    await handler.handle(jobRow(), "processor-abc");

    expect(retry.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-1" }),
      "processor-abc",
      expect.objectContaining({ code: "provider_content_rejected", retryable: false }),
    );
    expect(editStatusMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Prompt ditolak karena kebijakan konten provider. Ubah prompt dan coba lagi.",
      }),
    );
  });
});
