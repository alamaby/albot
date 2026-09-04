import { afterEach, describe, expect, it, vi } from "vitest";
import { runRecovery } from "@/server/jobs/recovery";
import { getSupabaseAdmin } from "@/server/supabase/admin";
import { resetServerEnvCache } from "@/env";

function withEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-placeholder-value-1234567890";
  process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.TELEGRAM_BOT_TOKEN = "123456789:AAExamplebotToken000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
  process.env.JOB_PROCESSOR_SECRET = "job-processor-secret-0123456789abcdef";
  resetServerEnvCache();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetServerEnvCache();
});

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    job_type: "enhance_prompt",
    prompt_session_id: "session-1",
    prompt_revision_id: "revision-1",
    generation_attempt_id: null,
    status: "queued",
    payload: {},
    attempt_count: 1,
    max_attempts: 3,
    available_at: "2026-01-01T00:00:00Z",
    locked_at: null,
    locked_by: null,
    lease_expires_at: null,
    last_error_code: null,
    last_error_message_redacted: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

function sessionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "session-1",
    telegram_user_id: 123456789,
    telegram_chat_id: 123456789,
    status: "awaiting_confirmation",
    active_revision_id: null,
    active_generation_attempt_id: null,
    telegram_status_message_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("runRecovery", () => {
  it("runs all four sweeps and records events", async () => {
    withEnv();
    const admin = getSupabaseAdmin();

    // expireStaleLeases returns one job; markDeadJobs returns one job;
    // recoverStaleSessions returns one session; purge returns a count.
    const rpcMock: (fn: string, args?: unknown) => unknown = (fn: string) => {
      switch (fn) {
        case "expire_job_leases":
          return { select: vi.fn(() => Promise.resolve({ data: [jobRow()], error: null })) };
        case "recover_stuck_generating_sessions":
          return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        case "recover_stuck_received_sessions":
          return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        case "mark_dead_jobs":
          return {
            select: vi.fn(() =>
              Promise.resolve({
                data: [jobRow({ id: "job-2", last_error_code: "dead_job" })],
                error: null,
              }),
            ),
          };
        case "recover_stale_sessions":
          return { select: vi.fn(() => Promise.resolve({ data: [sessionRow()], error: null })) };
        case "purge_expired_metadata":
          return {
            single: vi.fn(() => Promise.resolve({ data: { purged_rows: 7 }, error: null })),
          };
        case "purge_prompt_audit":
          return {
            single: vi.fn(() => Promise.resolve({ data: { purged_rows: 3 }, error: null })),
          };
        default:
          throw new Error(`unexpected rpc: ${fn}`);
      }
    };
    const rpc = vi.spyOn(admin, "rpc").mockImplementation(rpcMock as never);

    const insert = vi.fn(() => Promise.resolve({ error: null }));
    vi.spyOn(admin, "from").mockReturnValue({ insert } as never);

    const sendMessage = vi.fn(() => Promise.resolve({ ok: true }));

    const result = await runRecovery({
      sendTelegramMessage: sendMessage as never,
      processNextJob: vi.fn(async () => ({ status: "idle" as const })),
    });

    expect(result).toEqual({
      recoveredLeases: 1,
      deadJobsMarked: 1,
      staleSessionsExpired: 1,
      recoveredStuckGenerating: 0,
      recoveredStuckReceived: 0,
      purgedRows: 7,
      promptAuditPurgedRows: 3,
      claimedJobs: 0,
    });

    // Two event rows (lease_expired + failed/dead_job) + no other inserts.
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "lease_expired" }));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "failed",
        payload: expect.objectContaining({ deadJob: true }),
      }),
    );

    // One Telegram notification for the expired session.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.any(String),
      BigInt(123456789),
      expect.stringContaining("Sesi telah berakhir"),
    );
    void rpc;
  });

  it("continues when session notification fails (best-effort)", async () => {
    withEnv();
    const admin = getSupabaseAdmin();
    const rpcMock: (fn: string, args?: unknown) => unknown = (fn: string) => {
      switch (fn) {
        case "expire_job_leases":
          return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        case "recover_stuck_generating_sessions":
          return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        case "recover_stuck_received_sessions":
          return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        case "mark_dead_jobs":
          return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
        case "recover_stale_sessions":
          return { select: vi.fn(() => Promise.resolve({ data: [sessionRow()], error: null })) };
        case "purge_expired_metadata":
          return {
            single: vi.fn(() => Promise.resolve({ data: { purged_rows: 0 }, error: null })),
          };
        case "purge_prompt_audit":
          return {
            single: vi.fn(() => Promise.resolve({ data: { purged_rows: 0 }, error: null })),
          };
        default:
          throw new Error(`unexpected rpc: ${fn}`);
      }
    };
    vi.spyOn(admin, "rpc").mockImplementation(rpcMock as never);
    vi.spyOn(admin, "from").mockReturnValue({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    } as never);

    const sendMessage = vi.fn(() => Promise.reject(new Error("telegram down")));
    const result = await runRecovery({
      sendTelegramMessage: sendMessage as never,
      processNextJob: vi.fn(async () => ({ status: "idle" as const })),
    });

    expect(result.staleSessionsExpired).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
