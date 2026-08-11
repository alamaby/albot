import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTelegramUpdate,
  createDefaultWebhookDeps,
  ACCESS_CONTROLS,
  type TelegramWebhookDeps,
} from "@/server/application/handle-telegram-update";
import { resetServerEnvCache } from "@/env";

const TOKEN = "123456789:AAexamplebotToken000";
const SECRET = "job-processor-secret-0123456789abcdef";

function withEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
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
    sendTelegramMessage: vi.fn(async (_token: string, chatId: bigint, text: string) => {
      calls.sentMessages.push({ chatId, text });
    }),
    answerTelegramCallback: vi.fn(async () => {}),
    dispatchToProcessor: vi.fn(async () => {
      calls.dispatched += 1;
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
    data: "generate",
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
      updateType: "message",
    });
    expect(deps.initialSessionRepository.create).toHaveBeenCalledWith({
      telegramUserId: 123n,
      telegramChatId: 456n,
      sourcePrompt: "a cozy cabin in the mountains",
      updateId: 42n,
    });
    expect(deps.dispatchToProcessor).toHaveBeenCalledWith("https://example.vercel.app", SECRET);
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
        throw new Error("dispatcher down");
      }),
    });
    await expect(
      handleTelegramUpdate(privateTextMessage(), "https://example.vercel.app", deps),
    ).resolves.toBeUndefined();
    expect(deps.initialSessionRepository.create).toHaveBeenCalled();
  });
});

describe("handleTelegramUpdate - callback query", () => {
  it("persists a recognized callback event and answers it", async () => {
    withEnv();
    const { deps } = buildDeps();
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
    });
    expect(deps.answerTelegramCallback).toHaveBeenCalledWith(TOKEN, "callback-1");
    expect(deps.dispatchToProcessor).not.toHaveBeenCalled();
    expect(deps.initialSessionRepository.create).not.toHaveBeenCalled();
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
