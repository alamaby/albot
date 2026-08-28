import { describe, expect, it } from "vitest";
import { parseServerEnv, resolveAppEnv } from "@/env";

const VALID_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

const validSource: Record<string, string> = {
  NODE_ENV: "development",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test-placeholder-value-1234567890",
  PROVIDER_KEY_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
  TELEGRAM_BOT_TOKEN: "123456789:AAexamplebotToken000",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-abc",
  JOB_PROCESSOR_SECRET: "job-processor-secret-0123456789abcdef",
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
      SUPABASE_SECRET_KEY: "sb_secret_test-placeholder-value-1234567890",
      PROVIDER_KEY_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
      TELEGRAM_BOT_TOKEN: "123456789:AAexamplebotToken000",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret-abc",
      JOB_PROCESSOR_SECRET: "job-processor-secret-0123456789abcdef",
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

  it("rejects a missing secret key", () => {
    expect(() => parseServerEnv(omit(validSource, "SUPABASE_SECRET_KEY"))).toThrow();
  });

  it("rejects a secret key that does not start with sb_secret_", () => {
    expect(() =>
      parseServerEnv({ ...validSource, SUPABASE_SECRET_KEY: "not-an-sb-secret" }),
    ).toThrow("SUPABASE_SECRET_KEY");
  });

  it("rejects a missing encryption key", () => {
    expect(() => parseServerEnv(omit(validSource, "PROVIDER_KEY_ENCRYPTION_KEY"))).toThrow();
  });

  it("rejects an invalid encryption key", () => {
    expect(() =>
      parseServerEnv({ ...validSource, PROVIDER_KEY_ENCRYPTION_KEY: "not-a-key" }),
    ).toThrow("PROVIDER_KEY_ENCRYPTION_KEY");
  });

  it("rejects a missing telegram bot token", () => {
    expect(() => parseServerEnv(omit(validSource, "TELEGRAM_BOT_TOKEN"))).toThrow();
  });

  it("rejects an invalid telegram bot token format", () => {
    expect(() =>
      parseServerEnv({ ...validSource, TELEGRAM_BOT_TOKEN: "not-a-valid-token" }),
    ).toThrow("TELEGRAM_BOT_TOKEN");
  });

  it("rejects a missing webhook secret", () => {
    expect(() => parseServerEnv(omit(validSource, "TELEGRAM_WEBHOOK_SECRET"))).toThrow();
  });

  it("rejects a short webhook secret", () => {
    expect(() => parseServerEnv({ ...validSource, TELEGRAM_WEBHOOK_SECRET: "short" })).toThrow(
      "TELEGRAM_WEBHOOK_SECRET",
    );
  });

  it("rejects an invalid webhook secret character set", () => {
    expect(() =>
      parseServerEnv({ ...validSource, TELEGRAM_WEBHOOK_SECRET: "has space and\n" }),
    ).toThrow("TELEGRAM_WEBHOOK_SECRET");
  });

  it("rejects a missing job processor secret", () => {
    expect(() => parseServerEnv(omit(validSource, "JOB_PROCESSOR_SECRET"))).toThrow();
  });

  it("rejects a short job processor secret", () => {
    expect(() => parseServerEnv({ ...validSource, JOB_PROCESSOR_SECRET: "way-too-short" })).toThrow(
      "JOB_PROCESSOR_SECRET",
    );
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
