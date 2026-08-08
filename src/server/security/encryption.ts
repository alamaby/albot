// Authenticated encryption service for provider keys using AES-256-GCM.
//
// All methods are server-side only. Plaintext keys never leave memory except
// for the brief moment needed to encrypt/decrypt an outbound request.

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

export type EncryptedProviderKey = {
  version: 1;
  algorithm: "aes-256-gcm";
  ciphertextBase64: string;
  ivBase64: string;
  authTagBase64: string;
  fingerprint: string;
};

export type DecryptedProviderKey = {
  plaintext: string;
  fingerprint: string;
};

const VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH_BYTES = 32;

// Validates and decodes `PROVIDER_KEY_ENCRYPTION_KEY` from environment.
// The key must be a valid base64 string that decodes to exactly 32 bytes.
export function parseEncryptionKey(raw: string): Buffer {
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `provider encryption key must decode to ${KEY_LENGTH_BYTES} bytes, got ${decoded.length}`,
    );
  }
  // Reject keys that are all-zero or empty content.
  const allZero = decoded.every((b) => b === 0);
  if (allZero) {
    throw new Error("provider encryption key must not be all zeros");
  }
  return decoded;
}

// Encrypts a plaintext provider key using AES-256-GCM with random IV.
// Associated data binds the ciphertext to a specific provider config context.
export function encryptProviderKey(
  plaintext: string,
  rootKey: Buffer,
  associatedData: string,
): EncryptedProviderKey {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", rootKey, iv);
  cipher.setAAD(Buffer.from(associatedData));

  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const fingerprint = computeFingerprint(plaintext);

  return {
    version: VERSION,
    algorithm: ALGORITHM,
    ciphertextBase64: ciphertext.toString("base64"),
    ivBase64: iv.toString("base64"),
    authTagBase64: authTag.toString("base64"),
    fingerprint,
  };
}

// Decrypts a provider key envelope. Returns null if authentication fails
// (wrong root key, tampered ciphertext, wrong associated data, etc.).
export function decryptProviderKey(
  encrypted: EncryptedProviderKey,
  rootKey: Buffer,
  associatedData: string,
): DecryptedProviderKey | null {
  try {
    if (encrypted.version !== VERSION || encrypted.algorithm !== ALGORITHM) {
      return null;
    }

    const iv = Buffer.from(encrypted.ivBase64, "base64");
    const authTag = Buffer.from(encrypted.authTagBase64, "base64");
    const ciphertext = Buffer.from(encrypted.ciphertextBase64, "base64");

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", rootKey, iv);
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(authTag);

    const plaintextBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    const plaintext = plaintextBuffer.toString("utf8");
    const fingerprint = computeFingerprint(plaintext);

    // Sanity check: fingerprint must match stored fingerprint.
    if (fingerprint !== encrypted.fingerprint) {
      return null;
    }

    return { plaintext, fingerprint };
  } catch {
    return null;
  }
}

// Computes a deterministic SHA-256 fingerprint of a plaintext key.
// Used for deduplication and safe display (never the key itself).
export function computeFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
