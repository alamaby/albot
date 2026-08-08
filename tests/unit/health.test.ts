import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { checkDatabaseReachability } from "@/server/supabase/admin";
import { resetServerEnvCache } from "@/env";

function withSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

function fakeResponse(status: number, body: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(JSON.parse(body)),
  } as Response;
}

beforeEach(() => {
  resetServerEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetServerEnvCache();
});

describe("checkDatabaseReachability", () => {
  it("returns reachable on 200", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(200, "[]"))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("reachable");
  });

  it("returns reachable on 404 with PGRST205", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(404, '{"code":"PGRST205"}'))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("reachable");
  });

  it("returns reachable on 404 with 42P01", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(404, '{"code":"42P01"}'))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("reachable");
  });

  it("returns unauthorized on 401", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(401, '{"message":"Invalid token"}'))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("unauthorized");
  });

  it("returns unauthorized on 403", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(403, '{"message":"Forbidden"}'))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("unauthorized");
  });

  it("returns unreachable on network failure", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ENOTFOUND"))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("unreachable");
  });

  it("returns unreachable on other 404 code", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(404, '{"code":"42P03"}'))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("unreachable");
  });

  it("returns unreachable on 500", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(500, '{"message":"boom"}'))),
    );
    await expect(checkDatabaseReachability()).resolves.toBe("unreachable");
  });
});

describe("GET /api/health", () => {
  it("returns HTTP 200 with status ok when DB reachable", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(404, '{"code":"PGRST205"}'))),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      environment: "development",
      database: "reachable",
    });
  });

  it("returns HTTP 503 with status degraded when DB unreachable", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ENOTFOUND"))),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: "degraded",
      environment: "development",
      database: "unreachable",
    });
  });

  it("returns HTTP 503 with status degraded when DB unauthorized", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(401, '{"message":"Invalid token"}'))),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: "degraded",
      environment: "development",
      database: "unauthorized",
    });
  });

  it("returns HTTP 503 with status degraded when env missing", async () => {
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: "degraded",
      environment: "development",
      database: "unconfigured",
    });
  });

  it("returns environment production when APP_ENV is production", async () => {
    process.env.APP_ENV = "production";
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(404, '{"code":"PGRST205"}'))),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      environment: "production",
      database: "reachable",
    });
  });

  it("sends Cache-Control: no-store", async () => {
    withSupabaseEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fakeResponse(404, '{"code":"PGRST205"}'))),
    );
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
