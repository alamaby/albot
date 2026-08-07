import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/env";

const validSource: Record<string, string> = {
  NODE_ENV: "development",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
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

  it("rejects an invalid NODE_ENV", () => {
    expect(() => parseServerEnv({ ...validSource, NODE_ENV: "staging" })).toThrow();
  });
});
