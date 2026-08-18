import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip } from "../helpers/hosted";

const skip = assertHostedOrSkip();

const cleanup: {
  table: "generation_attempts" | "prompt_sessions" | "prompt_revisions";
  id: string;
}[] = [];

beforeAll(async () => {
  if (skip) return;
  const admin = getAdminClient();
  // Clean any leftover test-tagged jobs from interrupted runs.
  await admin.from("jobs").delete().like("payload->>test_tag", "ct_%");
  await admin.from("jobs").delete().like("payload->>test_tag", "sr_%");
  // Clean leftover fixtures from interrupted runs of this suite (FK-safe order)
  // so the partial unique index (one active session per user) cannot block
  // inserts.
  const staleSessions = await admin
    .from("prompt_sessions")
    .select("id")
    .gte("telegram_user_id", "556000000")
    .lte("telegram_user_id", "556999999");
  for (const session of staleSessions.data ?? []) {
    // Null the session's active pointers first (session -> attempt/revision FK
    // blocks child deletion otherwise).
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
  // Null the session's active pointers before deleting children (the session
  // FK references the attempt/revision, so children cannot be deleted while
  // the session still points at them).
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

let userIdCounter = 556000001;

async function insertSessionAndRevision() {
  const admin = getAdminClient();
  // Unique user per session so the partial unique index
  // (prompt_sessions_one_active_idx) never blocks a second active session for
  // the same user within one run.
  const userId = userIdCounter++;
  const { data: session, error: sessionError } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: userId,
      telegram_chat_id: userId + 1,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  expect(sessionError).toBeNull();
  cleanup.push({ table: "prompt_sessions", id: session!.id });

  const { data: revision, error: revisionError } = await admin
    .from("prompt_revisions")
    .insert({
      session_id: session!.id,
      revision_number: 1,
      source_prompt: "a test prompt",
      status: "completed",
    })
    .select("id")
    .single();
  expect(revisionError).toBeNull();
  cleanup.push({ table: "prompt_revisions", id: revision!.id });

  return { sessionId: session!.id, revisionId: revision!.id };
}

describe.skipIf(skip)("generation RPC contract", () => {
  it("creates attempts with monotonic numbering and repoints the active attempt", async () => {
    const admin = getAdminClient();
    const { sessionId, revisionId } = await insertSessionAndRevision();

    const first = await admin.rpc("create_generation_attempt", {
      p_session_id: sessionId,
      p_revision_id: revisionId,
    });
    expect(first.error).toBeNull();
    const firstRow = (first.data as unknown as { attempt_id: string; attempt_number: number }[])[0];
    expect(firstRow.attempt_number).toBe(1);
    cleanup.push({ table: "generation_attempts", id: firstRow.attempt_id });

    // Move to processing then mark succeeded so a second attempt is allowed.
    const { error: procError } = await admin
      .from("generation_attempts")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", firstRow.attempt_id);
    expect(procError).toBeNull();

    const mark = await admin.rpc("mark_generation_attempt_succeeded", {
      p_attempt_id: firstRow.attempt_id,
      p_provider_request_id: "req-1",
      p_telegram_message_id: 123,
    });
    expect(mark.error).toBeNull();

    const second = await admin.rpc("create_generation_attempt", {
      p_session_id: sessionId,
      p_revision_id: revisionId,
    });
    expect(second.error).toBeNull();
    const secondRow = (
      second.data as unknown as {
        attempt_id: string;
        attempt_number: number;
      }[]
    )[0];
    expect(secondRow.attempt_number).toBe(2);
    cleanup.push({ table: "generation_attempts", id: secondRow.attempt_id });

    const { data: session } = await admin
      .from("prompt_sessions")
      .select("active_generation_attempt_id")
      .eq("id", sessionId)
      .single();
    expect(session?.active_generation_attempt_id).toBe(secondRow.attempt_id);
  });

  it("rejects a new attempt while a generation is in progress", async () => {
    const admin = getAdminClient();
    const { sessionId, revisionId } = await insertSessionAndRevision();

    const first = await admin.rpc("create_generation_attempt", {
      p_session_id: sessionId,
      p_revision_id: revisionId,
    });
    expect(first.error).toBeNull();
    const firstRow = (first.data as unknown as { attempt_id: string }[])[0];
    cleanup.push({ table: "generation_attempts", id: firstRow.attempt_id });

    // Second attempt while first is queued/processing must fail.
    const second = await admin.rpc("create_generation_attempt", {
      p_session_id: sessionId,
      p_revision_id: revisionId,
    });
    expect(second.error).not.toBeNull();
  });

  it("mark_generation_attempt_failed only touches a processing attempt", async () => {
    const admin = getAdminClient();
    const { sessionId, revisionId } = await insertSessionAndRevision();

    const created = await admin.rpc("create_generation_attempt", {
      p_session_id: sessionId,
      p_revision_id: revisionId,
    });
    expect(created.error).toBeNull();
    const attemptId = (created.data as unknown as { attempt_id: string }[])[0].attempt_id;
    cleanup.push({ table: "generation_attempts", id: attemptId });

    // Attempt is queued: the guarded RPC must reject.
    const queuedFail = await admin.rpc("mark_generation_attempt_failed", {
      p_attempt_id: attemptId,
      p_error_code: "test",
      p_error_message_redacted: "test",
    });
    expect(queuedFail.error).not.toBeNull();

    // Move to processing then mark failed.
    const { error: procError } = await admin
      .from("generation_attempts")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", attemptId);
    expect(procError).toBeNull();

    const okFail = await admin.rpc("mark_generation_attempt_failed", {
      p_attempt_id: attemptId,
      p_error_code: "provider_timeout",
      p_error_message_redacted: "timeout",
    });
    expect(okFail.error).toBeNull();

    const { data: persisted } = await admin
      .from("generation_attempts")
      .select("status, error_code, completed_at")
      .eq("id", attemptId)
      .single();
    expect(persisted).toMatchObject({ status: "failed", error_code: "provider_timeout" });
    expect(persisted?.completed_at).toBeTruthy();
  });

  it("mark_generation_attempt_succeeded only touches a processing attempt", async () => {
    const admin = getAdminClient();
    const { sessionId, revisionId } = await insertSessionAndRevision();

    const created = await admin.rpc("create_generation_attempt", {
      p_session_id: sessionId,
      p_revision_id: revisionId,
    });
    expect(created.error).toBeNull();
    const attemptId = (created.data as unknown as { attempt_id: string }[])[0].attempt_id;
    cleanup.push({ table: "generation_attempts", id: attemptId });

    // Attempt is queued: guarded RPC must reject.
    const queuedOk = await admin.rpc("mark_generation_attempt_succeeded", {
      p_attempt_id: attemptId,
      p_provider_request_id: "req-x",
      p_telegram_message_id: 999,
    });
    expect(queuedOk.error).not.toBeNull();

    const { error: procError } = await admin
      .from("generation_attempts")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", attemptId);
    expect(procError).toBeNull();

    const ok = await admin.rpc("mark_generation_attempt_succeeded", {
      p_attempt_id: attemptId,
      p_provider_request_id: "req-x",
      p_telegram_message_id: 999,
    });
    expect(ok.error).toBeNull();

    const { data: persisted } = await admin
      .from("generation_attempts")
      .select("status, provider_request_id, telegram_message_id, completed_at")
      .eq("id", attemptId)
      .single();
    expect(persisted).toMatchObject({
      status: "succeeded",
      provider_request_id: "req-x",
      telegram_message_id: 999,
    });
    expect(persisted?.completed_at).toBeTruthy();
  });

  it("complete_prompt_session completes a non-terminal session", async () => {
    const admin = getAdminClient();
    const { sessionId } = await insertSessionAndRevision();

    const { error: transError } = await admin.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "received",
      p_new_status: "result_ready",
    });
    expect(transError).toBeNull();

    const done = await admin.rpc("complete_prompt_session", { p_session_id: sessionId });
    expect(done.error).toBeNull();

    const { data: persisted } = await admin
      .from("prompt_sessions")
      .select("status, completed_at")
      .eq("id", sessionId)
      .single();
    expect(persisted?.status).toBe("completed");
    expect(persisted?.completed_at).toBeTruthy();
  });

  it("complete_prompt_session rejects terminal sessions and in-flight generation", async () => {
    const admin = getAdminClient();
    const { sessionId } = await insertSessionAndRevision();

    const cancelled = await admin.rpc("transition_prompt_session", {
      p_session_id: sessionId,
      p_expected_status: "received",
      p_new_status: "cancelled",
    });
    expect(cancelled.error).toBeNull();
    const fromTerminal = await admin.rpc("complete_prompt_session", { p_session_id: sessionId });
    expect(fromTerminal.error).not.toBeNull();

    // In-flight generation: new session, create a queued attempt, complete must fail.
    const { sessionId: session2, revisionId: revision2 } = await insertSessionAndRevision();
    const created = await admin.rpc("create_generation_attempt", {
      p_session_id: session2,
      p_revision_id: revision2,
    });
    expect(created.error).toBeNull();
    const attemptId = (created.data as unknown as { attempt_id: string }[])[0].attempt_id;
    cleanup.push({ table: "generation_attempts", id: attemptId });

    const inFlight = await admin.rpc("complete_prompt_session", { p_session_id: session2 });
    expect(inFlight.error).not.toBeNull();
  });
});
