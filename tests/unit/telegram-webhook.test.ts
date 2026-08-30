import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTelegramUpdate,
  createDefaultWebhookDeps,
  ACCESS_CONTROLS,
  isCancelCommand,
  isStartCommand,
  type TelegramWebhookDeps,
} from "@/server/application/handle-telegram-update";
import { parseSlashCommand } from "@/server/telegram/parser";
import { resetServerEnvCache } from "@/env";

const TOKEN = "123456789:AAexamplebotToken000";
const SECRET = "job-processor-secret-0123456789abcdef";

function withEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-placeholder-value-1234567890";
  process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
  process.env.JOB_PROCESSOR_SECRET = SECRET;
  resetServerEnvCache();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetServerEnvCache();
});

type MutableDeps = {
  [K in keyof TelegramWebhookDeps]: TelegramWebhookDeps[K] extends (...args: infer A) => infer R
    ? (...args: A) => R
    : TelegramWebhookDeps[K];
};

function buildDeps(overrides: Partial<MutableDeps> = {}): {
  deps: TelegramWebhookDeps;
  calls: {
    sentMessages: { chatId: bigint; text: string }[];
    dispatched: number;
    insertedUpdates: unknown[];
    createdSessions: unknown[];
  };
} {
  const calls = {
    sentMessages: [] as { chatId: bigint; text: string }[],
    dispatched: 0,
    insertedUpdates: [] as unknown[],
    createdSessions: [] as unknown[],
  };

  const base: TelegramWebhookDeps = {
    botUserRepository: {
      findByTelegramUserId: vi.fn(async () => ({
        id: "user-1",
        telegramUserId: 123n,
        isAllowed: true,
        isAdmin: false,
      })),
      touchLastSeen: vi.fn(async () => {}),
    } as unknown as TelegramWebhookDeps["botUserRepository"],
    sessionPolicyRepository: {
      getPolicyState: vi.fn(async () => ({
        activeSessionCount: 0,
        recentSubmissionCount: 0,
      })),
    } as unknown as TelegramWebhookDeps["sessionPolicyRepository"],
    telegramUpdateRepository: {
      insertIfAbsent: vi.fn(async () => "update-1"),
      markProcessed: vi.fn(async () => {}),
    } as unknown as TelegramWebhookDeps["telegramUpdateRepository"],
    callbackEventRepository: {
      insertIfAbsent: vi.fn(async () => "callback-event-1"),
      markProcessed: vi.fn(async () => {}),
    } as unknown as TelegramWebhookDeps["callbackEventRepository"],
    initialSessionRepository: {
      create: vi.fn(async () => ({
        sessionId: "session-1",
        revisionId: "revision-1",
        jobId: "job-1",
      })),
    } as unknown as TelegramWebhookDeps["initialSessionRepository"],
    sessionRepository: {
      findActiveByUserId: vi.fn(async () => null),
      getById: vi.fn(async () => null),
      cancelActiveSession: vi.fn(async () => true),
      saveStatusMessageId: vi.fn(async () => {}),
    } as unknown as TelegramWebhookDeps["sessionRepository"],
    jobRepository: {
      insertEnhanceOnlyJob: vi.fn(async () => "job-enhance-only-1"),
      countRecentEnhanceOnlyJobs: vi.fn(async () => 0),
    } as unknown as TelegramWebhookDeps["jobRepository"],
    revisionInput: {
      handle: vi.fn(async () => ({ status: "ignored" })),
    } as unknown as TelegramWebhookDeps["revisionInput"],
    callbackStateMachine: {
      handle: vi.fn(async () => ({ status: "accepted" })),
    } as unknown as TelegramWebhookDeps["callbackStateMachine"],
    sendTelegramMessage: vi.fn(async (_token: string, chatId: bigint, text: string) => {
      calls.sentMessages.push({ chatId, text });
    }),
    answerTelegramCallback: vi.fn(async () => {}),
    dispatchToProcessor: vi.fn(async () => {
      calls.dispatched += 1;
      return { ok: true as const, status: 200 };
    }),
  };

  const deps = { ...base, ...overrides } as TelegramWebhookDeps;
  return { deps, calls };
}

function privateTextMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "private_text_message" as const,
    updateId: 42n,
    userId: 123n,
    chatId: 456n,
    messageId: 7,
    text: "a cozy cabin in the mountains",
    ...overrides,
  };
}

function callbackQuery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "callback_query" as const,
    updateId: 42n,
    userId: 123n,
    callbackQueryId: "callback-1",
    data: "generate:session-1",
    ...overrides,
  };
}

