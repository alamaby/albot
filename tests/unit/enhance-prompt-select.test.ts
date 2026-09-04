import { afterEach, describe, expect, it, vi } from "vitest";
import { EnhancePromptUseCase } from "@/server/application/enhance-prompt";
import { resetServerEnvCache } from "@/env";
import { ProviderSelector, type SelectedProvider } from "@/server/providers/selector";
import type { ProviderConfigSafe } from "@/server/repositories/provider-config.repository";
import type { ProviderKeySafe } from "@/server/repositories/provider-key.repository";

const prefMock = vi.hoisted(() => ({
  getByTelegramUserId: vi.fn(
    async () =>
      null as null | {
        telegramUserId: bigint;
        preferredProviderConfigId: string;
        createdAt: string;
        updatedAt: string;
      },
  ),
  upsert: vi.fn(async () => undefined),
}));

vi.mock("@/server/repositories/user-reasoning-preference.repository", () => {
  class UserReasoningPreferenceRepository {
    getByTelegramUserId = prefMock.getByTelegramUserId;
    upsert = prefMock.upsert;
  }
  return { UserReasoningPreferenceRepository };
});

function withEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-placeholder-value-1234567890";
  process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
  process.env.JOB_PROCESSOR_SECRET = "job-processor-secret-0123456789abcdef";
  resetServerEnvCache();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // Restore the default (no per-user preference) so a mockResolvedValue from a
  // previous test cannot leak into the next one.
  prefMock.getByTelegramUserId.mockImplementation(async () => null);
  resetServerEnvCache();
});

function config(id: string, adapterType: string, priority: number): ProviderConfigSafe {
  return {
    id,
    capability: "reasoning",
    adapterType,
    name: `cfg-${id}`,
    baseUrl: "https://example.com/v1",
    model: null,
    settings: {},
    selectionStrategy: "priority_failover",
    keySelectionStrategy: null,
    priority,
    weight: 1,
    isActive: true,
  } as unknown as ProviderConfigSafe;
}

function key(id: string, providerConfigId: string): ProviderKeySafe {
  return {
    id,
    providerConfigId,
    label: null,
    weight: 1,
    priority: 100,
    isActive: true,
    failureCount: 0,
    cooldownUntil: null,
    lastUsedAt: null,
  } as unknown as ProviderKeySafe;
}

// A selector spy that records the configs it was asked to choose from and
// always picks the first config's first key.
function makeSelectorSpy() {
  const calls: { capability: string; configs: ProviderConfigSafe[] }[] = [];
  const selector = {
    selectProvider: vi.fn(async (capability: string, configs: ProviderConfigSafe[]) => {
      calls.push({ capability, configs });
      const chosen = configs[0];
      const chosenKey = key(`key-${chosen.id}`, chosen.id);
      const result: SelectedProvider = { config: chosen, key: chosenKey };
      return result;
    }),
    calls,
  };
  return selector as unknown as ProviderSelector & {
    calls: { capability: string; configs: ProviderConfigSafe[] }[];
  };
}

function buildUseCase(selector: ProviderSelector, configs: ProviderConfigSafe[]) {
  const keysFor = (id: string) => [key(`key-${id}`, id)];
  const useCase = new EnhancePromptUseCase({
    providerConfigRepository: {
      listActive: vi.fn(async () => configs),
      getById: vi.fn(async (id: string) => configs.find((c) => c.id === id) ?? null),
    } as never,
    providerKeyRepository: {
      listSafeKeys: vi.fn(async (id: string) => keysFor(id)),
      markSuccess: vi.fn(async () => {}),
      markFailure: vi.fn(async () => {}),
    } as never,
    providerKeyVaultRepository: {
      getDecryptableKey: vi.fn(async () => ({ plaintext: "k", fingerprint: "fp" })),
    } as never,
    enhancementRepository: {
      recordProviderRequest: vi.fn(async () => "req-1"),
      markProviderRequestSucceeded: vi.fn(async () => {}),
      markProviderRequestFailed: vi.fn(async () => {}),
    } as never,
    sessionRepository: { getById: vi.fn(async () => null) } as never,
    selector: selector as never,
    promptAuditRepository: { insert: vi.fn(async () => {}) } as never,
    promptConfigRepository: {
      getActivePersona: vi.fn(async (key: string) => {
        if (key === "reasoning_sampling") return '{"temperature":0.7,"max_tokens":1024}';
        if (key === "reasoning_revision_helper") return "helper";
        return "persona";
      }),
    } as never,
    sendConfirmation: vi.fn(async () => {}),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  return useCase;
}

// enhanceOnly runs the full path (select -> audit -> adapter -> validate); stub
// the upstream fetch so the adapter call succeeds after the selection under
// test.
function stubFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ message: { content: '{"prompt":"enhanced prompt"}' } }],
        model: "m",
      }),
    })),
  );
}

