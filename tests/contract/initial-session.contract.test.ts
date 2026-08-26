import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAdminClient, getAnonClient, assertHostedOrSkip, getHostedEnv } from "../helpers/hosted";
import { resetServerEnvCache } from "@/env";
import { InitialSessionRepository } from "@/server/repositories/initial-session.repository";

const skip = assertHostedOrSkip();

// Map hosted harness env onto the base names the repository reads, plus the
// dummy secrets the Milestone 3 env schema requires.
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

// Deterministic per-run numeric ids to avoid cross-run collision with leftover
// rows (BigInt source must be purely numeric).
const RUN_SEED = Math.floor(Math.random() * 0xffff);
const USER_ID = BigInt(880000000 + (RUN_SEED % 9999));
const CHAT_ID = USER_ID + 1n;
const UPDATE_ID = 990000000 + (RUN_SEED % 9999);

const cleanup: { table: "jobs" | "prompt_sessions" | "telegram_updates"; id: string }[] = [];

beforeAll(async () => {
  if (skip) return;
  const admin = getAdminClient();
  // Clean up leftover rows from interrupted runs to keep assertions isolated.
  // The RPC enqueues a globally claimable job, so stray rows would be picked up
  // by the claim_job concurrency contract test.
  await admin
    .from("jobs")
    .delete()
    .gte("payload->>update_id", String(UPDATE_ID))
    .lte("payload->>update_id", String(UPDATE_ID + 10));
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

function track(row: { sessionId: string; revisionId: string; jobId: string }) {
  cleanup.push({ table: "jobs", id: row.jobId });
  cleanup.push({ table: "prompt_sessions", id: row.sessionId });
}

describe.skipIf(skip)("create_initial_session contract", () => {
  it("atomically creates a session, first revision, and enhancement job", async () => {
    const repo = new InitialSessionRepository();
    const result = await repo.create({
      telegramUserId: USER_ID,
      telegramChatId: CHAT_ID,
      sourcePrompt: "a cozy cabin in the mountains at dusk",
      updateId: BigInt(UPDATE_ID),
    });
    track(result);

    expect(result.sessionId).toBeTruthy();
    expect(result.revisionId).toBeTruthy();
    expect(result.jobId).toBeTruthy();

    const admin = getAdminClient();
    const { data: session } = await admin
      .from("prompt_sessions")
      .select("id, status, active_revision_id, telegram_user_id, telegram_chat_id")
      .eq("id", result.sessionId)
      .single();
    expect(session).toMatchObject({
      id: result.sessionId,
      status: "received",
      active_revision_id: result.revisionId,
      telegram_user_id: Number(USER_ID),
      telegram_chat_id: Number(CHAT_ID),
    });

    const { data: revision } = await admin
      .from("prompt_revisions")
      .select("id, session_id, revision_number, source_prompt, status")
      .eq("id", result.revisionId)
      .single();
    expect(revision).toMatchObject({
      id: result.revisionId,
      session_id: result.sessionId,
      revision_number: 1,
      source_prompt: "a cozy cabin in the mountains at dusk",
      status: "pending",
    });

    const { data: job } = await admin
      .from("jobs")
      .select("id, job_type, prompt_session_id, prompt_revision_id, status, payload")
      .eq("id", result.jobId)
      .single();
    expect(job).toMatchObject({
      id: result.jobId,
      job_type: "enhance_prompt",
      prompt_session_id: result.sessionId,
      prompt_revision_id: result.revisionId,
      status: "queued",
    });
    expect((job!.payload as Record<string, unknown>).telegram_user_id).toBe(Number(USER_ID));
    expect((job!.payload as Record<string, unknown>).update_id).toBe(Number(UPDATE_ID));
  });

  it("rejects a blank or over-length source prompt", async () => {
    const repo = new InitialSessionRepository();
    await expect(
      repo.create({
        telegramUserId: USER_ID + 1000n,
        telegramChatId: CHAT_ID + 1000n,
        sourcePrompt: "   ",
        updateId: BigInt(UPDATE_ID + 1),
      }),
    ).rejects.toThrow();

    await expect(
      repo.create({
        telegramUserId: USER_ID + 1000n,
        telegramChatId: CHAT_ID + 1000n,
        sourcePrompt: "x".repeat(4001),
        updateId: BigInt(UPDATE_ID + 1),
      }),
    ).rejects.toThrow();

    const admin = getAdminClient();
    const { count } = await admin
      .from("prompt_sessions")
      .select("id", { count: "exact", head: true })
      .eq("telegram_user_id", Number(USER_ID + 1000n));
    expect(count ?? 0).toBe(0);
  });

  it("is not executable by the anonymous role", async () => {
    const anon = getAnonClient();
    const { error } = await anon.rpc("create_initial_session", {
      p_telegram_user_id: Number(USER_ID),
      p_telegram_chat_id: Number(CHAT_ID),
      p_source_prompt: "anon should not create a session",
      p_update_id: UPDATE_ID + 2,
    });
    expect(error).not.toBeNull();
  });

  it("direct mode (enhanced_prompt) creates a generating session with a completed revision and generate_image job", async () => {
    const repo = new InitialSessionRepository();
    const result = await repo.create({
      telegramUserId: USER_ID + 2000n,
      telegramChatId: CHAT_ID + 2000n,
      sourcePrompt: "an orange cat on a tiled rooftop at sunset",
      updateId: BigInt(UPDATE_ID + 20),
      enhancedPrompt: "a highly detailed orange tabby cat on a tiled rooftop at sunset",
    });
    track(result);

    const admin = getAdminClient();
    const { data: session } = await admin
      .from("prompt_sessions")
      .select("id, status, active_revision_id")
      .eq("id", result.sessionId)
      .single();
    expect(session).toMatchObject({
      id: result.sessionId,
      status: "generating",
      active_revision_id: result.revisionId,
    });

    const { data: revision } = await admin
      .from("prompt_revisions")
      .select(
        "id, session_id, revision_number, source_prompt, enhanced_prompt, status, completed_at",
      )
      .eq("id", result.revisionId)
      .single();
    expect(revision).toMatchObject({
      id: result.revisionId,
      session_id: result.sessionId,
      revision_number: 1,
      source_prompt: "an orange cat on a tiled rooftop at sunset",
      enhanced_prompt: "a highly detailed orange tabby cat on a tiled rooftop at sunset",
      status: "completed",
    });
    expect(revision!.completed_at).not.toBeNull();

    const { data: job } = await admin
      .from("jobs")
      .select("id, job_type, prompt_session_id, prompt_revision_id, status")
      .eq("id", result.jobId)
      .single();
    expect(job).toMatchObject({
      id: result.jobId,
      job_type: "generate_image",
      prompt_session_id: result.sessionId,
      prompt_revision_id: result.revisionId,
      status: "queued",
    });
  });

  it("direct mode rejects a blank or over-length enhanced prompt", async () => {
    const repo = new InitialSessionRepository();
    await expect(
      repo.create({
        telegramUserId: USER_ID + 3000n,
        telegramChatId: CHAT_ID + 3000n,
        sourcePrompt: "a cozy cabin",
        updateId: BigInt(UPDATE_ID + 30),
        enhancedPrompt: "   ",
      }),
    ).rejects.toThrow();

    await expect(
      repo.create({
        telegramUserId: USER_ID + 3000n,
        telegramChatId: CHAT_ID + 3000n,
        sourcePrompt: "a cozy cabin",
        updateId: BigInt(UPDATE_ID + 30),
        enhancedPrompt: "x".repeat(4001),
      }),
    ).rejects.toThrow();

    const admin = getAdminClient();
    const { count } = await admin
      .from("prompt_sessions")
      .select("id", { count: "exact", head: true })
      .eq("telegram_user_id", Number(USER_ID + 3000n));
    expect(count ?? 0).toBe(0);
  });
});