describe("handleTelegramUpdate - private text message", () => {
  it("creates a session/revision/job and dispatches the processor", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    expect(deps.telegramUpdateRepository.insertIfAbsent).toHaveBeenCalledWith({
      updateId: 42n,
      telegramUserId: 123n,
      telegramChatId: 456n,
      telegramMessageId: 7,
      updateType: "message",
    });
    expect(deps.initialSessionRepository.create).toHaveBeenCalledWith({
      telegramUserId: 123n,
      telegramChatId: 456n,
      sourcePrompt: "a cozy cabin in the mountains",
      updateId: 42n,
    });
    expect(deps.dispatchToProcessor).toHaveBeenCalledWith("https://example.vercel.app", SECRET, {
      sessionOrigin: "webhook",
    });
    expect(calls.sentMessages.some((m) => m.text.includes("diterima"))).toBe(true);
  });

  it("acknowledges a duplicate update without creating a session", async () => {
    withEnv();
    const { deps } = buildDeps({
      telegramUpdateRepository: {
        insertIfAbsent: vi.fn(async () => null),
        markProcessed: vi.fn(async () => {}),
      } as unknown as TelegramWebhookDeps["telegramUpdateRepository"],
    });
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(deps.sendTelegramMessage).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
  });

  it("rejects a non-allowlisted user with access denied and no session", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      botUserRepository: {
        findByTelegramUserId: vi.fn(async () => null),
      } as unknown as TelegramWebhookDeps["botUserRepository"],
    });
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("Akses ditolak"))).toBe(true);
  });

  it("rejects an allowlisted=false user with access denied", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      botUserRepository: {
        findByTelegramUserId: vi.fn(async () => ({
          id: "user-1",
          telegramUserId: 123n,
          isAllowed: false,
          isAdmin: false,
        })),
      } as unknown as TelegramWebhookDeps["botUserRepository"],
    });
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("Akses ditolak"))).toBe(true);
  });

  it("rejects a prompt over the length limit", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    const longText = "x".repeat(ACCESS_CONTROLS.maxPromptLength + 1);
    await handleTelegramUpdate(
      privateTextMessage({ text: longText }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("terlalu panjang"))).toBe(true);
  });

  it("rejects when rate limit is exceeded", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      sessionPolicyRepository: {
        getPolicyState: vi.fn(async () => ({
          activeSessionCount: 0,
          recentSubmissionCount: ACCESS_CONTROLS.rateLimitMaxSubmissions,
        })),
      } as unknown as TelegramWebhookDeps["sessionPolicyRepository"],
    });
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("Terlalu banyak"))).toBe(true);
  });

  it("rejects when an active session exists", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      sessionPolicyRepository: {
        getPolicyState: vi.fn(async () => ({
          activeSessionCount: 1,
          recentSubmissionCount: 0,
        })),
      } as unknown as TelegramWebhookDeps["sessionPolicyRepository"],
    });
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("sesi aktif"))).toBe(true);
  });

  it("never fails when a Telegram message send fails", async () => {
    withEnv();
    const { deps } = buildDeps({
      sendTelegramMessage: vi.fn(async () => {
        throw new Error("telegram down");
      }),
    });
    await expect(
      handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps),
    ).resolves.toBeUndefined();
    expect(deps.initialSessionRepository.create).toHaveBeenCalled();
  });

  it("never fails when the dispatcher call fails", async () => {
    withEnv();
    const { deps } = buildDeps({
      dispatchToProcessor: vi.fn(async () => {
        return { ok: false as const, status: 500, error: "http_500" };
      }),
    });
    await expect(
      handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps),
    ).resolves.toBeUndefined();
    expect(deps.initialSessionRepository.create).toHaveBeenCalled();
  });

  it("tells the user when the dispatcher returns an error", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      dispatchToProcessor: vi.fn(async () => {
        return { ok: false as const, error: "aborted" };
      }),
    });
    await handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps);

    const sawError = calls.sentMessages.some((m) => m.text.includes("Gagal memulai pemrosesan"));
    const sawQueued = calls.sentMessages.some((m) => m.text.includes("diterima"));
    expect(sawError).toBe(true);
    expect(sawQueued).toBe(false);
  });
});

