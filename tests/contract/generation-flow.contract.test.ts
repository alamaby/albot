import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getAdminClient, assertHostedOrSkip, getHostedEnv } from "../helpers/hosted";
import { resetServerEnvCache } from "@/env";
import { GenerateImageUseCase } from "@/server/application/generate-image";
import { getProviderRegistry } from "@/server/providers/registry";
import type { GenerateImageInput, ImageGenerationResult } from "@/server/domain/provider";
import { createMockImageProvider } from "@/server/providers/mock/mock-image.adapter";
import type { ImageGenerationProvider } from "@/server/domain/provider";

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
    | "generation_attempts"
    | "prompt_sessions"
    | "prompt_revisions";
  id: string;
}[] = [];

// Register a mock image adapter under a test-only type so the use case can
// exercise the full orchestration without hitting a real provider.
const MOCK_ADAPTER = "mock_image_generation_contract";
let registered = false;

// Ids of image configs that existed before this test and were temporarily
// deactivated so the mock config (priority 0) is deterministically selected.
const deactivatedConfigIds: string[] = [];

beforeAll(async () => {
  if (skip) return;
  if (!registered) {
    getProviderRegistry().registerImage(MOCK_ADAPTER, () => {
      return createMockImageProvider(async (input: GenerateImageInput) => {
        const result: ImageGenerationResult = {
          status: "completed",
          imageUrl: `https://cdn.mock.example.com/${encodeURIComponent(input.prompt.slice(0, 40))}.png`,
          mimeType: "image/png",
          providerRequestId: `mock-req-${Date.now()}`,
          metadata: { mock: true },
        };
        return result;
      }) as ImageGenerationProvider;
    });
    registered = true;
  }

  // Isolate the test: deactivate any pre-existing active image configs so the
  // selector cannot pick them (e.g. a seeded real Pixazo config in dev).
  const admin = getAdminClient();
  const { data: active } = await admin
    .from("provider_configs")
    .select("id")
    .eq("capability", "image_generation")
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

// FK-safe delete order: provider_requests -> jobs -> generation_attempts ->
// prompt_sessions -> prompt_revisions -> provider_keys -> provider_configs.
// prompt_sessions holds active_revision_id/active_generation_attempt_id, so
// sessions go before revisions/attempts they point at.
const CLEANUP_ORDER = [
  "provider_requests",
  "jobs",
  "generation_attempts",
  "prompt_sessions",
  "prompt_revisions",
  "provider_keys",
  "provider_configs",
] as const;

describe.skipIf(skip)("generation flow contract", () => {
  it("generates an image, persists the attempt, and transitions the session", async () => {
    const admin = getAdminClient();

    // 1. Provider config + key (encrypted with the all-ones test key).
    const encryptionKey = Buffer.alloc(32, 1);
    const { data: config } = await admin
      .from("provider_configs")
      .insert({
        capability: "image_generation",
        adapter_type: MOCK_ADAPTER,
        name: "contract mock image",
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

    // 2. Session + completed revision + generate job.
    const { data: session } = await admin
      .from("prompt_sessions")
      .insert({
        telegram_user_id: USER_ID,
        telegram_chat_id: USER_ID + 1,
        status: "generating",
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
        source_prompt: "a cozy cabin",
        enhanced_prompt: "A cozy cabin at dusk, cinematic lighting",
        negative_prompt: "blurry",
        aspect_ratio: "1:1",
        status: "completed",
      })
      .select("id")
      .single();
    cleanup.push({ table: "prompt_revisions", id: revision!.id });

    const { data: job } = await admin
      .from("jobs")
      .insert({
        job_type: "generate_image",
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
    const useCase = new GenerateImageUseCase({
      sendPhoto: vi.fn(async () => ({ messageId: 7777 })),
    });
    const outcome = await useCase.execute({
      id: job!.id,
      jobType: "generate_image",
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
    if (outcome.status !== "completed") throw new Error("expected completed outcome");
    const attemptId = outcome.attempt.id;

    // 4. Assert persisted state.
    const { data: persistedAttempt } = await admin
      .from("generation_attempts")
      .select(
        "id, attempt_number, status, revision_id, telegram_message_id, provider_request_id, image_provider_config_id",
      )
      .eq("id", attemptId)
      .single();
    expect(persistedAttempt).toMatchObject({
      attempt_number: 1,
      status: "succeeded",
      revision_id: revision!.id,
      telegram_message_id: 7777,
    });
    expect(persistedAttempt?.image_provider_config_id).toBe(config!.id);
    expect(persistedAttempt?.provider_request_id).toBeTruthy();

    const { data: persistedSession } = await admin
      .from("prompt_sessions")
      .select("status, active_generation_attempt_id")
      .eq("id", session!.id)
      .single();
    expect(persistedSession?.status).toBe("result_ready");
    expect(persistedSession?.active_generation_attempt_id).toBe(attemptId);

    const { data: requests } = await admin
      .from("provider_requests")
      .select("id, status, capability, provider_config_id, provider_key_id")
      .eq("job_id", job!.id);
    expect(requests).toHaveLength(1);
    expect(requests![0]).toMatchObject({
      status: "succeeded",
      capability: "image_generation",
      provider_config_id: config!.id,
    });
    // Track the request row so cleanup can remove it before the job (FK
    // provider_requests.job_id -> jobs.id is ON DELETE RESTRICT).
    cleanup.push({ table: "provider_requests", id: requests![0].id });

    // The job row must have been linked to the attempt.
    const { data: persistedJob } = await admin
      .from("jobs")
      .select("generation_attempt_id")
      .eq("id", job!.id)
      .single();
    expect(persistedJob?.generation_attempt_id).toBe(attemptId);
  });
});
