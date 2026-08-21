import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerateImageUseCase } from "@/server/application/generate-image";
import { getProviderRegistry } from "@/server/providers/registry";
import { createMockImageProvider } from "@/server/providers/mock/mock-image.adapter";
import { makeRetryable, makeNonRetryable } from "@/server/providers/errors";
import type { ImageGenerationResult, ImageGenerationProvider } from "@/server/domain/provider";
import type { SessionSafe } from "@/server/repositories/session.repository";
import type { GenerationAttemptSafe } from "@/server/repositories/generation.repository";
import type { RevisionSafe } from "@/server/repositories/enhancement.repository";
import type { ProviderConfigSafe } from "@/server/repositories/provider-config.repository";
import type { ProviderKeySafe } from "@/server/repositories/provider-key.repository";
import type { JobSafe } from "@/server/repositories/job.repository";
import { resetServerEnvCache } from "@/env";

const rpcMock = vi.hoisted(() => ({ transition: true as unknown }));

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

// Test-only image adapter registered under a unique type so the registry
// resolves it without touching real providers. The registered factory reads a
// mutable holder so each test can swap the adapter result.
const MOCK_ADAPTER = "mock_image_generation_unit";
let registered = false;
const adapterHolder = vi.hoisted(() => ({
  result: null as Promise<ImageGenerationResult> | null,
}));

function registerMockAdapter(): void {
  if (!registered) {
    getProviderRegistry().registerImage(MOCK_ADAPTER, () => {
      return createMockImageProvider(async () => {
        const result = adapterHolder.result;
        if (!result) {
          throw new Error("mock image adapter result not configured for this test");
        }
        return result;
      }) as ImageGenerationProvider;
    });
    registered = true;
  }
}

