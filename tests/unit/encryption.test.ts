import { describe, expect, it } from "vitest";
import {
  parseEncryptionKey,
  encryptProviderKey,
  decryptProviderKey,
  computeFingerprint,
} from "@/server/security/encryption";

const TEST_KEY = Buffer.alloc(32, 1);
const ASSOCIATED_DATA = "albot/provider-key/v1/test-config";

describe("encryption", () => {
  describe("parseEncryptionKey", () => {
    it("accepts valid 32-byte base64 key", () => {
      const result = parseEncryptionKey(TEST_KEY.toString("base64"));
      expect(result).toHaveLength(32);
    });

    it("rejects wrong length", () => {
      expect(() => parseEncryptionKey(Buffer.from("hello", "utf8").toString("base64"))).toThrow();
    });

    it("rejects invalid base64", () => {
      expect(() => parseEncryptionKey("!!!invalid!!!")).toThrow();
    });

    it("rejects all-zero key", () => {
      expect(() => parseEncryptionKey(Buffer.alloc(32, 0).toString("base64"))).toThrow();
    });
  });

  describe("encrypt/decrypt round trip", () => {
    it("encrypts and decrypts correctly", () => {
      const plaintext = "test-provider-key";
      const encrypted = encryptProviderKey(plaintext, TEST_KEY, ASSOCIATED_DATA);
      const decrypted = decryptProviderKey(encrypted, TEST_KEY, ASSOCIATED_DATA);

      expect(decrypted).not.toBeNull();
      expect(decrypted!.plaintext).toBe(plaintext);
      expect(decrypted!.fingerprint).toBe(computeFingerprint(plaintext));
    });

    it("produces different ciphertext for same plaintext", () => {
      const plaintext = "same-key";
      const e1 = encryptProviderKey(plaintext, TEST_KEY, ASSOCIATED_DATA);
      const e2 = encryptProviderKey(plaintext, TEST_KEY, ASSOCIATED_DATA);

      expect(e1.ciphertextBase64).not.toBe(e2.ciphertextBase64);
      expect(e1.ivBase64).not.toBe(e2.ivBase64);
      expect(e1.fingerprint).toBe(e2.fingerprint);
    });

    it("fails decryption with wrong root key", () => {
      const plaintext = "secret";
      const encrypted = encryptProviderKey(plaintext, TEST_KEY, ASSOCIATED_DATA);
      const wrongKey = Buffer.alloc(32, 2);

      expect(decryptProviderKey(encrypted, wrongKey, ASSOCIATED_DATA)).toBeNull();
    });

    it("fails decryption with wrong associated data", () => {
      const plaintext = "secret";
      const encrypted = encryptProviderKey(plaintext, TEST_KEY, ASSOCIATED_DATA);
      const wrongAd = "wrong/associated/data";

      expect(decryptProviderKey(encrypted, TEST_KEY, wrongAd)).toBeNull();
    });

    it("fails decryption with tampered ciphertext", () => {
      const plaintext = "secret";
      const encrypted = encryptProviderKey(plaintext, TEST_KEY, ASSOCIATED_DATA);
      encrypted.ciphertextBase64 = "dGFtcGVyZWQ=";

      expect(decryptProviderKey(encrypted, TEST_KEY, ASSOCIATED_DATA)).toBeNull();
    });
  });

  describe("fingerprint", () => {
    it("is deterministic for same input", () => {
      const f1 = computeFingerprint("test-key");
      const f2 = computeFingerprint("test-key");
      expect(f1).toBe(f2);
    });

    it("differs for different input", () => {
      expect(computeFingerprint("key1")).not.toBe(computeFingerprint("key2"));
    });
  });
});
