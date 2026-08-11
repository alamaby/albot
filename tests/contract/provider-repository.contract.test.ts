import { afterEach, describe, expect, it } from "vitest";
import { getAdminClient, getAnonClient, assertHostedOrSkip, getHostedEnv } from "../helpers/hosted";
import {
  encryptProviderKey,
  decryptProviderKey,
  computeFingerprint,
} from "@/server/security/encryption";
import {
  ProviderKeyRepository,
  type MarkSuccessInput,
} from "@/server/repositories/provider-key.repository";
import { ProviderKeyVaultRepository } from "@/server/repositories/provider-key-vault.repository";
import { resetServerEnvCache } from "@/env";

const skip = assertHostedOrSkip();

const TEST_ROOT_KEY = Buffer.alloc(32, 1);
const ASSOCIATED_DATA_PREFIX = "albot/provider-key/v1";

// ProviderKeyRepository resolves its admin client through getServerEnv(), which
// reads the base environment names (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// The hosted test harness uses _DEV suffixed names, so map them onto the base
// names and reset the env cache before the repository is used. The Telegram and
// processor secrets are required by the env schema since Milestone 3; dummy
// values satisfy the parser (they are not used by this suite).
if (!skip) {
  const env = getHostedEnv();
  if (env) {
    process.env.SUPABASE_URL = env.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceRoleKey;
    process.env.PROVIDER_KEY_ENCRYPTION_KEY = TEST_ROOT_KEY.toString("base64");
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
    process.env.JOB_PROCESSOR_SECRET = "job-processor-secret-0123456789abcdef";
  }
  resetServerEnvCache();
}

const cleanup: { table: "provider_keys" | "provider_configs"; id: string }[] = [];

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

async function insertConfig() {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("provider_configs")
    .insert({
      capability: "image_generation",
      adapter_type: "pixazo_flux_schnell",
      name: "contract-test-config",
      base_url: "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
      model: "flux-1-schnell",
      settings: {},
      selection_strategy: "priority_failover",
      priority: 100,
      weight: 1,
      is_active: true,
    })
    .select("id")
    .single();
  expect(error, `insert provider_config: ${error?.message ?? ""}`).toBeNull();
  cleanup.push({ table: "provider_configs", id: data!.id });
  return data!.id;
}

async function insertEncryptedKey(configId: string, plaintext: string, label?: string) {
  const admin = getAdminClient();
  const associatedData = `${ASSOCIATED_DATA_PREFIX}/${configId}`;
  const encrypted = encryptProviderKey(plaintext, TEST_ROOT_KEY, associatedData);
  const { data, error } = await admin
    .from("provider_keys")
    .insert({
      provider_config_id: configId,
      key_ciphertext: encrypted.ciphertextBase64,
      key_iv: encrypted.ivBase64,
      key_auth_tag: encrypted.authTagBase64,
      key_fingerprint: encrypted.fingerprint,
      label: label ?? null,
      weight: 1,
    })
    .select(
      "id, provider_config_id, key_fingerprint, label, weight, is_active, failure_count, cooldown_until",
    )
    .single();
  expect(error, `insert provider_key: ${error?.message ?? ""}`).toBeNull();
  cleanup.push({ table: "provider_keys", id: data!.id });
  return { id: data!.id, fingerprint: data!.key_fingerprint };
}

