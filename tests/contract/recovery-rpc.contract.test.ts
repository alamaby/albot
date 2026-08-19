import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip } from "../helpers/hosted";

const skip = assertHostedOrSkip();

const cleanup: {
  table: "jobs" | "prompt_sessions" | "prompt_revisions" | "generation_attempts";
  id: string;
}[] = [];

// Test-tagged session users are in 557xxxxxx to isolate from other suites.
const TEST_USER_BASE = 557000000;

beforeAll(async () => {
  if (skip) return;
  const admin = getAdminClient();
  // Clean any leftover test-tagged jobs from interrupted runs.
  await admin.from("jobs").delete().like("payload->>test_tag", "rc_%");
  const staleSessions = await admin
    .from("prompt_sessions")
    .select("id")
    .gte("telegram_user_id", String(TEST_USER_BASE))
    .lte("telegram_user_id", String(TEST_USER_BASE + 999999));
  for (const session of staleSessions.data ?? []) {
    await admin
      .from("prompt_sessions")
      .update({ active_generation_attempt_id: null, active_revision_id: null })
      .eq("id", session.id as never);
    await admin
      .from("jobs")
      .delete()
      .eq("prompt_session_id", session.id as never);
    await admin
      .from("generation_attempts")
      .delete()
      .eq("session_id", session.id as never);
    await admin
      .from("prompt_revisions")
      .delete()
      .eq("session_id", session.id as never);
    await admin
      .from("prompt_sessions")
      .delete()
      .eq("id", session.id as never);
  }
});

afterEach(async () => {
  const admin = getAdminClient();
  for (const item of cleanup.filter((c) => c.table === "prompt_sessions")) {
    await admin
      .from("prompt_sessions")
      .update({ active_generation_attempt_id: null, active_revision_id: null })
      .eq("id", item.id as never);
  }
  for (const item of cleanup.reverse()) {
    await admin
      .from(item.table)
      .delete()
      .eq("id", item.id as never);
  }
  cleanup.length = 0;
});

let userCounter = TEST_USER_BASE + 1;

async function insertSession(overrides: Record<string, unknown> = {}) {
  const admin = getAdminClient();
  const userId = userCounter++;
  const now = new Date().toISOString();
  const { data: session, error: sessionError } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: userId,
      telegram_chat_id: userId + 1,
      created_at: now,
      expires_at: "2099-01-01T00:00:00.000Z",
      ...overrides,
    })
    .select("id")
    .single();
  expect(sessionError).toBeNull();
  cleanup.push({ table: "prompt_sessions", id: session!.id });
  return session!.id;
}

