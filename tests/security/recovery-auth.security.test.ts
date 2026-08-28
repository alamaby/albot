import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as recoveryPOST } from "@/app/api/recovery/run/route";
import { GET as diagnosticsGET } from "@/app/api/admin/diagnostics/route";
import { resetServerEnvCache } from "@/env";

// Security tests for the internal endpoints. These are pure unit tests: the
// route's auth check runs before any repository/DB call, so no hosted
// credentials are needed to prove 401 behavior.

const VALID_SECRET = "job-processor-secret-0123456789abcdef";

function withEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test-placeholder-value-1234567890";
  process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
  process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
  process.env.JOB_PROCESSOR_SECRET = VALID_SECRET;
  resetServerEnvCache();
}

function requestWithAuth(authorization: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  return new NextRequest("http://localhost", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
}

function requestWithBearer(secret: string): NextRequest {
  return requestWithAuth(`Bearer ${secret}`);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetServerEnvCache();
});

describe("recovery endpoint auth", () => {
  it("rejects missing authorization with 401", async () => {
    withEnv();
    const res = await recoveryPOST(requestWithAuth(null));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong secret with 401", async () => {
    withEnv();
    const res = await recoveryPOST(requestWithBearer("wrong-secret-value"));
    expect(res.status).toBe(401);
  });

  it("rejects a non-Bearer scheme with 401", async () => {
    withEnv();
    const res = await recoveryPOST(requestWithAuth(VALID_SECRET));
    expect(res.status).toBe(401);
  });
});

describe("diagnostics endpoint auth", () => {
  it("rejects missing authorization with 401", async () => {
    withEnv();
    const res = await diagnosticsGET(new NextRequest("http://localhost", { headers: {} }));
    expect(res.status).toBe(401);
  });

  it("rejects a wrong secret with 401", async () => {
    withEnv();
    const res = await diagnosticsGET(
      new NextRequest("http://localhost", { headers: { authorization: "Bearer nope" } }),
    );
    expect(res.status).toBe(401);
  });
});
