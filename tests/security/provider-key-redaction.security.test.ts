import { describe, expect, it } from "vitest";
import {
  encryptProviderKey,
  decryptProviderKey,
  computeFingerprint,
} from "@/server/security/encryption";

describe("Security: Provider Key Redaction", () => {
  it("ciphertext does not contain plaintext", () => {
    const plaintext = "real-provider-api-key-do-not-use";
    const key = Buffer.alloc(32, 1);
    const encrypted = encryptProviderKey(plaintext, key, "test-ad");

    expect(encrypted.ciphertextBase64).not.toContain(plaintext);
    expect(encrypted.ivBase64).not.toContain(plaintext);
    expect(encrypted.authTagBase64).not.toContain(plaintext);
    expect(encrypted.fingerprint).not.toContain(plaintext);
  });

  it("fingerprint is safe for display", () => {
    const plaintext = "real-provider-api-key";
    const fingerprint = computeFingerprint(plaintext);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain(plaintext);
  });

  it("decrypted handle does not expose ciphertext", () => {
    const plaintext = "secret-key";
    const key = Buffer.alloc(32, 1);
    const encrypted = encryptProviderKey(plaintext, key, "test-ad");
    const decrypted = decryptProviderKey(encrypted, key, "test-ad");

    expect(decrypted).not.toBeNull();
    expect(decrypted!.plaintext).toBe(plaintext);
    expect(decrypted!.fingerprint).toBe(computeFingerprint(plaintext));
    // Decrypted handle should not contain ciphertext fields
    const keys = Object.keys(decrypted!);
    expect(keys).not.toContain("ciphertextBase64");
    expect(keys).not.toContain("ivBase64");
    expect(keys).not.toContain("authTagBase64");
  });
});
