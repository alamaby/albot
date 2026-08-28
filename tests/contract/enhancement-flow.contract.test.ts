import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getAdminClient, assertHostedOrSkip, getHostedEnv } from "../helpers/hosted";
import { resetServerEnvCache } from "@/env";
import { EnhancePromptUseCase } from "@/server/application/enhance-prompt";
import { getProviderRegistry } from "@/server/providers/registry";
import type { EnhancePromptInput } from "@/server/domain/provider";
import { createMockReasoningProvider } from "@/server/providers/mock/mock-reasoning.adapter";

const skip = assertHostedOrSkip();

if (!skip) {
  const env = getHostedEnv();
  if (env) {
    process.env.SUPABASE_URL = env.url;
    process.env.SUPABASE_SECRET_KEY = env.secretKey;
    process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
    process.env.JOB_PROCESSOR_SECRET = "job-processor-secret-0123456789abcdef";
  }
  resetServerEnvCache();
}

const RUN_SEED = Math.floor(Math.random() * 0xffff);
const USER_ID = 790000000 + (RUN_SEED % 9999);

const cleanup: {
  table:
    | "provider_keys"
    | "provider_configs"
    | "provider_requests"
    | "jobs"
    | "prompt_sessions"
    | "prompt_revisions";
  id: string;
}[] = [];

// Register a mock reasoning adapter under a test-only type so the use case can
// exercise the full orchestration without hitting a real provider.
const MOCK_ADAPTER = "mock_reasoning_contract";
let registered = false;

// Ids of reasoning configs that existed before this test and were temporarily
// deactivated so the mock config (priority 0) is deterministically selected.
const deactivatedConfigIds: string[] = [];

beforeAll(async () => {
  if (skip) return;
  if (!registered) {
    getProviderRegistry().registerReasoning(MOCK_ADAPTER, () => {
      return createMockReasoningProvider(async (input: EnhancePromptInput) => ({
        prompt: JSON.stringify({
          prompt: `[enhanced] ${input.sourcePrompt}`,
          negative_prompt: "blurry, low quality",
          aspect_ratio: "1:1",
        }),
        metadata: { mock: true },
      }));
    });
    registered = true;
  }

  // Isolate the test: deactivate any pre-existing active reasoning configs so
  // the selector cannot pick them (e.g. the seeded Cloudflare config in dev).
  const admin = getAdminClient();
  const { data: active } = await admin
    .from("provider_configs")
    .select("id")
    .eq("capability", "reasoning")
    .eq("is_active", true);
  for (const config of active ?? []) {
    await admin.from("provider_configs").update({ is_active: false }).eq("id", config.id);
    deactivatedConfigIds.push(config.id);
  }
});

afterAll(async () => {
  if (skip) return;
  if (deactivatedConfigIds.length > 0) {
    const admin = getAdminClient();
    for (const id of deactivatedConfigIds) {
      await admin.from("provider_configs").update({ is_active: true }).eq("id", id);
    }
    deactivatedConfigIds.length = 0;
  }
});

afterEach(async () => {
  const admin = getAdminClient();
  for (const table of CLEANUP_ORDER) {
    for (const item of cleanup.filter((c) => c.table === table)) {
      await admin
        .from(table)
        .delete()
        .eq("id", item.id as never);
    }
  }
  cleanup.length = 0;
  vi.restoreAllMocks();
  resetServerEnvCache();
});

// FK-safe delete order: provider_requests -> jobs -> prompt_sessions ->
// prompt_revisions -> provider_keys -> provider_configs. prompt_sessions holds
// active_revision_id pointing at prompt_revisions, so sessions go first.
const CLEANUP_ORDER = [
  "provider_requests",
  "jobs",
  "prompt_sessions",
  "prompt_revisions",
  "provider_keys",
  "provider_configs",
] as const;

