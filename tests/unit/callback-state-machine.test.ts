import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CallbackStateMachine,
  type CallbackStateMachineDeps,
} from "@/server/application/callback-state-machine";
import { resetServerEnvCache } from "@/env";
import type { SessionSafe } from "@/server/repositories/session.repository";

const rpcMock = vi.hoisted(() => ({
  transition: null as unknown,
  calls: [] as { rpcName: string; args: Record<string, unknown> }[],
}));

vi.mock("@/server/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: (rpcName: string, args: Record<string, unknown>) => {
      rpcMock.calls.push({ rpcName, args });
      return {
        maybeSingle: vi.fn(async () => ({ data: rpcMock.transition, error: null })),
      };
    },
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
  rpcMock.calls.length = 0;
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
    telegramStatusMessageId: null,
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
  const dispatched: { origin: string; payload?: Record<string, unknown> }[] = [];
  const savedStatusMessageIds: { sessionId: string; messageId: number }[] = [];

  const machine = new CallbackStateMachine({
    sessionRepository: {} as CallbackStateMachineDeps["sessionRepository"],
    jobRepository:
      overrides.jobRepository ??
      ({
        insertGenerateImageJob: vi.fn(async () => "job-gen-1"),
      } as unknown as CallbackStateMachineDeps["jobRepository"]),
    dispatchToProcessor: vi.fn(async (origin: string, _secret: string, payload) => {
      dispatched.push({ origin, payload });
    }),
    sendTelegramMessage: vi.fn(async (_token, chatId, text) => {
      sentMessages.push({ chatId, text });
      // Mirror the production sendMessage return shape so extractMessageId
      // persists the status message id.
      return { messageId: 100 + sentMessages.length };
    }),
    answerCallbackQuery: vi.fn(async (_token, callbackQueryId, options) => {
      acks.push({ callbackQueryId, text: options?.text });
    }),
    saveStatusMessageId: vi.fn(async (sessionId: string, messageId: number) => {
      savedStatusMessageIds.push({ sessionId, messageId });
    }),
    ...overrides,
  });

  return { machine, sentMessages, acks, dispatched, savedStatusMessageIds };
}

