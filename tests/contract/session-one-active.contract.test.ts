import { afterEach, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip } from "../helpers/hosted";

const skip = assertHostedOrSkip();

const cleanup: { table: "prompt_sessions"; id: string }[] = [];

const RUN_SEED = Math.floor(Math.random() * 0xffff);

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

describe.skipIf(skip)("prompt_sessions_one_active_idx contract", () => {
  it("rejects a second non-terminal session for the same user", async () => {
    const admin = getAdminClient();
    const userId = 770100000 + ((RUN_SEED + 1) % 9999);

    const { error: insertError } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: userId,
        telegram_chat_id: userId + 1,
        status: "received",
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { data, error } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: userId,
        telegram_chat_id: userId + 1,
        status: "received",
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("allows a new session once the previous is terminal", async () => {
    const admin = getAdminClient();
    const userId = 770100000 + ((RUN_SEED + 2) % 9999);

    const { data: first } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: userId,
        telegram_chat_id: userId + 1,
        status: "cancelled",
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    expect(first?.id).toBeTruthy();
    cleanup.push({ table: "prompt_sessions", id: first!.id });

    const { data, error } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: userId,
        telegram_chat_id: userId + 1,
        status: "received",
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    cleanup.push({ table: "prompt_sessions", id: data!.id });
  });
});
