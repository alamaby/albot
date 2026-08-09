// Server-only provider key VAULT repository.
// This is the ONLY module that exposes decrypted provider keys. It is kept
// separate from the safe provider-key repository so the admin surface can never
// become an unintended decryption API (see M2 risk mitigation).
// Plaintext keys never leave memory except for an outbound provider request.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { decryptProviderKey } from "@/server/security/encryption";

export type DecryptedProviderKeyHandle = {
  id: string;
  providerConfigId: string;
  plaintext: string;
  fingerprint: string;
};

export class ProviderKeyVaultRepository {
  constructor(private readonly encryptionKey: Buffer) {}

  async getDecryptableKey(
    providerConfigId: string,
    keyId: string,
  ): Promise<DecryptedProviderKeyHandle | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_keys")
      .select("id, provider_config_id, key_ciphertext, key_iv, key_auth_tag, key_fingerprint")
      .eq("id", keyId)
      .eq("provider_config_id", providerConfigId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`provider key vault get failed: ${error.message}`);
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
}
