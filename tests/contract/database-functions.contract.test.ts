import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip } from "../helpers/hosted";
import type { Json } from "@/server/supabase/database.types";

const skip = assertHostedOrSkip();

const cleanup: { table: "jobs" | "prompt_sessions"; id: string }[] = [];

// Remove leftover test-tagged jobs from interrupted runs so claim_job's global
// ordering cannot pick up unrelated fixtures.
beforeAll(async () => {
  if (skip) return;
  const admin = getAdminClient();
  await admin.from("jobs").delete().like("payload->>test_tag", "ct_%");
  await admin.from("jobs").delete().like("payload->>test_tag", "sr_%");
});

afterEach(async () => {
  const admin = getAdminClient();
  for (const item of cleanup.reverse()) {
    await admin
      .from(item.table)
      .delete()
      .eq("id", item.id as never);
  }
  cleanup.length = 0;
});

function tag(): string {
  return `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function insertJob(payload: Json, extra: Record<string, unknown> = {}) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .insert({ job_type: "reasoning_enhance", payload, ...extra })
    .select("id")
    .single();
  expect(error).toBeNull();
  cleanup.push({ table: "jobs", id: data!.id });
  return data!.id;
}

async function insertSession() {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: 555000001,
      telegram_chat_id: 555000002,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  cleanup.push({ table: "prompt_sessions", id: data!.id });
  return data!.id;
}

describe.skipIf(skip)("claim_job contract", () => {
  it("grants exactly one worker ownership of one queued job under concurrency", async () => {
    const jobId = await insertJob({ test_tag: tag() });

    const a = getAdminClient();
    const b = getAdminClient();
    const [ra, rb] = await Promise.all([
      a.rpc("claim_job", { p_worker_id: "worker-a", p_lease_seconds: 300 }),
      b.rpc("claim_job", { p_worker_id: "worker-b", p_lease_seconds: 300 }),
    ]);

    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();

    const won = (ra.data as { id: string }[]) ?? [];
    const lost = (rb.data as { id: string }[]) ?? [];
    expect(won.length + lost.length).toBe(1);
    const claimed = won.length === 1 ? won[0] : lost[0];
    const owner = won.length === 1 ? "worker-a" : "worker-b";
    expect(claimed.id).toBe(jobId);

    const { data: persisted } = await getAdminClient()
      .from("jobs")
      .select("status, attempt_count, locked_by")
      .eq("id", jobId)
      .single();
    expect(persisted).toMatchObject({
      status: "processing",
      attempt_count: 1,
      locked_by: owner,
    });
  });

  it("rejects claim of a not-yet-due job and an exhausted job", async () => {
    const t = tag();
    const futureId = await insertJob({ test_tag: t }, { available_at: "2099-01-01T00:00:00.000Z" });
    const exhaustedId = await insertJob(
      { test_tag: t },
      { attempt_count: 3, max_attempts: 3, available_at: "2000-01-01T00:00:00.000Z" },
    );

    const { data, error } = await getAdminClient().rpc("claim_job", {
      p_worker_id: "worker-c",
      p_lease_seconds: 300,
    });
    expect(error).toBeNull();
    const ids = (data as { id: string }[]) ?? [];
    expect(ids.map((r) => r.id)).not.toContain(futureId);
    expect(ids.map((r) => r.id)).not.toContain(exhaustedId);
  });

  it("recovers a job whose lease expired", async () => {
    const t = tag();
    const expiredId = await insertJob(
      { test_tag: t },
      {
        status: "processing",
        attempt_count: 1,
        max_attempts: 3,
        available_at: "2000-01-01T00:00:00.000Z",
        locked_at: "2000-01-01T00:00:00.000Z",
        locked_by: "dead-worker",
        lease_expires_at: "2000-01-01T00:00:00.000Z",
      },
    );

    const { data, error } = await getAdminClient().rpc("claim_job", {
      p_worker_id: "worker-recovery",
      p_lease_seconds: 300,
    });
    expect(error).toBeNull();
    const rows = (data as { id: string; locked_by: string }[]) ?? [];
    expect(rows.map((r) => r.id)).toContain(expiredId);
    expect(rows.find((r) => r.id === expiredId)?.locked_by).toBe("worker-recovery");
  });

  it("recovers a job whose lease expired even when available_at is in the future", async () => {
    const t = tag();
    const expiredId = await insertJob(
      { test_tag: t },
      {
        status: "processing",
        attempt_count: 1,
        max_attempts: 3,
        available_at: "2099-01-01T00:00:00.000Z",
        locked_at: "2000-01-01T00:00:00.000Z",
        locked_by: "dead-worker",
        lease_expires_at: "2000-01-01T00:00:00.000Z",
      },
    );

    const { data, error } = await getAdminClient().rpc("claim_job", {
      p_worker_id: "worker-recovery",
      p_lease_seconds: 300,
    });
    expect(error).toBeNull();
    const rows = (data as { id: string; locked_by: string }[]) ?? [];
    expect(rows.map((r) => r.id)).toContain(expiredId);
    expect(rows.find((r) => r.id === expiredId)?.locked_by).toBe("worker-recovery");
  });

  it("does not claim a retry_scheduled job whose available_at is in the future", async () => {
    const t = tag();
    const futureRetryId = await insertJob(
      { test_tag: t },
      { status: "retry_scheduled", available_at: "2099-01-01T00:00:00.000Z" },
    );
    const dueId = await insertJob(
      { test_tag: t },
      { status: "retry_scheduled", available_at: "2000-01-01T00:00:00.000Z" },
    );
    const { data, error } = await getAdminClient().rpc("claim_job", {
      p_worker_id: "worker-order",
      p_lease_seconds: 300,
    });
    expect(error).toBeNull();
    const ids = ((data as { id: string }[]) ?? []).map((r) => r.id);
    expect(ids).toContain(dueId);
    expect(ids).not.toContain(futureRetryId);
  });

  it("claims the globally earliest due job deterministically", async () => {
    const t = tag();
    const lateId = await insertJob({ test_tag: t }, { available_at: "2000-01-01T00:00:01.000Z" });
    const earlyId = await insertJob({ test_tag: t }, { available_at: "2000-01-01T00:00:00.000Z" });
    const { data, error } = await getAdminClient().rpc("claim_job", {
      p_worker_id: "worker-earliest",
      p_lease_seconds: 300,
    });
    expect(error).toBeNull();
    const rows = (data as { id: string }[]) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(earlyId);
    expect(rows[0].id).not.toBe(lateId);
  });

  it("validates worker id and lease bounds", async () => {
    const client = getAdminClient();
    const badWorker = await client.rpc("claim_job", { p_worker_id: "", p_lease_seconds: 300 });
    expect(badWorker.error).not.toBeNull();
    const badLease = await client.rpc("claim_job", { p_worker_id: "w", p_lease_seconds: 0 });
    expect(badLease.error).not.toBeNull();
    const tooLongLease = await client.rpc("claim_job", {
      p_worker_id: "w",
      p_lease_seconds: 999999,
    });
    expect(tooLongLease.error).not.toBeNull();
  });
});

describe.skipIf(skip)("transition_prompt_session contract", () => {
  it("transitions on expected state and ignores stale callers", async () => {
    const sessionId = await insertSession();
    const client = getAdminClient();

    const ok = await client.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "received",
      p_new_status: "enhancing",
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toHaveLength(1);
    expect(ok.data![0]).toMatchObject({ id: sessionId, status: "enhancing" });

    const stale = await client.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "received",
      p_new_status: "generating",
    });
    expect(stale.error).toBeNull();
    expect(stale.data).toHaveLength(0);

    const { data: persisted } = await client
      .from("prompt_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(persisted?.status).toBe("enhancing");
  });

  it("sets completed_at when completing and rejects terminal-state exits", async () => {
    const sessionId = await insertSession();
    const client = getAdminClient();

    const enhancing = await client.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "received",
      p_new_status: "enhancing",
    });
    expect(enhancing.error).toBeNull();

    const done = await client.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "enhancing",
      p_new_status: "completed",
    });
    expect(done.error).toBeNull();
    expect(done.data).toHaveLength(1);
    expect(done.data![0].completed_at).toBeTruthy();

    const fromTerminal = await client.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "completed",
      p_new_status: "generating",
    });
    expect(fromTerminal.error).not.toBeNull();
  });

  it("rejects invalid status values", async () => {
    const sessionId = await insertSession();
    const client = getAdminClient();
    const bad = await client.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "received",
      p_new_status: "not_a_real_status",
    });
    expect(bad.error).not.toBeNull();
  });
});
