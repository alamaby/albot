// Server-only provider key repository.
// Encrypts before write, decrypts on read, never exposes ciphertext/IV/auth tag in safe results.

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/server/supabase/admin";
import {
  encryptProviderKey,
  decryptProviderKey,
  computeFingerprint,
  parseEncryptionKey,
} from "@/server/security/encryption";
import type { Database } from "@/server/supabase/database.types";

type Supabase = Database["public"]["Tables"];

export type InsertEncryptedKeyInput = {
  providerConfigId: string;
  plaintextKey: string;
  label?: string;
  weight: number;
};

export type ProviderKeySafe = {
  id: string;
  providerConfigId: string;
  label?: string;
  fingerprint: string;
  weight: number;
  isActive: boolean;
  failureCount: number;
  cooldownUntil?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DecryptedProviderKeyHandle = {
  id: string;
  providerConfigId: string;
  plaintext: string;
  fingerprint: string;
};

export type MarkFailureInput = {
  keyId: string;
  providerConfigId: string;
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
};

export class ProviderKeyRepository {
  private readonly encryptionKey: Buffer;

  constructor(encryptionKey: Buffer) {
    this.encryptionKey = encryptionKey;
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
      } as Supabase["provider_keys"]["Insert"])
      .select(
        "id, provider_config_id, key_fingerprint, label, weight, is_active, failure_count, cooldown_until, last_used_at, created_at, updated_at",
      )
      .single();

    if (error) throw new Error(`provider key insert failed: ${error.message}`);
    return mapRowToSafe(data!);
  }

  async listSafeKeys(providerConfigId: string): Promise<ProviderKeySafe[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_keys")
      .select(
        "id, provider_config_id, key_fingerprint, label, weight, is_active, failure_count, cooldown_until, last_used_at, created_at, updated_at",
      )
      .eq("provider_config_id", providerConfigId)
      .order("is_active", { ascending: false })
      .order("last_used_at", { ascending: true, nullsFirst: true });

    if (error) throw new Error(`provider key list failed: ${error.message}`);
    return (data ?? []).map(mapRowToSafe);
  }

  async getDecryptableKey(
    providerConfigId: string,
    keyId: string,
  ): Promise<DecryptedProviderKeyHandle | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_keys")
      .select(
        "id, provider_config_id, key_ciphertext, key_iv, key_auth_tag, key_fingerprint, label, weight, is_active, failure_count, cooldown_until, last_used_at, created_at, updated_at",
      )
      .eq("id", keyId)
      .eq("provider_config_id", providerConfigId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`provider key get failed: ${error.message}`);
    }
    if (!data) return null;

    const associatedData = `albot/provider-key/v1/${providerConfigId}`;
    const decrypted = decryptProviderKey(
      {
        version: 1,
        algorithm: "aes-256-gcm",
        ciphertextBase64: data.key_ciphertext,
        ivBase64: data.key_iv,
        authTagBase64: data.key_auth_tag,
        fingerprint: data.key_fingerprint,
      },
      this.encryptionKey,
      associatedData,
    );

    if (!decrypted) return null;

    return {
      id: data.id,
      providerConfigId: data.provider_config_id,
      plaintext: decrypted.plaintext,
      fingerprint: decrypted.fingerprint,
    };
  }

  async markFailure(input: MarkFailureInput): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("provider_keys")
      .update({ failure_count: 1 })
      .eq("id", input.keyId)
      .eq("provider_config_id", input.providerConfigId);

    if (error) throw new Error(`provider key failure update failed: ${error.message}`);
  }

  async markSuccess(input: MarkSuccessInput): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("provider_keys")
      .update({
        failure_count: 0,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", input.keyId)
      .eq("provider_config_id", input.providerConfigId);

    if (error) throw new Error(`provider key success update failed: ${error.message}`);
  }

  async rotateKey(input: RotateKeyInput): Promise<ProviderKeySafe> {
    // Insert new encrypted key first, verify decryption works, then deactivate old active key.
    const newKey = await this.insertEncryptedKey({
      providerConfigId: input.providerConfigId,
      plaintextKey: input.plaintextKey,
      label: input.label,
      weight: input.weight,
    });

    // Verify the new key can be decrypted.
    const decrypted = await this.getDecryptableKey(input.providerConfigId, newKey.id);
    if (!decrypted || decrypted.plaintext !== input.plaintextKey) {
      // Rollback: delete the newly inserted key.
      const supabase = getSupabaseAdmin();
      await supabase.from("provider_keys").delete().eq("id", newKey.id);
      throw new Error("provider key rotation verification failed");
    }

    // Deactivate the oldest active key for this provider config.
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
      await supabase.from("provider_keys").update({ is_active: false }).eq("id", oldKey.id);
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
    isActive: row.is_active,
    failureCount: row.failure_count,
    cooldownUntil: row.cooldown_until,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