describe("CallbackStateMachine", () => {
  it("accepts generate and enqueues a generate_image job and dispatches the processor", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "generating" });
    const jobRepository = {
      insertGenerateImageJob: vi.fn(async () => "job-gen-1"),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, acks, dispatched } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session(),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("accepted");
    const repo = jobRepository as unknown as {
      insertGenerateImageJob: ReturnType<typeof vi.fn>;
    };
    expect(repo.insertGenerateImageJob).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", revisionId: "revision-1" }),
    );
    expect(dispatched).toEqual([
      {
        origin: "https://test.origin",
        payload: { sessionOrigin: "callback_generate" },
      },
    ]);
    expect(acks).toEqual([{ callbackQueryId: "cb-1", text: "Mulai membuat gambar..." }]);
  });

  it("sends and persists a generation status message on generate", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "generating" });
    const { machine, sentMessages, savedStatusMessageIds } = buildMachine();

    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session(),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("accepted");
    expect(sentMessages.some((m) => m.text === "Sedang membuat gambar, mohon tunggu...")).toBe(
      true,
    );
    expect(savedStatusMessageIds).toEqual([{ sessionId: "session-1", messageId: 101 }]);
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
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("rejected_owner");
  });

  it("rejects an expired session without transitions", async () => {
    withEnv();
    stubRpcTransition(null);
    const { machine, acks } = buildMachine();
    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session({ expiresAt: "2020-01-01T00:00:00Z" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-1",
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("rejected_expired");
    expect(acks.some((a) => a.text?.includes("Sesi telah berakhir"))).toBe(true);
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
      origin: "https://test.origin",
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
      origin: "https://test.origin",
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
      origin: "https://test.origin",
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
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("diproses"))).toBe(true);
  });

  it("accepts regenerate from result_ready and enqueues a new job", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "generating" });
    const jobRepository = {
      insertGenerateImageJob: vi.fn(async () => "job-gen-2"),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "regenerate",
      sessionId: "session-1",
      session: session({ status: "result_ready" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-reg-1",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("accepted");
    const repo = jobRepository as unknown as {
      insertGenerateImageJob: ReturnType<typeof vi.fn>;
    };
    expect(repo.insertGenerateImageJob).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", revisionId: "revision-1" }),
    );
    expect(acks.some((a) => a.text?.includes("Mulai membuat gambar lagi"))).toBe(true);
  });

  it("rejects regenerate when session is not result_ready", async () => {
    withEnv();
    stubRpcTransition(null);
    const { machine, acks } = buildMachine();
    const outcome = await machine.handle({
      action: "regenerate",
      sessionId: "session-1",
      session: session({ status: "awaiting_confirmation" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-reg-2",
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("diproses"))).toBe(true);
  });

  it("accepts revise from result_ready and transitions to awaiting_revision_input", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "awaiting_revision_input" });
    const { machine, sentMessages } = buildMachine();
    const outcome = await machine.handle({
      action: "revise",
      sessionId: "session-1",
      session: session({ status: "result_ready" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-rev-1",
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("accepted");
    expect(sentMessages.some((m) => m.text.includes("instruksi revisi"))).toBe(true);
  });

  it("completes a result_ready session via completeSession", async () => {
    withEnv();
    const completeSession = vi.fn(async () => {});
    const { machine, acks, sentMessages } = buildMachine({ completeSession });
    const outcome = await machine.handle({
      action: "complete",
      sessionId: "session-1",
      session: session({ status: "result_ready" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-complete-1",
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("accepted");
    expect(completeSession).toHaveBeenCalledWith("session-1");
    expect(acks.some((a) => a.text?.includes("Sesi selesai"))).toBe(true);
    expect(sentMessages.some((m) => m.text.includes("Sesi selesai"))).toBe(true);
  });

  it("rejects complete when session is not result_ready", async () => {
    withEnv();
    const completeSession = vi.fn(async () => {});
    const { machine } = buildMachine({ completeSession });
    const outcome = await machine.handle({
      action: "complete",
      sessionId: "session-1",
      session: session({ status: "generating" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-complete-2",
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("rejected_state");
    expect(completeSession).not.toHaveBeenCalled();
  });

  it("rolls back the session when the generate job insert fails", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "generating" });
    const jobRepository = {
      insertGenerateImageJob: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "regenerate",
      sessionId: "session-1",
      session: session({ status: "result_ready" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-reg-3",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("Gagal mengirim permintaan"))).toBe(true);
  });

  it("accepts generate from generation_failed as a retry and dispatches", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "generating" });
    const jobRepository = {
      insertGenerateImageJob: vi.fn(async () => "job-gen-retry"),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, dispatched, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "generate",
      sessionId: "session-1",
      session: session({ status: "generation_failed" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-gen-retry-1",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("accepted");
    const repo = jobRepository as unknown as {
      insertGenerateImageJob: ReturnType<typeof vi.fn>;
    };
    expect(repo.insertGenerateImageJob).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", revisionId: "revision-1" }),
    );
    expect(dispatched[0].payload).toEqual({ sessionOrigin: "callback_generate" });
    expect(acks.some((a) => a.text?.includes("Mulai membuat gambar"))).toBe(true);
  });

  it("accepts revise from generation_failed and transitions to awaiting_revision_input", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "awaiting_revision_input" });
    const { machine, sentMessages } = buildMachine();
    const outcome = await machine.handle({
      action: "revise",
      sessionId: "session-1",
      session: session({ status: "generation_failed" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-rev-failed-1",
      origin: "https://test.origin",
    });
    expect(outcome.status).toBe("accepted");
    expect(sentMessages.some((m) => m.text.includes("instruksi revisi"))).toBe(true);
  });

  it("accepts retry from enhancement_failed and enqueues an enhancement job", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "enhancing" });
    const jobRepository = {
      insertEnhancementJob: vi.fn(async () => "job-enh-retry"),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, dispatched, sentMessages, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "retry",
      sessionId: "session-1",
      session: session({ status: "enhancement_failed" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-retry-1",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("accepted");
    expect(rpcMock.calls).toContainEqual({
      rpcName: "transition_prompt_session",
      args: {
        p_session_id: "session-1",
        p_expected_status: "enhancement_failed",
        p_new_status: "enhancing",
      },
    });
    const repo = jobRepository as unknown as {
      insertEnhancementJob: ReturnType<typeof vi.fn>;
    };
    expect(repo.insertEnhancementJob).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", revisionId: "revision-1" }),
    );
    expect(dispatched[0].payload).toEqual({ sessionOrigin: "callback_retry" });
    expect(sentMessages.some((m) => m.text.includes("memproses ulang prompt"))).toBe(true);
    expect(acks.some((a) => a.text?.includes("Mencoba lagi"))).toBe(true);
  });

  it("rejects retry when session is not enhancement_failed", async () => {
    withEnv();
    stubRpcTransition(null);
    const jobRepository = {
      insertEnhancementJob: vi.fn(async () => "job-enh-retry"),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "retry",
      sessionId: "session-1",
      session: session({ status: "awaiting_confirmation" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-retry-2",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("diproses"))).toBe(true);
    const repo = jobRepository as unknown as {
      insertEnhancementJob: ReturnType<typeof vi.fn>;
    };
    expect(repo.insertEnhancementJob).not.toHaveBeenCalled();
  });

  it("rolls back the session when the retry enhancement job insert fails", async () => {
    withEnv();
    stubRpcTransition({ id: "session-1", status: "enhancing" });
    const jobRepository = {
      insertEnhancementJob: vi.fn(async () => {
        throw new Error("insert failed");
      }),
    } as unknown as CallbackStateMachineDeps["jobRepository"];

    const { machine, acks } = buildMachine({ jobRepository });

    const outcome = await machine.handle({
      action: "retry",
      sessionId: "session-1",
      session: session({ status: "enhancement_failed" }),
      telegramUserId: 123n,
      callbackQueryId: "cb-retry-3",
      origin: "https://test.origin",
    });

    expect(outcome.status).toBe("rejected_state");
    expect(acks.some((a) => a.text?.includes("Gagal mengirim permintaan"))).toBe(true);
  });
});