function session(overrides: Partial<SessionSafe> = {}): SessionSafe {
  return {
    id: "session-1",
    telegramUserId: 123n,
    telegramChatId: 456n,
    status: "generating",
    activeRevisionId: "revision-1",
    activeGenerationAttemptId: null,
    preferredImageProviderConfigId: null,
    telegramStatusMessageId: 777,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

function revision(overrides: Partial<RevisionSafe> = {}): RevisionSafe {
  return {
    id: "revision-1",
    sessionId: "session-1",
    revisionNumber: 1,
    sourcePrompt: "a cozy cabin",
    previousPrompt: null,
    revisionInstruction: null,
    enhancedPrompt: "A cozy cabin at dusk, cinematic lighting",
    negativePrompt: "blurry",
    aspectRatio: "1:1",
    reasoningProviderConfigId: "config-reasoning",
    status: "completed",
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function attempt(overrides: Partial<GenerationAttemptSafe> = {}): GenerationAttemptSafe {
  return {
    id: "attempt-1",
    sessionId: "session-1",
    revisionId: "revision-1",
    attemptNumber: 1,
    status: "processing",
    imageProviderConfigId: "config-image",
    providerRequestId: null,
    parameters: {},
    telegramMessageId: null,
    errorCode: null,
    errorMessageRedacted: null,
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function config(): ProviderConfigSafe {
  return {
    id: "config-image",
    capability: "image_generation",
    adapterType: MOCK_ADAPTER,
    name: "mock image",
    baseUrl: "https://mock.example.com/v1",
    model: "mock",
    settings: {},
    selectionStrategy: "priority_failover",
    priority: 0,
    weight: 1,
    isActive: true,
    configVersion: 1,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function key(): ProviderKeySafe {
  return {
    id: "key-1",
    providerConfigId: "config-image",
    fingerprint: "fp",
    weight: 1,
    isActive: true,
    failureCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function job(overrides: Partial<Record<string, unknown>> = {}): JobSafe {
  return {
    id: "job-1",
    jobType: "generate_image",
    promptSessionId: "session-1",
    promptRevisionId: "revision-1",
    generationAttemptId: null,
    status: "processing",
    payload: {},
    attemptCount: 1,
    maxAttempts: 4,
    availableAt: "2026-01-01T00:00:00Z",
    lockedBy: "processor-abc",
    lastErrorCode: null,
    lastErrorMessageRedacted: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    ...overrides,
  } as JobSafe;
}

// Collects call observations from the mock repositories.
type Harness = {
  useCase: GenerateImageUseCase;
  calls: {
    createAttempt: { sessionId: string; revisionId: string }[];
    markProcessing: { attemptId: string }[];
    attachProviderToAttempt: { attemptId: string; parameters?: Record<string, unknown> }[];
    sendPhoto: { imageUrl: string }[];
    editStatusMessage: { text: string }[];
    markAttemptSucceeded: { attemptId: string; messageId: number | null }[];
    markProviderRequestSucceeded: { requestId: string }[];
    markProviderRequestFailed: { requestId: string; errorCode: string }[];
    markKeyFailure: { keyId: string }[];
    markKeySuccess: { keyId: string }[];
    markAttemptFailed: { attemptId: string; errorCode: string }[];
  };
};

function buildUseCase(
  overrides: {
    adapterResult?: Promise<ImageGenerationResult>;
    sendPhotoResult?: { messageId: number };
    sendPhotoError?: unknown;
    transitionSuccess?: boolean;
    imageConfigs?: ProviderConfigSafe[];
    attemptNumber?: number;
    selectProviderError?: unknown;
  } = {},
): Harness {
  const calls: Harness["calls"] = {
    createAttempt: [],
    markProcessing: [],
    attachProviderToAttempt: [],
    sendPhoto: [],
    editStatusMessage: [],
    markAttemptSucceeded: [],
    markProviderRequestSucceeded: [],
    markProviderRequestFailed: [],
    markKeyFailure: [],
    markKeySuccess: [],
    markAttemptFailed: [] as { attemptId: string; errorCode: string }[],
  };

  const adapterResult =
    overrides.adapterResult ??
    Promise.resolve<ImageGenerationResult>({
      status: "completed",
      imageUrl: "https://cdn.mock.example.com/image.png",
      mimeType: "image/png",
      metadata: {},
    });

  adapterHolder.result = adapterResult;
  registerMockAdapter();

  const genRepo = {
    getAttemptById: vi.fn(async () => attempt()),
    createAttempt: vi.fn(async (input: { sessionId: string; revisionId: string }) => {
      calls.createAttempt.push(input);
      return { attemptId: "attempt-1", attemptNumber: overrides.attemptNumber ?? 1 };
    }),
    markProcessing: vi.fn(async (attemptId: string) => {
      calls.markProcessing.push({ attemptId });
    }),
    attachProviderToAttempt: vi.fn(
      async (attemptId: string, _configId: string, parameters?: Record<string, unknown>) => {
        calls.attachProviderToAttempt.push({ attemptId, parameters });
      },
    ),
    markAttemptSucceeded: vi.fn(
      async (attemptId: string, _providerRequestId: string | null, messageId: number | null) => {
        calls.markAttemptSucceeded.push({ attemptId, messageId });
      },
    ),
    markAttemptFailed: vi.fn(async (attemptId: string, errorCode: string) => {
      calls.markAttemptFailed.push({ attemptId, errorCode });
    }),
    completeSession: vi.fn(async () => {}),
    recordProviderRequest: vi.fn(async () => "request-1"),
    markProviderRequestSucceeded: vi.fn(async (input: { requestId: string }) => {
      calls.markProviderRequestSucceeded.push(input);
    }),
    markProviderRequestFailed: vi.fn(async (input: { requestId: string; errorCode: string }) => {
      calls.markProviderRequestFailed.push(input);
    }),
  };

  const sessionRepo = {
    getById: vi.fn(async () => session()),
  };

  const enhancementRepo = {
    getRevisionById: vi.fn(async () => revision()),
  };

  const configRepo = {
    listActive: vi.fn(async () => {
      if (overrides.selectProviderError) throw overrides.selectProviderError;
      return overrides.imageConfigs ?? [config()];
    }),
  };

  const keyRepo = {
    listSafeKeys: vi.fn(async () => [key()]),
    markFailure: vi.fn(async (input: { keyId: string }) => {
      calls.markKeyFailure.push(input);
    }),
    markSuccess: vi.fn(async (input: { keyId: string }) => {
      calls.markKeySuccess.push(input);
    }),
  };

  const vaultRepo = {
    getDecryptableKey: vi.fn(async () => ({ plaintext: "dummy-key", fingerprint: "fp" })),
  };

  const sendPhoto =
    overrides.sendPhotoError !== undefined
      ? vi.fn(async () => {
          throw overrides.sendPhotoError;
        })
      : vi.fn(async (input: { imageUrl: string }) => {
          calls.sendPhoto.push(input);
          return overrides.sendPhotoResult ?? { messageId: 900 };
        });

  const editStatusMessage = vi.fn(async (input: { text: string }) => {
    calls.editStatusMessage.push(input);
  });

  const transitionSuccess = overrides.transitionSuccess ?? true;
  rpcMock.transition = transitionSuccess ? { id: "session-1" } : null;

  const useCase = new GenerateImageUseCase({
    providerConfigRepository: configRepo as never,
    providerKeyRepository: keyRepo as never,
    providerKeyVaultRepository: vaultRepo as never,
    generationRepository: genRepo as never,
    enhancementRepository: enhancementRepo as never,
    sessionRepository: sessionRepo as never,
    attachGenerationAttempt: vi.fn(async () => {}),
    sendPhoto,
    editStatusMessage,
  });

  return { useCase, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  rpcMock.transition = true;
  resetServerEnvCache();
});

beforeEach(() => {
  withEnv();
});

describe("GenerateImageUseCase", () => {
  it("generates an image, delivers via sendPhoto, and completes the attempt", async () => {
    const { useCase, calls } = buildUseCase();

    const outcome = await useCase.execute(job());

    expect(outcome.status).toBe("completed");
    expect(calls.createAttempt).toEqual([{ sessionId: "session-1", revisionId: "revision-1" }]);
    expect(calls.markProcessing).toEqual([{ attemptId: "attempt-1" }]);
    expect(calls.attachProviderToAttempt).toHaveLength(1);
    expect(calls.attachProviderToAttempt[0].attemptId).toBe("attempt-1");
    expect(calls.attachProviderToAttempt[0].parameters).toHaveProperty("seed");
    expect(calls.sendPhoto).toHaveLength(1);
    expect(calls.sendPhoto[0].imageUrl).toBe("https://cdn.mock.example.com/image.png");
    expect(calls.editStatusMessage).toEqual([
      expect.objectContaining({ text: "Gambar 1 dari revisi 1 berhasil dibuat." }),
    ]);
    expect(calls.markAttemptSucceeded).toEqual([{ attemptId: "attempt-1", messageId: 900 }]);
    expect(calls.markProviderRequestSucceeded).toHaveLength(1);
    expect(calls.markKeySuccess).toEqual([{ keyId: "key-1", providerConfigId: "config-image" }]);
  });

  it("returns expired without calling the provider", async () => {
    const { calls } = buildUseCase();
    // Override session to be expired via the repository mock: rebuild with an
    // expired session by spying on sessionRepository differently.
    const genRepo = {
      getAttemptById: vi.fn(async () => attempt()),
      createAttempt: vi.fn(async () => ({ attemptId: "attempt-1", attemptNumber: 1 })),
      markProcessing: vi.fn(async () => {}),
      markAttemptSucceeded: vi.fn(async () => {}),
      markAttemptFailed: vi.fn(async () => {}),
      completeSession: vi.fn(async () => {}),
      recordProviderRequest: vi.fn(async () => "request-1"),
      markProviderRequestSucceeded: vi.fn(async () => {}),
      markProviderRequestFailed: vi.fn(async () => {}),
    };
    const sessionRepo = {
      getById: vi.fn(async () => session({ expiresAt: "2020-01-01T00:00:00Z" })),
    };
    const useCase2 = new GenerateImageUseCase({
      providerConfigRepository: { listActive: vi.fn(async () => [config()]) } as never,
      providerKeyRepository: { listSafeKeys: vi.fn(async () => [key()]) } as never,
      providerKeyVaultRepository: {
        getDecryptableKey: vi.fn(async () => ({ plaintext: "k", fingerprint: "fp" })),
      } as never,
      generationRepository: genRepo as never,
      enhancementRepository: { getRevisionById: vi.fn(async () => revision()) } as never,
      sessionRepository: sessionRepo as never,
      attachGenerationAttempt: vi.fn(async () => {}),
      sendPhoto: vi.fn(async () => ({ messageId: 1 })),
    });

    const outcome = await useCase2.execute(job());

    expect(outcome.status).toBe("expired");
    expect(calls.createAttempt).toHaveLength(0);
  });

  it("rejects a pending adapter result as non-retryable", async () => {
    const pending: ImageGenerationResult = {
      status: "pending",
      providerRequestId: "pr-1",
      pollAfterMs: 1000,
      metadata: {},
    };
    const { useCase } = buildUseCase({ adapterResult: Promise.resolve(pending) });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("rejects a non-https image url as non-retryable", async () => {
    const bad: ImageGenerationResult = {
      status: "completed",
      imageUrl: "http://cdn.example.com/insecure.png",
      metadata: {},
    };
    const { useCase } = buildUseCase({ adapterResult: Promise.resolve(bad) });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "provider_response_invalid",
      retryable: false,
    });
  });

  it("marks key failure on a 429 and rethrows the retryable error", async () => {
    const { useCase, calls } = buildUseCase({
      adapterResult: Promise.reject(makeRetryable("provider_rate_limited", "429")),
    });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
    });
    expect(calls.markKeyFailure).toEqual([{ keyId: "key-1", providerConfigId: "config-image" }]);
    expect(calls.markProviderRequestFailed).toEqual([
      { requestId: "request-1", errorCode: "provider_rate_limited" },
    ]);
  });

  it("marks key failure on a 401 and rethrows the non-retryable error", async () => {
    const { useCase, calls } = buildUseCase({
      adapterResult: Promise.reject(makeNonRetryable("provider_authentication_failed", "401")),
    });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "provider_authentication_failed",
      retryable: false,
    });
    expect(calls.markKeyFailure).toEqual([{ keyId: "key-1", providerConfigId: "config-image" }]);
  });

  it("treats a delivery failure as a terminal telegram_delivery_failed", async () => {
    const { useCase, calls } = buildUseCase({
      sendPhotoError: new Error("telegram 400"),
    });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "telegram_delivery_failed",
      retryable: false,
    });
    expect(calls.markAttemptSucceeded).toHaveLength(0);
    expect(calls.markProviderRequestFailed).toEqual([
      { requestId: "request-1", errorCode: "telegram_delivery_failed" },
    ]);
  });

  it("treats a stale CAS claim as completed without generating", async () => {
    const { useCase, calls } = buildUseCase({ transitionSuccess: false });

    const outcome = await useCase.execute(job({ generationAttemptId: "attempt-1" }));

    expect(outcome.status).toBe("completed");
    expect(calls.createAttempt).toHaveLength(0);
    expect(calls.sendPhoto).toHaveLength(0);
    expect(calls.editStatusMessage).toEqual([
      expect.objectContaining({ text: "Gambar berhasil dibuat." }),
    ]);
  });

  it("marks the attempt failed when provider selection fails", async () => {
    const { useCase, calls } = buildUseCase({
      selectProviderError: makeNonRetryable("provider_key_unavailable", "no eligible keys"),
    });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "provider_key_unavailable",
      retryable: false,
    });
    // The attempt must not be left in processing: it is marked failed so a
    // retry or complete is never blocked.
    expect(calls.markAttemptFailed).toEqual([
      { attemptId: "attempt-1", errorCode: "provider_key_unavailable" },
    ]);
    // No provider request was recorded (selection failed before that), so it
    // must not be marked failed either.
    expect(calls.markProviderRequestFailed).toHaveLength(0);
  });

  it("marks the attempt failed on a retryable provider error", async () => {
    const { useCase, calls } = buildUseCase({
      adapterResult: Promise.reject(makeRetryable("provider_rate_limited", "429")),
    });

    await expect(useCase.execute(job())).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryable: true,
    });
    expect(calls.markAttemptFailed).toEqual([
      { attemptId: "attempt-1", errorCode: "provider_rate_limited" },
    ]);
  });
});