describe("handleTelegramUpdate - callback query", () => {
  it("persists a recognized callback event and answers it", async () => {
    withEnv();
    const session = {
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
    };
    const { deps } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => null),
        getById: vi.fn(async () => session),
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(callbackQuery(), "https://example.vercel.app", deps);

    expect(deps.telegramUpdateRepository.insertIfAbsent).toHaveBeenCalledWith({
      updateId: 42n,
      telegramUserId: 123n,
      updateType: "callback_query",
    });
    expect(deps.callbackEventRepository.insertIfAbsent).toHaveBeenCalledWith({
      callbackQueryId: "callback-1",
      action: "generate",
      telegramUserId: 123n,
      promptSessionId: "session-1",
    });
    expect(deps.callbackStateMachine.handle).toHaveBeenCalledWith(
      expect.objectContaining({ action: "generate", sessionId: "session-1" }),
    );
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
  });

  it("runs the callback state machine for an action with a session id", async () => {
    withEnv();
    const session = {
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
    };
    const { deps } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => null),
        getById: vi.fn(async () => session),
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(callbackQuery(), "https://example.vercel.app", deps);

    expect(deps.callbackStateMachine.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "generate",
        sessionId: "session-1",
        telegramUserId: 123n,
        callbackQueryId: "callback-1",
      }),
    );
  });

  it("acks a duplicate callback update without persisting again", async () => {
    withEnv();
    const { deps } = buildDeps({
      telegramUpdateRepository: {
        insertIfAbsent: vi.fn(async () => null),
        markProcessed: vi.fn(async () => {}),
      } as unknown as TelegramWebhookDeps["telegramUpdateRepository"],
    });
    await handleTelegramUpdate(callbackQuery(), "https://example.vercel.app", deps);

    expect(deps.callbackEventRepository.insertIfAbsent).not.toHaveBeenCalled();
    expect(deps.answerTelegramCallback).not.toHaveBeenCalled();
  });

  it("does not persist an unrecognized callback action", async () => {
    withEnv();
    const { deps } = buildDeps();
    await handleTelegramUpdate(
      callbackQuery({ data: "not-an-action" }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.callbackEventRepository.insertIfAbsent).not.toHaveBeenCalled();
    expect(deps.answerTelegramCallback).toHaveBeenCalledWith(TOKEN, "callback-1");
  });

  it("never fails when answering the callback fails", async () => {
    withEnv();
    const { deps } = buildDeps({
      answerTelegramCallback: vi.fn(async () => {
        throw new Error("telegram down");
      }),
    });
    await expect(
      handleTelegramUpdate(callbackQuery(), "https://example.vercel.app", deps),
    ).resolves.toBeUndefined();
  });
});

describe("handleTelegramUpdate - unsupported", () => {
  it("ignores unsupported updates without side effects", async () => {
    withEnv();
    const { deps } = buildDeps();
    await handleTelegramUpdate({ kind: "unsupported" }, "https://example.vercel.app", deps);

    expect(deps.telegramUpdateRepository.insertIfAbsent).not.toHaveBeenCalled();
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
    expect(deps.sendTelegramMessage).not.toHaveBeenCalled();
  });
});

describe("isCancelCommand", () => {
  it("matches /cancel and /batal variants", () => {
    expect(isCancelCommand("/cancel")).toBe(true);
    expect(isCancelCommand("/CANCEL")).toBe(true);
    expect(isCancelCommand("/batal")).toBe(true);
    expect(isCancelCommand("/Batal")).toBe(true);
    expect(isCancelCommand("/cancel@albot")).toBe(true);
    expect(isCancelCommand("/batal@Albot ")).toBe(true);
    expect(isCancelCommand(" /cancel ")).toBe(true);
  });

  it("rejects non-cancel text", () => {
    expect(isCancelCommand("/cancelled")).toBe(false);
    expect(isCancelCommand("/cancel now")).toBe(false);
    expect(isCancelCommand("cancel")).toBe(false);
    expect(isCancelCommand("batalkan sesi")).toBe(false);
    expect(isCancelCommand("")).toBe(false);
  });
});

describe("isStartCommand", () => {
  it("matches /start variants", () => {
    expect(isStartCommand("/start")).toBe(true);
    expect(isStartCommand("/START")).toBe(true);
    expect(isStartCommand("/start@albot")).toBe(true);
    expect(isStartCommand(" /start ")).toBe(true);
  });

  it("rejects non-start text", () => {
    expect(isStartCommand("/started")).toBe(false);
    expect(isStartCommand("/start now")).toBe(false);
    expect(isStartCommand("start")).toBe(false);
    expect(isStartCommand("")).toBe(false);
  });
});

describe("parseSlashCommand", () => {
  it("parses name and args", () => {
    expect(parseSlashCommand("/generate-image kucing oren")).toEqual({
      name: "generate_image",
      args: "kucing oren",
    });
  });

  it("normalizes @botname suffix and hyphens", () => {
    expect(parseSlashCommand("/Generate-Image@Albot kucing")).toEqual({
      name: "generate_image",
      args: "kucing",
    });
  });

  it("returns empty args when no text follows", () => {
    expect(parseSlashCommand("/help")?.args).toBe("");
  });

  it("returns null for non-commands and invalid names", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
    expect(parseSlashCommand("/bad!")).toBeNull();
  });
});

