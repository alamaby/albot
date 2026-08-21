import { afterEach, describe, expect, it, vi } from "vitest";
import { RevisionInputUseCase, type RevisionInputDeps } from "@/server/application/revision-input";
import { resetServerEnvCache } from "@/env";
import type { SessionSafe } from "@/server/repositories/session.repository";

// Hoisted mock state so the factory can be defined once (hoisted above the
// imports) and per-test values assigned in each test body.
const rpcMock = vi.hoisted(() => ({
  createRevision: null as unknown,
  transition: null as unknown,
}));

vi.mock("@/server/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    rpc: (name: string) =>
      name === "create_revision"
        ? { single: vi.fn(async () => ({ data: rpcMock.createRevision, error: null })) }
        : { maybeSingle: vi.fn(async () => ({ data: rpcMock.transition, error: null })) },
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
  rpcMock.createRevision = null;
  rpcMock.transition = null;
  resetServerEnvCache();
});

function session(overrides: Partial<SessionSafe> = {}): SessionSafe {
  return {
    id: "session-1",
    telegramUserId: 123n,
    telegramChatId: 456n,
    status: "awaiting_revision_input",
    activeRevisionId: "revision-1",
    activeGenerationAttemptId: null,
    preferredImageProviderConfigId: null,
    telegramStatusMessageId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

function stubRpc({ createRevision, transition }: { createRevision: unknown; transition: unknown }) {
  rpcMock.createRevision = createRevision;
  rpcMock.transition = transition;
}

function buildUseCase(overrides: Partial<RevisionInputDeps> = {}) {
  const sent: { chatId: bigint; text: string }[] = [];
  const dispatched: Record<string, unknown>[] = [];

  const deps: RevisionInputDeps = {
    sessionRepository: {} as RevisionInputDeps["sessionRepository"],
    enhancementRepository: {
      getRevisionById: vi.fn(async () => ({
        id: "revision-1",
        sessionId: "session-1",
        revisionNumber: 1,
        sourcePrompt: "original",
        previousPrompt: null,
        revisionInstruction: null,
        enhancedPrompt: "enhanced v1",
        negativePrompt: null,
        aspectRatio: null,
        reasoningProviderConfigId: "cfg-1",
        status: "completed",
        createdAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:00Z",
      })),
    } as unknown as RevisionInputDeps["enhancementRepository"],
    jobRepository: {
      insertEnhancementJob: vi.fn(async () => "job-2"),
    } as unknown as RevisionInputDeps["jobRepository"],
    sendTelegramMessage: vi.fn(async (_t, chatId, text) => {
      sent.push({ chatId, text });
    }),
    dispatchToProcessor: vi.fn(async (_o, _s, payload) => {
      dispatched.push(payload ?? {});
    }),
    ...overrides,
  };

  return { useCase: new RevisionInputUseCase(deps), sent, dispatched };
}

describe("RevisionInputUseCase", () => {
  it("creates a revision, transitions, enqueues a job, and acknowledges", async () => {
    withEnv();
    stubRpc({
      createRevision: { revision_id: "revision-2", revision_number: 2 },
      transition: { id: "session-1", status: "enhancing" },
    });
    const { useCase, sent, dispatched } = buildUseCase();

    const outcome = await useCase.handle(
      session(),
      "buat lebih terang",
      "https://example.vercel.app",
    );

    expect(outcome).toEqual({
      status: "accepted",
      sessionId: "session-1",
      revisionId: "revision-2",
      revisionNumber: 2,
    });
    expect(sent.some((m) => m.text.includes("memproses revisi"))).toBe(true);
    expect(dispatched[0]).toMatchObject({ sessionOrigin: "revision_input" });
  });

  it("ignores a session not in awaiting_revision_input", async () => {
    withEnv();
    stubRpc({ createRevision: null, transition: null });
    const { useCase, dispatched } = buildUseCase();
    const outcome = await useCase.handle(session({ status: "awaiting_confirmation" }), "x", "o");
    expect(outcome).toEqual({ status: "ignored" });
    expect(dispatched).toHaveLength(0);
  });

  it("reports an expired session", async () => {
    withEnv();
    stubRpc({ createRevision: null, transition: null });
    const { useCase } = buildUseCase();
    const outcome = await useCase.handle(session({ expiresAt: "2020-01-01T00:00:00Z" }), "x", "o");
    expect(outcome).toEqual({ status: "expired" });
  });

  it("reports too_long for oversized instructions", async () => {
    withEnv();
    stubRpc({ createRevision: null, transition: null });
    const { useCase } = buildUseCase();
    const outcome = await useCase.handle(session(), "x".repeat(4001), "o");
    expect(outcome).toEqual({ status: "too_long" });
  });

  it("does not enqueue a job when the transition loses the CAS", async () => {
    withEnv();
    stubRpc({
      createRevision: { revision_id: "revision-2", revision_number: 2 },
      transition: null,
    });
    const { useCase, dispatched } = buildUseCase();
    const outcome = await useCase.handle(session(), "instruksi", "o");
    expect(outcome.status).toBe("accepted");
    expect(dispatched).toHaveLength(0);
  });
});