describe("EnhancePromptUseCase.selectProvider (hybrid)", () => {
  it("honors the session preferred reasoning provider when eligible", async () => {
    withEnv();
    stubFetchOk();
    const selector = makeSelectorSpy();
    const preferred = config("cfg-by", "bynara", 160);
    const primary = config("cfg-cf", "openai_compatible", 0);
    const useCase = buildUseCase(selector, [primary, preferred]);

    // execute() path: session with preferredReasoningProviderConfigId. We call
    // selectProvider indirectly via enhanceOnly to keep the seam (no session).
    await useCase.enhanceOnly({
      jobId: "job-1",
      sourcePrompt: "a cat",
      preferredConfigId: "cfg-by",
    });

    expect(selector.calls).toHaveLength(1);
    expect(selector.calls[0]!.configs.map((c) => c.id)).toEqual(["cfg-by"]);
  });

  it("falls back to the selector when no preference is set", async () => {
    withEnv();
    stubFetchOk();
    const selector = makeSelectorSpy();
    const primary = config("cfg-cf", "openai_compatible", 0);
    const secondary = config("cfg-poll", "pollinations", 150);
    const useCase = buildUseCase(selector, [primary, secondary]);

    await useCase.enhanceOnly({ jobId: "job-1", sourcePrompt: "a cat" });

    expect(selector.calls).toHaveLength(1);
    expect(selector.calls[0]!.configs.map((c) => c.id)).toEqual(["cfg-cf", "cfg-poll"]);
  });

  it("falls back to the per-user default reasoning preference", async () => {
    withEnv();
    stubFetchOk();
    prefMock.getByTelegramUserId.mockResolvedValue({
      telegramUserId: 123n,
      preferredProviderConfigId: "cfg-poll",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const selector = makeSelectorSpy();
    const primary = config("cfg-cf", "openai_compatible", 0);
    const secondary = config("cfg-poll", "pollinations", 150);
    const useCase = buildUseCase(selector, [primary, secondary]);

    await useCase.enhanceOnly({
      jobId: "job-1",
      sourcePrompt: "a cat",
      telegramUserId: 123n,
    });

    expect(selector.calls).toHaveLength(1);
    expect(selector.calls[0]!.configs.map((c) => c.id)).toEqual(["cfg-poll"]);
  });

  it("ignores a preference for an inactive config and uses the selector", async () => {
    withEnv();
    stubFetchOk();
    const selector = makeSelectorSpy();
    const primary = config("cfg-cf", "openai_compatible", 0);
    const inactive = { ...config("cfg-x", "openrouter_m3", 230), isActive: false };
    const useCase = buildUseCase(selector, [primary, inactive]);

    await useCase.enhanceOnly({
      jobId: "job-1",
      sourcePrompt: "a cat",
      preferredConfigId: "cfg-x",
    });

    // Preferred config is inactive -> full selector fallback.
    expect(selector.calls).toHaveLength(1);
    expect(selector.calls[0]!.configs.map((c) => c.id)).toEqual(["cfg-cf", "cfg-x"]);
  });

  it("ignores a preference whose keys are all cooling down", async () => {
    withEnv();
    stubFetchOk();
    const selector = makeSelectorSpy();
    const primary = config("cfg-cf", "openai_compatible", 0);
    const preferred = config("cfg-by", "bynara", 160);
    const useCase = new EnhancePromptUseCase({
      providerConfigRepository: {
        listActive: vi.fn(async () => [primary, preferred]),
        getById: vi.fn(async (id: string) => [primary, preferred].find((c) => c.id === id) ?? null),
      } as never,
      providerKeyRepository: {
        listSafeKeys: vi.fn(async (id: string) =>
          id === "cfg-by"
            ? [
                {
                  ...key("key-cfg-by", "cfg-by"),
                  cooldownUntil: "2099-01-01T00:00:00Z",
                },
              ]
            : [key(`key-${id}`, id)],
        ),
        markSuccess: vi.fn(async () => {}),
        markFailure: vi.fn(async () => {}),
      } as never,
      providerKeyVaultRepository: {
        getDecryptableKey: vi.fn(async () => ({ plaintext: "k", fingerprint: "fp" })),
      } as never,
      enhancementRepository: {
        recordProviderRequest: vi.fn(async () => "req-1"),
        markProviderRequestSucceeded: vi.fn(async () => {}),
        markProviderRequestFailed: vi.fn(async () => {}),
      } as never,
      sessionRepository: { getById: vi.fn(async () => null) } as never,
      selector: selector as never,
      promptAuditRepository: { insert: vi.fn(async () => {}) } as never,
      promptConfigRepository: {
        getActivePersona: vi.fn(async (key: string) => {
          if (key === "reasoning_sampling") return '{"temperature":0.7,"max_tokens":1024}';
          if (key === "reasoning_revision_helper") return "helper";
          return "persona";
        }),
      } as never,
      sendConfirmation: vi.fn(async () => {}),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    await useCase.enhanceOnly({
      jobId: "job-1",
      sourcePrompt: "a cat",
      preferredConfigId: "cfg-by",
    });

    expect(selector.calls).toHaveLength(1);
    expect(selector.calls[0]!.configs.map((c) => c.id)).toEqual(["cfg-cf", "cfg-by"]);
  });
});
