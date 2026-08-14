import { afterEach, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip } from "../helpers/hosted";

const skip = assertHostedOrSkip();

const cleanup: {
  table: "prompt_sessions" | "prompt_revisions";
  id: string;
}[] = [];

const RUN_SEED = Math.floor(Math.random() * 0xffff);
// Unique user id per session insert so the partial unique index (one active
// session per user) never collides between tests in this file.
let sessionCounter = 0;

async function insertSession() {
  sessionCounter += 1;
  const userId = 770000000 + ((RUN_SEED + sessionCounter * 97) % 9999);
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("prompt_sessions")
    .insert({
      telegram_user_id: userId,
      telegram_chat_id: userId + 1,
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  cleanup.push({ table: "prompt_sessions", id: data!.id });
  return data!.id;
}

afterEach(async () => {
  const admin = getAdminClient();
  for (const item of [...cleanup].reverse()) {
    await admin
      .from(item.table)
      .delete()
      .eq("id", item.id as never);
  }
  cleanup.length = 0;
});

// RPC args generated from SQL `text` params are non-nullable, but previous
// prompt / instruction are optional in the function. Widen via cast so null is
// accepted exactly like the SQL default.
function createRevision(
  admin: ReturnType<typeof getAdminClient>,
  args: {
    p_session_id: string;
    p_source_prompt: string;
    p_previous_prompt: string | null;
    p_revision_instruction: string | null;
  },
) {
  return admin.rpc("create_revision" as never, args as never).single() as unknown as Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

describe.skipIf(skip)("create_revision contract", () => {
  it("creates the next revision with monotonically increasing number", async () => {
    const sessionId = await insertSession();
    const admin = getAdminClient();

    const { data: first, error: err1 } = await createRevision(admin, {
      p_session_id: sessionId,
      p_source_prompt: "revisi satu",
      p_previous_prompt: null,
      p_revision_instruction: null,
    });
    expect(err1).toBeNull();
    cleanup.push({ table: "prompt_revisions", id: (first as { revision_id: string }).revision_id });
    expect((first as { revision_number: number }).revision_number).toBe(1);

    const { data: second, error: err2 } = await createRevision(admin, {
      p_session_id: sessionId,
      p_source_prompt: "revisi dua",
      p_previous_prompt: "enhanced satu",
      p_revision_instruction: "buat lebih terang",
    });
    expect(err2).toBeNull();
    cleanup.push({
      table: "prompt_revisions",
      id: (second as { revision_id: string }).revision_id,
    });
    expect((second as { revision_number: number }).revision_number).toBe(2);

    // Active pointer repointed to the newest revision.
    const { data: session } = await admin
      .from("prompt_sessions")
      .select("active_revision_id, status")
      .eq("id", sessionId)
      .single();
    expect(session?.active_revision_id).toBe((second as { revision_id: string }).revision_id);
    // The RPC must not change session status.
    expect(session?.status).toBe("received");

    // Revision 1 is immutable: untouched by the second creation.
    const { data: rev1 } = await admin
      .from("prompt_revisions")
      .select("revision_number, source_prompt, previous_prompt")
      .eq("id", (first as { revision_id: string }).revision_id)
      .single();
    expect(rev1).toMatchObject({
      revision_number: 1,
      source_prompt: "revisi satu",
      previous_prompt: null,
    });
  });

  it("rejects a blank or over-length source prompt", async () => {
    const sessionId = await insertSession();
    const admin = getAdminClient();

    const blank = await createRevision(admin, {
      p_session_id: sessionId,
      p_source_prompt: "   ",
      p_previous_prompt: null,
      p_revision_instruction: null,
    });
    expect(blank.error).not.toBeNull();

    const tooLong = await createRevision(admin, {
      p_session_id: sessionId,
      p_source_prompt: "x".repeat(4001),
      p_previous_prompt: null,
      p_revision_instruction: null,
    });
    expect(tooLong.error).not.toBeNull();
  });

  it("is not executable by the anonymous role", async () => {
    const { getAnonClient } = await import("../helpers/hosted");
    const anon = getAnonClient();
    const { error } = await anon.rpc(
      "create_revision" as never,
      {
        p_session_id: "00000000-0000-0000-0000-000000000000",
        p_source_prompt: "anon",
        p_previous_prompt: null,
        p_revision_instruction: null,
      } as never,
    );
    expect(error).not.toBeNull();
  });
});

describe.skipIf(skip)("mark_revision_failed contract", () => {
  it("marks a processing revision failed and ignores stale calls", async () => {
    const sessionId = await insertSession();
    const admin = getAdminClient();

    const { data: revision } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: sessionId,
        revision_number: 1,
        source_prompt: "test",
        status: "processing",
      })
      .select("id")
      .single();
    cleanup.push({ table: "prompt_revisions", id: revision!.id });

    const ok = await admin.rpc("mark_revision_failed", {
      p_revision_id: revision!.id,
      p_error_code: "provider_timeout",
      p_error_message_redacted: "timeout",
    });
    expect(ok.error).toBeNull();

    // Stale call on a completed (already failed) revision raises.
    const stale = await admin.rpc("mark_revision_failed", {
      p_revision_id: revision!.id,
      p_error_code: "provider_timeout",
      p_error_message_redacted: "again",
    });
    expect(stale.error).not.toBeNull();
  });
});
