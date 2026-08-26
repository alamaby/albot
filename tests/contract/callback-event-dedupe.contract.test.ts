import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAdminClient, assertHostedOrSkip, getHostedEnv } from "../helpers/hosted";
import { resetServerEnvCache } from "@/env";
import { TelegramUpdateRepository } from "@/server/repositories/telegram-update.repository";
import { CallbackEventRepository } from "@/server/repositories/callback-event.repository";

const skip = assertHostedOrSkip();

if (!skip) {
  const env = getHostedEnv();
  if (env) {
    process.env.SUPABASE_URL = env.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRoleKey;
    process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
    process.env.JOB_PROCESSOR_SECRET = "job-processor-secret-0123456789abcdef";
  }
  resetServerEnvCache();
}

const RUN_SEED = Math.floor(Math.random() * 0xffff);
const USER_ID = BigInt(880000000 + ((RUN_SEED % 9999) + 20000));
const BASE_UPDATE_ID = 880000000 + ((RUN_SEED % 9999) + 20000);
const CALLBACK_ID = `cb_${Date.now()}_${RUN_SEED}`;

const cleanup: { table: "telegram_updates" | "callback_events"; id: string }[] = [];

beforeAll(async () => {
  if (skip) return;
  const admin = getAdminClient();
  // The seed space is small (9999 values); a colliding earlier run that failed
  // mid-cleanup would leave a row on this update_id and flip the first insert
  // into a duplicate. Clear the slot before the run.
  await admin.from("telegram_updates").delete().eq("update_id", BASE_UPDATE_ID);
  await admin.from("callback_events").delete().like("callback_query_id", `cb_%_${RUN_SEED}`);
});

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

describe.skipIf(skip)("telegram update deduplication contract", () => {
  it("inserts once for the same update_id and reports the duplicate", async () => {
    const repo = new TelegramUpdateRepository();
    const updateId = BigInt(BASE_UPDATE_ID);

    const first = await repo.insertIfAbsent({
      updateId,
      telegramUserId: USER_ID,
      telegramChatId: USER_ID + 1n,
      updateType: "message",
    });
    expect(first).not.toBeNull();
    cleanup.push({ table: "telegram_updates", id: first! });

    const duplicate = await repo.insertIfAbsent({
      updateId,
      telegramUserId: USER_ID,
      telegramChatId: USER_ID + 1n,
      updateType: "message",
    });
    expect(duplicate).toBeNull();

    const admin = getAdminClient();
    const { count } = await admin
      .from("telegram_updates")
      .select("id", { count: "exact", head: true })
      .eq("update_id", Number(updateId));
    expect(count ?? 0).toBe(1);
  });
});

describe.skipIf(skip)("callback event deduplication contract", () => {
  it("inserts once for the same callback_query_id and reports the duplicate", async () => {
    const repo = new CallbackEventRepository();
    const callbackQueryId = CALLBACK_ID;

    const first = await repo.insertIfAbsent({
      callbackQueryId,
      action: "generate",
      telegramUserId: USER_ID,
    });
    expect(first).not.toBeNull();
    cleanup.push({ table: "callback_events", id: first! });

    const duplicate = await repo.insertIfAbsent({
      callbackQueryId,
      action: "generate",
      telegramUserId: USER_ID,
    });
    expect(duplicate).toBeNull();

    const admin = getAdminClient();
    const { count } = await admin
      .from("callback_events")
      .select("id", { count: "exact", head: true })
      .eq("callback_query_id", callbackQueryId);
    expect(count ?? 0).toBe(1);
  });
});