async function insertJob(overrides: Record<string, unknown> = {}) {
  const admin = getAdminClient();
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      job_type: "enhance_prompt",
      status: "queued",
      payload: { test_tag: `rc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
      max_attempts: 3,
      ...overrides,
    } as never)
    .select("id")
    .single();
  expect(error).toBeNull();
  cleanup.push({ table: "jobs", id: job!.id });
  return job!.id;
}

describe.skipIf(skip)("recovery RPC contract", () => {
  it("expire_job_leases recovers an expired-lease job and leaves live leases alone", async () => {
    const admin = getAdminClient();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    const expiredJob = await insertJob({
      status: "processing",
      locked_at: past,
      locked_by: "stale-worker",
      lease_expires_at: past,
      attempt_count: 1,
    });
    const liveJob = await insertJob({
      status: "processing",
      locked_at: new Date().toISOString(),
      locked_by: "live-worker",
      lease_expires_at: future,
      attempt_count: 1,
    });

    const { data, error } = await admin.rpc("expire_job_leases", {
      p_max_jobs: 10,
    });
    expect(error).toBeNull();
    const recovered = (data as unknown as { id: string }[]) ?? [];
    expect(recovered.map((r) => r.id)).toContain(expiredJob);
    expect(recovered.map((r) => r.id)).not.toContain(liveJob);

    const { data: expiredRow } = await admin
      .from("jobs")
      .select("status, attempt_count, locked_at, locked_by, last_error_code")
      .eq("id", expiredJob)
      .single();
    expect(expiredRow).toMatchObject({
      status: "queued",
      attempt_count: 2,
      locked_at: null,
      locked_by: null,
      last_error_code: "lease_expired",
    });
    // available_at must be in the future (not hot-looped).
    const { data: expiredFull } = await admin
      .from("jobs")
      .select("available_at")
      .eq("id", expiredJob)
      .single();
    expect(new Date(expiredFull?.available_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("mark_dead_jobs terminal-fails maxed-out jobs and skips claimable ones", async () => {
    const admin = getAdminClient();
    const maxed = await insertJob({
      status: "retry_scheduled",
      attempt_count: 3,
      max_attempts: 3,
      available_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const claimable = await insertJob({
      status: "queued",
      attempt_count: 1,
      max_attempts: 3,
      available_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const { data, error } = await admin.rpc("mark_dead_jobs", {
      p_max_jobs: 10,
    });
    expect(error).toBeNull();
    const marked = (data as unknown as { id: string }[]) ?? [];
    expect(marked.map((r) => r.id)).toContain(maxed);
    expect(marked.map((r) => r.id)).not.toContain(claimable);

    const { data: maxedRow } = await admin
      .from("jobs")
      .select("status, last_error_code, completed_at")
      .eq("id", maxed)
      .single();
    expect(maxedRow).toMatchObject({
      status: "failed",
      last_error_code: "dead_job",
    });
    expect(maxedRow?.completed_at).toBeTruthy();

    const { data: claimableRow } = await admin
      .from("jobs")
      .select("status")
      .eq("id", claimable)
      .single();
    expect(claimableRow?.status).toBe("queued");
  });

  it("recover_stale_sessions expires only non-terminal sessions past expires_at", async () => {
    const admin = getAdminClient();
    // The RPC selects the globally oldest expired sessions (limit p_max_sessions),
    // so the stale fixture uses an expires_at far in the past to outrank any
    // leftover dev data. created_at must precede expires_at (check constraint).
    const staleId = await insertSession({
      created_at: new Date(Date.now() - 41 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const liveId = await insertSession({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    // Terminal session past expiry must not be touched.
    const terminalId = await insertSession({
      created_at: new Date(Date.now() - 41 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      status: "completed",
    });

    const { data, error } = await admin.rpc("recover_stale_sessions", {
      p_max_sessions: 100,
    });
    expect(error).toBeNull();
    const expired = (data as unknown as { id: string }[]) ?? [];
    expect(expired.map((r) => r.id)).toContain(staleId);
    expect(expired.map((r) => r.id)).not.toContain(liveId);
    expect(expired.map((r) => r.id)).not.toContain(terminalId);

    const { data: staleRow } = await admin
      .from("prompt_sessions")
      .select("status")
      .eq("id", staleId)
      .single();
    expect(staleRow?.status).toBe("expired");

    const { data: liveRow } = await admin
      .from("prompt_sessions")
      .select("status")
      .eq("id", liveId)
      .single();
    expect(liveRow?.status).not.toBe("expired");
  });

  it("purge_expired_metadata deletes old terminal lineage and keeps active data", async () => {
    const admin = getAdminClient();
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
    const oldExpiry = new Date(Date.now() - 39 * 24 * 60 * 60 * 1000).toISOString();

    // Old terminal session with a revision and a job.
    const oldSessionId = await insertSession({
      status: "completed",
      created_at: oldDate,
      expires_at: oldExpiry,
    });
    // Active session (non-terminal) must survive.
    const activeSessionId = await insertSession({
      created_at: oldDate,
      expires_at: "2099-01-01T00:00:00.000Z",
    });

    const { data: oldRevision } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: oldSessionId,
        revision_number: 1,
        source_prompt: "old prompt",
        status: "completed",
        created_at: oldDate,
      } as never)
      .select("id")
      .single();
    expect(oldRevision).toBeTruthy();
    cleanup.push({ table: "prompt_revisions", id: oldRevision!.id });

    await insertJob({
      prompt_session_id: oldSessionId,
      created_at: oldDate,
      status: "succeeded",
      attempt_count: 1,
      max_attempts: 3,
    });

    const { data, error } = await admin.rpc("purge_expired_metadata", {
      p_retention_days: 30,
      p_max_rows: 100,
    });
    expect(error).toBeNull();
    expect(Number((data as unknown as { purged_rows: number }[])[0].purged_rows)).toBeGreaterThan(
      0,
    );

    const { data: oldSession } = await admin
      .from("prompt_sessions")
      .select("id")
      .eq("id", oldSessionId)
      .maybeSingle();
    expect(oldSession).toBeNull();

    const { data: activeSession } = await admin
      .from("prompt_sessions")
      .select("id")
      .eq("id", activeSessionId)
      .single();
    expect(activeSession?.id).toBe(activeSessionId);
  });

  it("purge_expired_metadata nulls active pointers before deleting children (FK fix)", async () => {
    const admin = getAdminClient();
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const oldExpiry = new Date(Date.now() - 39 * 24 * 60 * 60 * 1000).toISOString();

    // Terminal session that generated an image: it retains active pointers to a
    // revision and a generation attempt (FK on delete restrict).
    const oldSessionId = await insertSession({
      status: "completed",
      created_at: oldDate,
      expires_at: oldExpiry,
    });

    const { data: oldRevision } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: oldSessionId,
        revision_number: 1,
        source_prompt: "old prompt",
        status: "completed",
        created_at: oldDate,
      } as never)
      .select("id")
      .single();
    expect(oldRevision).toBeTruthy();
    cleanup.push({ table: "prompt_revisions", id: oldRevision!.id });

    const { data: oldAttempt } = await admin
      .from("generation_attempts")
      .insert({
        session_id: oldSessionId,
        revision_id: oldRevision!.id,
        attempt_number: 1,
        status: "succeeded",
        created_at: oldDate,
      } as never)
      .select("id")
      .single();
    expect(oldAttempt).toBeTruthy();
    cleanup.push({ table: "generation_attempts", id: oldAttempt!.id });

    // Point the session at both children (the state a real completed session
    // keeps until purge).
    const { error: pointerError } = await admin
      .from("prompt_sessions")
      .update({
        active_revision_id: oldRevision!.id,
        active_generation_attempt_id: oldAttempt!.id,
      })
      .eq("id", oldSessionId);
    expect(pointerError).toBeNull();

    // Active session with a fresh revision must survive and keep its pointer.
    const activeSessionId = await insertSession({
      created_at: oldDate,
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const { data: activeRevision } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: activeSessionId,
        revision_number: 1,
        source_prompt: "active prompt",
        status: "completed",
        created_at: oldDate,
      } as never)
      .select("id")
      .single();
    expect(activeRevision).toBeTruthy();
    cleanup.push({ table: "prompt_revisions", id: activeRevision!.id });
    const { error: activePointerError } = await admin
      .from("prompt_sessions")
      .update({ active_revision_id: activeRevision!.id })
      .eq("id", activeSessionId);
    expect(activePointerError).toBeNull();

    const { data, error } = await admin.rpc("purge_expired_metadata", {
      p_retention_days: 30,
      p_max_rows: 100,
    });
    expect(error).toBeNull();
    expect(Number((data as unknown as { purged_rows: number }[])[0].purged_rows)).toBeGreaterThan(
      0,
    );

    const { data: oldSession } = await admin
      .from("prompt_sessions")
      .select("id")
      .eq("id", oldSessionId)
      .maybeSingle();
    expect(oldSession).toBeNull();

    const { data: activeSession } = await admin
      .from("prompt_sessions")
      .select("id, active_revision_id")
      .eq("id", activeSessionId)
      .single();
    expect(activeSession?.id).toBe(activeSessionId);
    expect(activeSession?.active_revision_id).toBe(activeRevision!.id);
  });

  it("purge_expired_metadata handles a cancelled session with only an active revision", async () => {
    const admin = getAdminClient();
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const oldExpiry = new Date(Date.now() - 39 * 24 * 60 * 60 * 1000).toISOString();

    // Cancelled before generation: session keeps active_revision_id only.
    const cancelledId = await insertSession({
      status: "cancelled",
      created_at: oldDate,
      expires_at: oldExpiry,
    });

    const { data: revision } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: cancelledId,
        revision_number: 1,
        source_prompt: "cancelled prompt",
        status: "completed",
        created_at: oldDate,
      } as never)
      .select("id")
      .single();
    expect(revision).toBeTruthy();
    cleanup.push({ table: "prompt_revisions", id: revision!.id });

    const { error: pointerError } = await admin
      .from("prompt_sessions")
      .update({ active_revision_id: revision!.id })
      .eq("id", cancelledId);
    expect(pointerError).toBeNull();

    const { error } = await admin.rpc("purge_expired_metadata", {
      p_retention_days: 30,
      p_max_rows: 100,
    });
    expect(error).toBeNull();

    const { data: cancelledSession } = await admin
      .from("prompt_sessions")
      .select("id")
      .eq("id", cancelledId)
      .maybeSingle();
    expect(cancelledSession).toBeNull();
  });

  it("mark_dead_jobs catches processing jobs with expired lease and exhausted attempts", async () => {
    const admin = getAdminClient();
    const past = new Date(Date.now() - 60_000).toISOString();

    // Processing + expired lease + attempt_count == max_attempts: expire_job_leases
    // must skip it (filter attempt_count < max_attempts), mark_dead_jobs must fail it.
    const exhausted = await insertJob({
      status: "processing",
      locked_at: past,
      locked_by: "stale-worker",
      lease_expires_at: past,
      attempt_count: 3,
      max_attempts: 3,
    });

    // expire_job_leases first: must NOT touch the exhausted job.
    const expire = await admin.rpc("expire_job_leases", {
      p_max_jobs: 10,
    });
    expect(expire.error).toBeNull();
    const recovered = (expire.data as unknown as { id: string }[]) ?? [];
    expect(recovered.map((r) => r.id)).not.toContain(exhausted);

    const { data: stillProcessing } = await admin
      .from("jobs")
      .select("status")
      .eq("id", exhausted)
      .single();
    expect(stillProcessing?.status).toBe("processing");

    // mark_dead_jobs then: must terminal-fail it.
    const dead = await admin.rpc("mark_dead_jobs", {
      p_max_jobs: 10,
    });
    expect(dead.error).toBeNull();
    const marked = (dead.data as unknown as { id: string }[]) ?? [];
    expect(marked.map((r) => r.id)).toContain(exhausted);

    const { data: deadRow } = await admin
      .from("jobs")
      .select("status, last_error_code")
      .eq("id", exhausted)
      .single();
    expect(deadRow).toMatchObject({ status: "failed", last_error_code: "dead_job" });
  });
});
