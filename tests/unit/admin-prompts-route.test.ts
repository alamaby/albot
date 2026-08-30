import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Validate the route handler's auth + query parameter validation without
// touching the real DB. We mock verifyProcessorSecret and PromptAuditRepository
// so the test stays hermetic.

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test-placeholder-value-1234567890";
process.env.PROVIDER_KEY_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456789:AAexamplebotToken000";
process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-abc";
process.env.JOB_PROCESSOR_SECRET = "test-good-secret-32-chars-minimum-ok";

vi.mock("@/server/jobs/auth", () => ({
  verifyProcessorSecret: vi.fn(
    (auth: string | null) => auth === "Bearer test-good-secret-32-chars-minimum-ok",
  ),
}));

const queryMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock("@/server/repositories/prompt-audit.repository", () => {
  class FakePromptAuditRepository {
    query = queryMock;
  }
  return { PromptAuditRepository: FakePromptAuditRepository };
});

import { GET } from "@/app/api/admin/prompts/route";

function makeRequest(url: string, auth?: string): NextRequest {
  return new NextRequest(url, auth ? { headers: { authorization: auth } } : {});
}

describe("GET /api/admin/prompts", () => {
  it("returns 401 when authorization is missing or wrong", async () => {
    const r1 = await GET(makeRequest("https://example.com/api/admin/prompts?user_id=1"));
    expect(r1.status).toBe(401);
    const r2 = await GET(
      makeRequest("https://example.com/api/admin/prompts?user_id=1", "Bearer wrong"),
    );
    expect(r2.status).toBe(401);
  });

  it("returns 400 when neither user_id nor session_id is set", async () => {
    const r = await GET(
      makeRequest(
        "https://example.com/api/admin/prompts",
        "Bearer test-good-secret-32-chars-minimum-ok",
      ),
    );
    expect(r.status).toBe(400);
  });

  it("returns 400 when user_id is not an integer", async () => {
    const r = await GET(
      makeRequest(
        "https://example.com/api/admin/prompts?user_id=not-a-number",
        "Bearer test-good-secret-32-chars-minimum-ok",
      ),
    );
    expect(r.status).toBe(400);
  });

  it("returns rows when authorized and user_id is valid", async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: "p-1",
        session_id: "s-1",
        revision_id: "r-1",
        attempt_id: null,
        telegram_user_id: 1n,
        telegram_chat_id: 2n,
        telegram_message_id: 100,
        stage: "enhance_input",
        source_prompt: "a red dragon",
        previous_prompt: null,
        revision_instruction: null,
        enhanced_prompt: null,
        image_prompt: null,
        provider_config_id: "c-1",
        provider_request_id: "q-1",
        model: "openrouter/free",
        status: "ok",
        error_code: null,
        created_at: "2026-08-28T00:00:00Z",
      } as never,
    ]);
    const r = await GET(
      makeRequest(
        "https://example.com/api/admin/prompts?user_id=1&limit=10",
        "Bearer test-good-secret-32-chars-minimum-ok",
      ),
    );
    if (r.status !== 200) {
      const t = await r.text();
      console.log("DIAG status", r.status, t);
    }
    expect(r.status).toBe(200);
    const body = (await r.json()) as { count: number; prompts: Array<{ id: string }> };
    expect(body.count).toBe(1);
    expect(body.prompts[0].id).toBe("p-1");
  });
});
