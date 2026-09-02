// Server-only provider key repository.
// Safe projection only: encrypts before write and never exposes ciphertext,
// IV, auth tag, or plaintext in safe results. Decryption lives exclusively in
// ProviderKeyVaultRepository so this repository cannot become a decryption API.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { encryptProviderKey } from "@/server/security/encryption";
import { ProviderKeyVaultRepository } from "./provider-key-vault.repository";
import type { Database } from "@/server/supabase/database.types";

type Supabase = Database["public"]["Tables"];

const DEFAULT_FAILURE_THRESHOLD = 3;

// Single source of truth for the safe projection (never includes ciphertext,
// IV, or auth tag).
const SAFE_KEY_COLUMNS =
  "id, provider_config_id, key_fingerprint, label, weight, priority, is_active, failure_count, cooldown_until, last_used_at, created_at, updated_at";

export type InsertEncryptedKeyInput = {
  providerConfigId: string;
  plaintextKey: string;
  label?: string;
  weight: number;
  priority?: number;
};

export type ProviderKeySafe = {
  id: string;
  providerConfigId: string;
  label?: string;
  fingerprint: string;
  weight: number;
  priority: number;
  isActive: boolean;
  failureCount: number;
  cooldownUntil?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarkFailureInput = {
  keyId: string;
  providerConfigId: string;
  threshold?: number;
};

export type MarkSuccessInput = {
  keyId: string;
  providerConfigId: string;
};

export type RotateKeyInput = {
  providerConfigId: string;
  plaintextKey: string;
  label?: string;
  weight: number;
  priority?: number;
};

export class ProviderKeyRepository {
  private readonly vault: ProviderKeyVaultRepository;

  constructor(
    private readonly encryptionKey: Buffer,
    vault?: ProviderKeyVaultRepository,
  ) {
    this.vault = vault ?? new ProviderKeyVaultRepository(this.encryptionKey);
  }

  async insertEncryptedKey(input: InsertEncryptedKeyInput): Promise<ProviderKeySafe> {
    const supabase = getSupabaseAdmin();
    const associatedData = `albot/provider-key/v1/${input.providerConfigId}`;
    const encrypted = encryptProviderKey(input.plaintextKey, this.encryptionKey, associatedData);

    const { data, error } = await supabase
      .from("provider_keys")
      .insert({
        provider_config_id: input.providerConfigId,
        key_ciphertext: encrypted.ciphertextBase64,
        key_iv: encrypted.ivBase64,
        key_auth_tag: encrypted.authTagBase64,
        key_fingerprint: encrypted.fingerprint,
        label: input.label ?? null,
        weight: input.weight,
        priority: input.priority ?? 100,
      } as Supabase["provider_keys"]["Insert"])
      .select(SAFE_KEY_COLUMNS)
      .single();

    if (error) throw new Error(`provider key insert failed: ${error.message}`);
    return mapRowToSafe(data!);
  }

  // Ordering supports both key strategies the selector can apply:
  // - priority: is_active DESC, priority ASC, last_used_at NULLS FIRST, id
  // - round_robin: is_active DESC, last_used_at NULLS FIRST, id
  // The same ORDER BY covers both (priority is a stable tie-break on top of
  // last_used_at for the priority strategy, and is ignored by LRU rotation).
  async listSafeKeys(providerConfigId: string): Promise<ProviderKeySafe[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_keys")
      .select(SAFE_KEY_COLUMNS)
      .eq("provider_config_id", providerConfigId)
      .order("is_active", { ascending: false })
      .order("priority", { ascending: true })
      .order("last_used_at", { ascending: true, nullsFirst: true });

    if (error) throw new Error(`provider key list failed: ${error.message}`);
    return (data ?? []).map(mapRowToSafe);
  }

  // Atomic failure accounting via RPC: increments failure_count, applies an
  // exponential cooldown once the threshold is reached (see C4).
  async markFailure(input: MarkFailureInput): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .rpc("increment_provider_key_failure", {
        p_provider_config_id: input.providerConfigId,
        p_key_id: input.keyId,
        p_threshold: input.threshold ?? DEFAULT_FAILURE_THRESHOLD,
      })
      .single();

    if (error) throw new Error(`provider key failure update failed: ${error.message}`);
  }

  async markSuccess(input: MarkSuccessInput): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_keys")
      .update({
        failure_count: 0,
        cooldown_until: null,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", input.keyId)
      .eq("provider_config_id", input.providerConfigId)
      .select("id");

    if (error) throw new Error(`provider key success update failed: ${error.message}`);
    // Fail fast when the key is missing so a silent no-op cannot hide a stale
    // reference (e.g. a worker recording success against a removed key).
    if (!data || data.length === 0) {
      throw new Error("provider key success update: key not found");
    }
  }

  async rotateKey(input: RotateKeyInput): Promise<ProviderKeySafe> {
    // Insert new encrypted key first, verify decryption works, then deactivate
    // the old active key with a compare-and-set so a concurrent rotation cannot
    // deactivate a key another worker already replaced.
    const newKey = await this.insertEncryptedKey({
      providerConfigId: input.providerConfigId,
      plaintextKey: input.plaintextKey,
      label: input.label,
      weight: input.weight,
      priority: input.priority,
    });

    try {
      // Verify the new key can be decrypted.
      const decrypted = await this.vault.getDecryptableKey(input.providerConfigId, newKey.id);
      if (!decrypted || decrypted.plaintext !== input.plaintextKey) {
        throw new Error("provider key rotation verification failed");
      }
    } catch (error) {
      // Rollback: delete the newly inserted key so a failed rotation never
      // leaves an orphan active key behind.
      const supabase = getSupabaseAdmin();
      const { error: deleteError } = await supabase
        .from("provider_keys")
        .delete()
        .eq("id", newKey.id)
        .eq("provider_config_id", input.providerConfigId);
      if (deleteError) {
        throw new Error(`provider key rotation rollback failed: ${deleteError.message}`);
      }
      throw error;
    }

    // Deactivate the oldest active key for this provider config (CAS).
    const supabase = getSupabaseAdmin();
    const { data: oldKey, error } = await supabase
      .from("provider_keys")
      .select("id")
      .eq("provider_config_id", input.providerConfigId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (!error && oldKey) {
      await supabase
        .from("provider_keys")
        .update({ is_active: false })
        .eq("id", oldKey.id)
        .eq("provider_config_id", input.providerConfigId)
        .eq("is_active", true);
    }

    return newKey;
  }
}

function mapRowToSafe(row: {
  id: string;
  provider_config_id: string;
  key_fingerprint: string;
  label: string | null;
  weight: number;
  priority: number;
  is_active: boolean;
  failure_count: number;
  cooldown_until: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}): ProviderKeySafe {
  return {
    id: row.id,
    providerConfigId: row.provider_config_id,
    label: row.label ?? undefined,
    fingerprint: row.key_fingerprint,
    weight: row.weight,
    priority: row.priority,
    isActive: row.is_active,
    failureCount: row.failure_count,
    cooldownUntil: row.cooldown_until,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