describe.skipIf(skip)("ProviderKeyRepository DB contract", () => {
  it("stores only encrypted material and exposes a safe projection", async () => {
    const configId = await insertConfig();
    const admin = getAdminClient();
    const plaintext = "sk-contract-secret-1";
    const { id } = await insertEncryptedKey(configId, plaintext, "primary");

    // Safe projection must never include ciphertext material.
    const { data: safe } = await admin
      .from("provider_keys")
      .select(
        "id, provider_config_id, key_fingerprint, label, weight, is_active, failure_count, cooldown_until, last_used_at, created_at, updated_at",
      )
      .eq("id", id)
      .single();
    expect(safe).not.toBeNull();
    const safeKeys = Object.keys(safe!).sort();
    expect(safeKeys).not.toContain("key_ciphertext");
    expect(safeKeys).not.toContain("key_iv");
    expect(safeKeys).not.toContain("key_auth_tag");
    expect(safe).toMatchObject({
      provider_config_id: configId,
      key_fingerprint: computeFingerprint(plaintext),
      is_active: true,
      failure_count: 0,
    });

    // Vault read must decrypt back to the original plaintext with a matching fingerprint.
    const { data: vaultRow } = await admin
      .from("provider_keys")
      .select("key_ciphertext, key_iv, key_auth_tag, key_fingerprint")
      .eq("id", id)
      .single();
    const decrypted = decryptProviderKey(
      {
        version: 1,
        algorithm: "aes-256-gcm",
        ciphertextBase64: vaultRow!.key_ciphertext,
        ivBase64: vaultRow!.key_iv,
        authTagBase64: vaultRow!.key_auth_tag,
        fingerprint: vaultRow!.key_fingerprint,
      },
      TEST_ROOT_KEY,
      `${ASSOCIATED_DATA_PREFIX}/${configId}`,
    );
    expect(decrypted).not.toBeNull();
    expect(decrypted!.plaintext).toBe(plaintext);
    expect(decrypted!.fingerprint).toBe(computeFingerprint(plaintext));

    // Plaintext must not appear anywhere in the persisted row.
    expect(JSON.stringify(vaultRow)).not.toContain(plaintext);
  });

  it("increments failure_count atomically and applies cooldown at threshold", async () => {
    const configId = await insertConfig();
    const admin = getAdminClient();
    const { id } = await insertEncryptedKey(configId, "sk-contract-failure-1");

    const first = await admin.rpc("increment_provider_key_failure", {
      p_provider_config_id: configId,
      p_key_id: id,
      p_threshold: 3,
    });
    expect(first.error).toBeNull();
    expect(first.data![0]).toMatchObject({ id, failure_count: 1, cooldown_until: null });

    const second = await admin.rpc("increment_provider_key_failure", {
      p_provider_config_id: configId,
      p_key_id: id,
      p_threshold: 3,
    });
    expect(second.error).toBeNull();
    expect(second.data![0]).toMatchObject({ id, failure_count: 2, cooldown_until: null });

    // Third failure crosses the threshold and must set an escalating cooldown.
    const third = await admin.rpc("increment_provider_key_failure", {
      p_provider_config_id: configId,
      p_key_id: id,
      p_threshold: 3,
    });
    expect(third.error).toBeNull();
    expect(third.data![0].failure_count).toBe(3);
    expect(third.data![0].cooldown_until).not.toBeNull();
    expect(new Date(third.data![0].cooldown_until!).getTime()).toBeGreaterThan(Date.now());

    // Success resets the failure state and clears the cooldown.
    const success = await admin
      .from("provider_keys")
      .update({ failure_count: 0, cooldown_until: null, last_used_at: new Date().toISOString() })
      .eq("id", id);
    expect(success.error).toBeNull();
    const { data: after } = await admin
      .from("provider_keys")
      .select("failure_count, cooldown_until")
      .eq("id", id)
      .single();
    expect(after).toMatchObject({ failure_count: 0, cooldown_until: null });
  });

  it("rejects invalid threshold and unknown keys", async () => {
    const configId = await insertConfig();
    const admin = getAdminClient();

    const badThreshold = await admin.rpc("increment_provider_key_failure", {
      p_provider_config_id: configId,
      p_key_id: "00000000-0000-0000-0000-000000000000",
      p_threshold: 0,
    });
    expect(badThreshold.error).not.toBeNull();

    const unknownKey = await admin.rpc("increment_provider_key_failure", {
      p_provider_config_id: configId,
      p_key_id: "00000000-0000-0000-0000-000000000000",
      p_threshold: 3,
    });
    expect(unknownKey.error).not.toBeNull();
  });

  it("supports rotation via compare-and-set deactivation", async () => {
    const configId = await insertConfig();
    const admin = getAdminClient();
    const oldKey = await insertEncryptedKey(configId, "sk-contract-rotation-old");
    const newKey = await insertEncryptedKey(configId, "sk-contract-rotation-new");

    // Rotate: deactivate the oldest active key only if it is still active (CAS).
    const { data: oldest } = await admin
      .from("provider_keys")
      .select("id")
      .eq("provider_config_id", configId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    expect(oldest!.id).toBe(oldKey.id);

    const cas = await admin
      .from("provider_keys")
      .update({ is_active: false })
      .eq("id", oldest!.id)
      .eq("provider_config_id", configId)
      .eq("is_active", true);
    expect(cas.error).toBeNull();

    // A second CAS attempt is a no-op because the key is already inactive.
    const staleCas = await admin
      .from("provider_keys")
      .update({ is_active: false })
      .eq("id", oldest!.id)
      .eq("provider_config_id", configId)
      .eq("is_active", true)
      .select("id");
    expect(staleCas.error).toBeNull();
    expect(staleCas.data).toHaveLength(0);

    const { data: keys } = await admin
      .from("provider_keys")
      .select("id, is_active")
      .eq("provider_config_id", configId)
      .order("created_at", { ascending: true });
    const active = (keys ?? []).filter((k) => k.is_active).map((k) => k.id);
    expect(active).toEqual([newKey.id]);
  });

  it("denies anonymous access to provider keys", async () => {
    const configId = await insertConfig();
    await insertEncryptedKey(configId, "sk-contract-anon-denied");

    const anon = getAnonClient();
    const { data, error } = await anon.from("provider_keys").select("id");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("markSuccess throws when the key does not exist", async () => {
    const configId = await insertConfig();
    const repo = new ProviderKeyRepository(TEST_ROOT_KEY);

    const input: MarkSuccessInput = {
      keyId: "00000000-0000-0000-0000-000000000000",
      providerConfigId: configId,
    };
    await expect(repo.markSuccess(input)).rejects.toThrow("key not found");
  });

  it("rotateKey rolls back the new key when vault verification throws", async () => {
    const configId = await insertConfig();
    const admin = getAdminClient();

    // Vault stub that throws on decrypt so the verification path fails.
    const throwingVault = {
      getDecryptableKey: async () => {
        throw new Error("vault unavailable");
      },
    } as unknown as ProviderKeyVaultRepository;
    const repo = new ProviderKeyRepository(TEST_ROOT_KEY, throwingVault);

    await expect(
      repo.rotateKey({
        providerConfigId: configId,
        plaintextKey: "sk-contract-rotate-throw",
        weight: 1,
      }),
    ).rejects.toThrow("vault unavailable");

    // The newly inserted key must have been rolled back (no active key remains).
    const { data: keys } = await admin
      .from("provider_keys")
      .select("id, is_active")
      .eq("provider_config_id", configId);
    expect(keys ?? []).toHaveLength(0);
  });

  it("rotateKey rolls back the new key when decryption verification mismatches", async () => {
    const configId = await insertConfig();
    const admin = getAdminClient();

    // Vault stub that returns a wrong plaintext so verification mismatches.
    const mismatchingVault = {
      getDecryptableKey: async () => ({
        id: "00000000-0000-0000-0000-000000000000",
        providerConfigId: configId,
        plaintext: "different-secret",
        fingerprint: "deadbeef",
      }),
    } as unknown as ProviderKeyVaultRepository;
    const repo = new ProviderKeyRepository(TEST_ROOT_KEY, mismatchingVault);

    await expect(
      repo.rotateKey({
        providerConfigId: configId,
        plaintextKey: "sk-contract-rotate-mismatch",
        weight: 1,
      }),
    ).rejects.toThrow("provider key rotation verification failed");

    // The newly inserted key must have been rolled back.
    const { data: keys } = await admin
      .from("provider_keys")
      .select("id, is_active")
      .eq("provider_config_id", configId);
    expect(keys ?? []).toHaveLength(0);
  });
});