describe("handleTelegramUpdate - slash help", () => {
  it("replies with the command list without side effects", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/help" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("/generate-image"))).toBe(true);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
  });
});

describe("handleTelegramUpdate - slash generate-image", () => {
  it("creates a direct-generation session, dispatches, and persists a status message", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/generate-image kucing oren di atap" }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.initialSessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePrompt: "kucing oren di atap",
        enhancedPrompt: "kucing oren di atap",
      }),
    );
    expect(deps.dispatchToProcessor).toHaveBeenCalledTimes(1);
    expect(deps.sessionRepository.saveStatusMessageId).not.toHaveBeenCalled(); // stub returns no messageId
    expect(calls.sentMessages.some((m) => m.text.includes("Sedang membuat gambar"))).toBe(true);
  });

  it("accepts the underscore variant", async () => {
    withEnv();
    const { deps } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/generate_image kucing" }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.initialSessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ enhancedPrompt: "kucing" }),
    );
  });

  it("replies with usage when args are empty", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/generate-image" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("/generate-image <prompt>"))).toBe(true);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
  });

  it("rejects when an active session exists", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      sessionPolicyRepository: {
        getPolicyState: vi.fn(async () => ({
          activeSessionCount: 1,
          recentSubmissionCount: 0,
        })),
      } as unknown as TelegramWebhookDeps["sessionPolicyRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/generate-image kucing" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("Masih ada sesi aktif"))).toBe(true);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
  });

  it("persists the status message id when the send returns one", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      sendTelegramMessage: vi.fn(async (_token: string, chatId: bigint, text: string) => {
        calls.sentMessages.push({ chatId, text });
        return { messageId: 99 };
      }),
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/generate-image kucing oren" }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.sessionRepository.saveStatusMessageId).toHaveBeenCalledWith("session-1", 99);
  });

  it("reports dispatch failure without a status message", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      dispatchToProcessor: vi.fn(async () => ({
        ok: false as const,
        error: "timeout",
      })),
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/generate-image kucing oren" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("Gagal memulai pemrosesan"))).toBe(true);
    expect(calls.sentMessages.some((m) => m.text.includes("Sedang membuat gambar"))).toBe(false);
    expect(deps.sessionRepository.saveStatusMessageId).not.toHaveBeenCalled();
  });
});

describe("handleTelegramUpdate - slash enhance-prompt", () => {
  it("inserts a session-less enhance_only job and dispatches", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/enhance-prompt kucing oren" }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.jobRepository.insertEnhanceOnlyJob).toHaveBeenCalledWith({
      telegramUserId: 123n,
      telegramChatId: 456n,
      sourcePrompt: "kucing oren",
    });
    expect(deps.dispatchToProcessor).toHaveBeenCalledTimes(1);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("Sedang menyempurnakan prompt"))).toBe(
      true,
    );
  });

  it("replies with usage when args are empty", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/enhance-prompt" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("/enhance-prompt <prompt>"))).toBe(true);
    expect(deps.jobRepository.insertEnhanceOnlyJob).not.toHaveBeenCalled();
  });

  it("rate-limits enhance_only when the recent-job budget is exhausted", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      jobRepository: {
        insertEnhanceOnlyJob: vi.fn(async () => "job-enhance-only-1"),
        countRecentEnhanceOnlyJobs: vi.fn(async () => 5),
      } as unknown as TelegramWebhookDeps["jobRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/enhance-prompt kucing oren" }),
      "https://example.vercel.app",
      deps,
    );

    expect(deps.jobRepository.countRecentEnhanceOnlyJobs).toHaveBeenCalledWith(
      123n,
      ACCESS_CONTROLS.rateLimitWindowMinutes,
    );
    expect(deps.jobRepository.insertEnhanceOnlyJob).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("Terlalu banyak permintaan"))).toBe(true);
  });

  it("reports dispatch failure explicitly", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      dispatchToProcessor: vi.fn(async () => ({
        ok: false as const,
        error: "timeout",
      })),
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/enhance-prompt kucing" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("Gagal memulai pemrosesan"))).toBe(true);
  });
});

