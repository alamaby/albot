import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CallbackStateMachine,
  type CallbackStateMachineDeps,
} from "@/server/application/callback-state-machine";
import { resetServerEnvCache } from "@/env";
import type { SessionSafe } from "@/server/repositories/session.repository";

const rpcMock = vi.hoisted(() => ({ transition: null as unknown }));

vi.mock("@/server/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: () => ({ maybeSingle: vi.fn(async () => ({ data: rpcMock.transition, error: null })) }),
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
  resetServerEnvCache();
});

function session(overrides: Partial<SessionSafe> = {}): SessionSafe {
  return {
    id: "session-1",
    telegramUserId: 123n,
    telegramChatId: 456n,
    status: "awaiting_confirmation",
    activeRevisionId: "revision-1",
    activeGenerationAttemptId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

// Sets the hoisted transition RPC result (data for success, null for stale CAS).
function stubRpcTransition(data: unknown) {
  rpcMock.transition = data;
}

function buildMachine(overrides: Partial<CallbackStateMachineDeps> = {}) {
  const sentMessages: { chatId: bigint; text: string }[] = [];
  const acks: { callbackQueryId: string; text?: string }[] = [];

  const machine = new CallbackStateMachine({
    sessionRepository: {} as CallbackStateMachineDeps["sessionRepository"],
    jobRepository:
      overrides.jobRepository ??
      ({
        insertGenerateImageJob: vi.fn(async () => "job-gen-1"),
      } as unknown as CallbackStateMachineDeps["jobRepository"]),
    sendTelegramMessage: vi.fn(async (_token, chatId, text) => {
      sentMessages.push({ chatId, text });
    }),
    answerCallbackQuery: vi.fn(async (_token, callbackQueryId, options) => {
      acks.push({ callbackQueryId, text: options?.text });
    }),
    ...overrides,
  });

  return { machine, sentMessages, acks };
}

describe("CallbackStateMachine", () => {
  it("accepts generate and enqueues a generate_image job", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "generating" });
    const jobRepository = {
      insertGenerateImageJob: vi.fn(async () => "job-gen-1"),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session(),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
    });

    expect(outcome.status).toBe("accepted");
    const repo = jobRepository as unknown as {
      insertGenerateImageJob: ReturnType<typeof vi.fn>;
    };
    expect(repo.insertGenerateImageJob).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", revisionId: "revision-1" }),
    );
    expect(acks).toEqual([{ callbackQueryId: "cb-1", text: "Mulai membuat gambar..." }]);
  });

  it("rejects a callback from another user", async () => {
    withEnv();
    stubRpcTransition(null);
    const { machine } = buildMachine();
    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session({ telegramUserId: 999n }),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
    });
    expect(outcome.status).toBe("rejected_owner");
  });

  it("rejects an expired session without transitions", async () => {
    withEnv();
    stubRpcTransition(null);
    const { machine } = buildMachine();
    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session({ expiresAt: "2020-01-01T00:00:00Z" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
    });
    expect(outcome.status).toBe("rejected_expired");
  });

  it("rejects generate when session is not awaiting_confirmation", async () => {
    withEnv();
    stubRpcTransition(null);
    const { machine, acks } = buildMachine();
    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session({ status: "generating" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
    });
    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("diproses"))).toBe(true);
  });

  it("accepts revise and transitions to awaiting_revision_input", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "awaiting_revision_input" });
    const { machine, sentMessages } = buildMachine();
    const outcome = await machine.handle({
      action: "revise",
      sessionId: "session-1",
      session: session(),
      telegramUserId: 123n,
      callbackQueryId: "cb-2",
    });
    expect(outcome.status).toBe("accepted");
    expect(sentMessages.some((m) => m.text.includes("instruksi revisi"))).toBe(true);
  });

  it("accepts cancel and transitions to cancelled", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "cancelled" });
    const { machine, sentMessages } = buildMachine();
    const outcome = await machine.handle({
      action: "cancel",
      sessionId: "session-1",
      session: session(),
      telegramUserId: 123n,
      callbackQueryId: "cb-3",
    });
    expect(outcome.status).toBe("accepted");
    expect(sentMessages.some((m) => m.text.includes("Sesi dibatalkan"))).toBe(true);
  });

  it("treats a lost CAS as rejected_state without double-processing", async () => {
    withEnv();
    stubRpcTransition(null);
    const { machine, acks } = buildMachine();
    const outcome = await machine.handle({
      action: "cancel",
      sessionId: "session-1",
      session: session(),
      telegramUserId: 123n,
      callbackQueryId: "cb-4",
    });
    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("diproses"))).toBe(true);
  });
});