describe.skipIf(skip)("enhancement flow contract", () => {
  it("enhances a prompt, persists the revision, and transitions the session", async () => {
    const admin = getAdminClient();

    // 1. Provider config + key (encrypted with the all-ones test key).
    const encryptionKey = Buffer.alloc(32, 1);
    const { data: config } = await admin
      .from("provider_configs")
      .insert({
        capability: "reasoning",
        adapter_type: MOCK_ADAPTER,
        name: "contract mock",
        base_url: "https://mock.example.com/v1",
        model: "mock",
        settings: {},
        selection_strategy: "priority_failover",
        priority: 0,
        weight: 1,
        is_active: true,
      })
      .select("id")
      .single();
    cleanup.push({ table: "provider_configs", id: config!.id });

    // Encrypt a dummy key with AES-256-GCM matching the vault's algorithm.
    const { encryptProviderKey } = await import("@/server/security/encryption");
    const encrypted = encryptProviderKey(
      "dummy-key",
      encryptionKey,
      `albot/provider-key/v1/${config!.id}`,
    );
    const { data: key } = await admin
      .from("provider_keys")
      .insert({
        provider_config_id: config!.id,
        key_ciphertext: encrypted.ciphertextBase64,
        key_iv: encrypted.ivBase64,
        key_auth_tag: encrypted.authTagBase64,
        key_fingerprint: encrypted.fingerprint,
        weight: 1,
        is_active: true,
      })
      .select("id")
      .single();
    cleanup.push({ table: "provider_keys", id: key!.id });

    // 2. Session + revision + enhance job.
    const { data: session } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: USER_ID,
        telegram_chat_id: USER_ID + 1,
        status: "received",
        expires_at: "2099-01-01T00:00:00.000Z",
      })
      .select("id")
      .single();
    cleanup.push({ table: "prompt_sessions", id: session!.id });

    const { data: revision } = await admin
      .from("prompt_revisions")
      .insert({
        session_id: session!.id,
        revision_number: 1,
        source_prompt: "a cozy cabin at dusk",
        status: "pending",
      })
      .select("id")
      .single();
    cleanup.push({ table: "prompt_revisions", id: revision!.id });

    const { data: job } = await admin
      .from("jobs")
      .insert({
        job_type: "enhance_prompt",
        prompt_session_id: session!.id,
        prompt_revision_id: revision!.id,
        status: "processing",
        payload: { test_tag: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
        attempt_count: 1,
        locked_at: new Date().toISOString(),
        locked_by: "worker-contract",
        lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
      })
      .select("id")
      .single();
    cleanup.push({ table: "jobs", id: job!.id });

    // 3. Run the use case with the real repositories (they read env creds).
    const useCase = new EnhancePromptUseCase({
      sendConfirmation: vi.fn(async () => {}),
    });
    const outcome = await useCase.execute({
      id: job!.id,
      jobType: "enhance_prompt",
      promptSessionId: session!.id,
      promptRevisionId: revision!.id,
      generationAttemptId: null,
      status: "processing",
      payload: {},
      attemptCount: 1,
      maxAttempts: 4,
      availableAt: "2026-01-01T00:00:00Z",
      lockedBy: "worker-contract",
      lastErrorCode: null,
      lastErrorMessageRedacted: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      completedAt: null,
    });

    expect(outcome.status).toBe("completed");

    // 4. Assert persisted state.
    const { data: persistedRevision } = await admin
      .from("prompt_revisions")
      .select(
        "status, enhanced_prompt, negative_prompt, aspect_ratio, reasoning_provider_config_id",
      )
      .eq("id", revision!.id)
      .single();
    expect(persistedRevision).toMatchObject({
      status: "completed",
      enhanced_prompt: "[enhanced] a cozy cabin at dusk",
      negative_prompt: "blurry, low quality",
      aspect_ratio: "1:1",
    });
    // The selector picks the highest-priority active config; any active
    // reasoning config is acceptable as long as it is recorded.
    expect(persistedRevision?.reasoning_provider_config_id).toBeTruthy();

    const { data: persistedSession } = await admin
      .from("prompt_sessions")
      .select("status")
      .eq("id", session!.id)
      .single();
    expect(persistedSession?.status).toBe("awaiting_confirmation");

    const { data: requests } = await admin
      .from("provider_requests")
      .select("id, status, capability, provider_config_id, provider_key_id")
      .eq("job_id", job!.id);
    expect(requests).toHaveLength(1);
    expect(requests![0]).toMatchObject({
      status: "succeeded",
      capability: "reasoning",
    });
    expect(requests![0].provider_config_id).toBe(persistedRevision?.reasoning_provider_config_id);
    // Track the request row so cleanup can remove it before the job (FK
    // provider_requests.job_id -> jobs.id is ON DELETE RESTRICT).
    cleanup.push({ table: "provider_requests", id: requests![0].id });
  });
});