describe("handleTelegramUpdate - slash start", () => {
  it("replies with a welcome message without creating a session or job", async () => {
    withEnv();
    const { deps, calls } = buildDeps();
    await handleTelegramUpdate(
      privateTextMessage({ text: "/start" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("Selamat datang"))).toBe(true);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
    expect(deps.sessionRepository.findActiveByUserId).not.toHaveBeenCalled();
  });
});

describe("handleTelegramUpdate - slash cancel", () => {
  it("cancels the active session and notifies the user", async () => {
    withEnv();
    const activeSession = {
      id: "session-1",
      telegramUserId: 123n,
      telegramChatId: 456n,
      status: "awaiting_confirmation",
      activeRevisionId: "rev-1",
      activeGenerationAttemptId: null,
      preferredImageProviderConfigId: null,
      telegramStatusMessageId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
      completedAt: null,
    };
    const cancelActiveSession = vi.fn(async () => true);
    const { deps, calls } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => activeSession),
        getById: vi.fn(async () => null),
        cancelActiveSession,
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/cancel" }),
      "https://example.vercel.app",
      deps,
    );

    expect(cancelActiveSession).toHaveBeenCalledWith("session-1", "awaiting_confirmation");
    expect(calls.sentMessages.some((m) => m.text.includes("dibatalkan"))).toBe(true);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
  });

  it("handles /batal with bot suffix", async () => {
    withEnv();
    const activeSession = {
      id: "session-1",
      telegramUserId: 123n,
      telegramChatId: 456n,
      status: "generating",
      activeRevisionId: "rev-1",
      activeGenerationAttemptId: null,
      preferredImageProviderConfigId: null,
      telegramStatusMessageId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
      completedAt: null,
    };
    const cancelActiveSession = vi.fn(async () => true);
    const { deps, calls } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => activeSession),
        getById: vi.fn(async () => null),
        cancelActiveSession,
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/batal@albot" }),
      "https://example.vercel.app",
      deps,
    );

    expect(cancelActiveSession).toHaveBeenCalledWith("session-1", "generating");
    expect(calls.sentMessages.some((m) => m.text.includes("dibatalkan"))).toBe(true);
  });

  it("replies no_active_session when there is no active session", async () => {
    withEnv();
    const { deps, calls } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => null),
        getById: vi.fn(async () => null),
        cancelActiveSession: vi.fn(async () => true),
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/cancel" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("Tidak ada sesi aktif"))).toBe(true);
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
  });

  it("takes precedence over revision-input mode", async () => {
    withEnv();
    const activeSession = {
      id: "session-1",
      telegramUserId: 123n,
      telegramChatId: 456n,
      status: "awaiting_revision_input",
      activeRevisionId: "rev-1",
      activeGenerationAttemptId: null,
      preferredImageProviderConfigId: null,
      telegramStatusMessageId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
      completedAt: null,
    };
    const cancelActiveSession = vi.fn(async () => true);
    const { deps, calls } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => activeSession),
        getById: vi.fn(async () => null),
        cancelActiveSession,
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/cancel" }),
      "https://example.vercel.app",
      deps,
    );

    expect(cancelActiveSession).toHaveBeenCalled();
    expect(calls.sentMessages.some((m) => m.text.includes("dibatalkan"))).toBe(true);
    expect(deps.revisionInput.handle).not.toHaveBeenCalled();
  });

  it("handles CAS failure gracefully", async () => {
    withEnv();
    const activeSession = {
      id: "session-1",
      telegramUserId: 123n,
      telegramChatId: 456n,
      status: "enhancing",
      activeRevisionId: "rev-1",
      activeGenerationAttemptId: null,
      preferredImageProviderConfigId: null,
      telegramStatusMessageId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
      completedAt: null,
    };
    const { deps, calls } = buildDeps({
      sessionRepository: {
        findActiveByUserId: vi.fn(async () => activeSession),
        getById: vi.fn(async () => null),
        cancelActiveSession: vi.fn(async () => false),
      } as unknown as TelegramWebhookDeps["sessionRepository"],
    });
    await handleTelegramUpdate(
      privateTextMessage({ text: "/cancel" }),
      "https://example.vercel.app",
      deps,
    );

    expect(calls.sentMessages.some((m) => m.text.includes("sedang diproses"))).toBe(true);
  });
});

describe("createDefaultWebhookDeps", () => {
  it("builds a fully-wired dependency set", () => {
    const deps = createDefaultWebhookDeps();
    expect(deps.botUserRepository).toBeDefined();
    expect(deps.sessionPolicyRepository).toBeDefined();
    expect(deps.telegramUpdateRepository).toBeDefined();
    expect(deps.callbackEventRepository).toBeDefined();
    expect(deps.initialSessionRepository).toBeDefined();
    expect(typeof deps.sendTelegramMessage).toBe("function");
    expect(typeof deps.answerTelegramCallback).toBe("function");
    expect(typeof deps.dispatchToProcessor).toBe("function");
  });
});
