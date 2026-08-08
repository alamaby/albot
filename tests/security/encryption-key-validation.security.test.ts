import { describe, expect, it } from "vitest";
import { parseEncryptionKey } from "@/server/security/encryption";

describe("Security: Encryption Key Validation", () => {
  it("accepts valid 32-byte base64 key", () => {
    const validKey = Buffer.alloc(32, 0xab).toString("base64");
    expect(() => parseEncryptionKey(validKey)).not.toThrow();
  });

  it("rejects key that decodes to wrong length", () => {
    expect(() => parseEncryptionKey(Buffer.from("hello", "utf8").toString("base64"))).toThrow();
  });

  it("rejects invalid base64", () => {
    expect(() => parseEncryptionKey("not-valid-base64!!!")).toThrow();
  });

  it("rejects all-zero key", () => {
    expect(() => parseEncryptionKey(Buffer.alloc(32, 0).toString("base64"))).toThrow();
  });
});
