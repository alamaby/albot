import { describe, expect, it } from "vitest";
import { parseServerEnv, resolveAppEnv } from "@/env";

const VALID_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

const validSource: Record<string, string> = {
  NODE_ENV: "development",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  PROVIDER_KEY_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
};

function omit(source: Record<string, string>, key: string): Record<string, string> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

describe("parseServerEnv", () => {
  it("parses a valid environment", () => {
    const parsed = parseServerEnv(validSource);
    expect(parsed).toEqual({
      NODE_ENV: "development",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      PROVIDER_KEY_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
    });
  });

  it("defaults NODE_ENV to development when missing", () => {
    const parsed = parseServerEnv(omit(validSource, "NODE_ENV"));
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("rejects a missing SUPABASE_URL", () => {
    expect(() => parseServerEnv(omit(validSource, "SUPABASE_URL"))).toThrow();
  });

  it("rejects a non-URL SUPABASE_URL", () => {
    expect(() => parseServerEnv({ ...validSource, SUPABASE_URL: "not-a-url" })).toThrow();
  });

  it("rejects a missing service role key", () => {
    expect(() => parseServerEnv(omit(validSource, "SUPABASE_SERVICE_ROLE_KEY"))).toThrow();
  });

  it("rejects a missing encryption key", () => {
    expect(() => parseServerEnv(omit(validSource, "PROVIDER_KEY_ENCRYPTION_KEY"))).toThrow();
  });

  it("rejects an invalid encryption key", () => {
    expect(() =>
      parseServerEnv({ ...validSource, PROVIDER_KEY_ENCRYPTION_KEY: "not-a-key" }),
    ).toThrow("PROVIDER_KEY_ENCRYPTION_KEY");
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => parseServerEnv({ ...validSource, NODE_ENV: "staging" })).toThrow();
  });

  it("rejects an invalid APP_ENV", () => {
    expect(() => parseServerEnv({ ...validSource, APP_ENV: "staging" })).toThrow();
  });

  it("normalizes a trailing slash on SUPABASE_URL", () => {
    const parsed = parseServerEnv({
      ...validSource,
      SUPABASE_URL: "https://example.supabase.co/",
    });
    expect(parsed.SUPABASE_URL).toBe("https://example.supabase.co");
  });
});

describe("resolveAppEnv", () => {
  it("uses APP_ENV development when set", () => {
    expect(resolveAppEnv({ APP_ENV: "development" })).toBe("development");
  });

  it("uses APP_ENV production when set", () => {
    expect(resolveAppEnv({ APP_ENV: "production" })).toBe("production");
  });

  it("derives production from VERCEL_ENV when APP_ENV is missing", () => {
    expect(resolveAppEnv({ VERCEL_ENV: "production" })).toBe("production");
  });

  it("defaults to development for preview deployments", () => {
    expect(resolveAppEnv({ VERCEL_ENV: "preview" })).toBe("development");
  });

  it("defaults to development when nothing is set", () => {
    expect(resolveAppEnv({})).toBe("development");
  });
});
