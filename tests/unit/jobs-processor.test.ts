import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateWorkerId,
  isRegisteredJobType,
  claimNextJob,
  rescheduleUnhandledJob,
  processNextJob,
} from "@/server/jobs/processor";
import { getSupabaseAdmin } from "@/server/supabase/admin";
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
    attempt_count: 0,
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

describe("generateWorkerId", () => {
  it("produces a prefixed unique worker id", () => {
    const a = generateWorkerId();
    const b = generateWorkerId();
    expect(a).toMatch(/^processor-[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});

describe("isRegisteredJobType", () => {
  it("reports enhance_prompt as unhandled in Milestone 3", () => {
    expect(isRegisteredJobType("enhance_prompt")).toBe(false);
  });

  it("reports unknown job types as unhandled", () => {
    expect(isRegisteredJobType("does_not_exist")).toBe(false);
  });
});

describe("claimNextJob", () => {
  it("claims the next due job via claim_job RPC", async () => {
    withEnv();
    const admin = getSupabaseAdmin();
    const rpcSpy = vi.spyOn(admin, "rpc").mockReturnValue({
      maybeSingle: vi.fn(() => Promise.resolve({ data: jobRow(), error: null })),
    } as never);

    const job = await claimNextJob("worker-1");
    expect(job?.id).toBe("job-1");
    expect(rpcSpy).toHaveBeenCalledWith("claim_job", {
      p_worker_id: "worker-1",
      p_lease_seconds: 300,
    });
  });

  it("returns null when nothing is claimable", async () => {
    withEnv();
    const admin = getSupabaseAdmin();
    vi.spyOn(admin, "rpc").mockReturnValue({
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    } as never);

    await expect(claimNextJob("worker-1")).resolves.toBeNull();
  });

  it("throws when claim_job errors", async () => {
    withEnv();
    const admin = getSupabaseAdmin();
    vi.spyOn(admin, "rpc").mockReturnValue({
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: { message: "boom" } })),
    } as never);

    await expect(claimNextJob("worker-1")).rejects.toThrow("claim_job failed");
  });
});

describe("rescheduleUnhandledJob", () => {
  it("reschedules a job owned by the worker instead of failing it", async () => {
    withEnv();
    const admin = getSupabaseAdmin();

    // Chainable .eq() supporting two chained calls; the final one resolves.
    const eqSecond = vi.fn(() => Promise.resolve({ error: null }));
    const eqFirst = vi.fn(() => ({ eq: eqSecond }));
    const updateMock = vi.fn(() => ({ eq: eqFirst }));
    vi.spyOn(admin, "from").mockReturnValue({ update: updateMock } as never);

    await expect(
      rescheduleUnhandledJob("job-1", "worker-1", "unknown_job_type"),
    ).resolves.toBeUndefined();

    expect(updateMock).toHaveBeenCalled();
    const args = (updateMock.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(args.status).toBe("retry_scheduled");
    expect(args.last_error_code).toBe("unknown_job_type");
    expect(args.locked_by).toBeNull();
    expect(new Date(args.available_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(eqFirst).toHaveBeenCalledWith("id", "job-1");
    expect(eqSecond).toHaveBeenCalledWith("locked_by", "worker-1");
  });
});

describe("processNextJob", () => {
  it("returns idle when no job is claimable", async () => {
    withEnv();
    const admin = getSupabaseAdmin();
    vi.spyOn(admin, "rpc").mockReturnValue({
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    } as never);

    await expect(processNextJob()).resolves.toEqual({ status: "idle" });
  });

  it("reschedules an unhandled job and reports processed", async () => {
    withEnv();
    const admin = getSupabaseAdmin();
    const rpcSpy = vi.spyOn(admin, "rpc").mockReturnValue({
      maybeSingle: vi.fn(() => Promise.resolve({ data: jobRow(), error: null })),
    } as never);

    const eqSecond = vi.fn(() => Promise.resolve({ error: null }));
    const eqFirst = vi.fn(() => ({ eq: eqSecond }));
    const updateMock = vi.fn(() => ({ eq: eqFirst }));
    vi.spyOn(admin, "from").mockReturnValue({ update: updateMock } as never);

    const result = await processNextJob();
    expect(result.status).toBe("processed");
    expect(result.jobId).toBe("job-1");
    expect(rpcSpy).toHaveBeenCalledWith("claim_job", expect.anything());
    expect(updateMock).toHaveBeenCalled();
    expect(eqFirst).toHaveBeenCalledWith("id", "job-1");
    expect(eqSecond).toHaveBeenCalledWith("locked_by", expect.stringMatching(/^processor-/));
  });
});
