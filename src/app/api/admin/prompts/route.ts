import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/env";
import { verifyProcessorSecret } from "@/server/jobs/auth";
import { PromptAuditRepository } from "@/server/repositories/prompt-audit.repository";
import { logStructured } from "@/server/observability/logger";

export const runtime = "nodejs";

// Admin endpoint: read-only cross-purge prompt audit. Returns a single
// user's prompt history with provider_used and error_code, joined to
// provider_configs and provider_requests. Never returns raw keys.
//
// Auth: Bearer JOB_PROCESSOR_SECRET (same as the other admin endpoints).
// Defaults: limit=100, ordered by created_at desc.
//
// Query params:
//   user_id  (number)    — telegram user id (required unless session_id is set)
//   session_id (uuid)    — exact session filter
//   since    (iso date)   — created_at >= since
//   until    (iso date)   — created_at <  until
//   limit    (1..200)     — page size
//   offset   (number)     — pagination offset
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const userIdRaw = params.get("user_id");
  const sessionIdRaw = params.get("session_id");
  const sinceRaw = params.get("since");
  const untilRaw = params.get("until");
  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");

  if (!userIdRaw && !sessionIdRaw) {
    return NextResponse.json(
      { ok: false, reason: "user_id or session_id is required" },
      { status: 400 },
    );
  }

  let userId: bigint | undefined;
  if (userIdRaw) {
    try {
      userId = BigInt(userIdRaw);
    } catch {
      return NextResponse.json(
        { ok: false, reason: "user_id must be a base-10 integer" },
        { status: 400 },
      );
    }
  }

  const limit = Math.min(Math.max(parseInt(limitRaw ?? "100", 10) || 100, 1), 200);
  const offset = Math.max(parseInt(offsetRaw ?? "0", 10) || 0, 0);

  try {
    const repo = new PromptAuditRepository();
    const rows = await repo.query({
      ...(userId !== undefined ? { telegramUserId: userId } : {}),
      ...(sessionIdRaw ? { sessionId: sessionIdRaw } : {}),
      ...(sinceRaw ? { since: sinceRaw } : {}),
      ...(untilRaw ? { until: untilRaw } : {}),
      limit,
      offset,
    });

    logStructured("info", "admin.prompts.queried", {
      userId: userIdRaw,
      sessionId: sessionIdRaw,
      rows: rows.length,
      limit,
      offset,
    });

    return NextResponse.json(
      {
        ok: true,
        generatedAt: new Date().toISOString(),
        filter: {
          ...(userIdRaw ? { userId: userId?.toString() } : {}),
          ...(sessionIdRaw ? { sessionId: sessionIdRaw } : {}),
          ...(sinceRaw ? { since: sinceRaw } : {}),
          ...(untilRaw ? { until: untilRaw } : {}),
          limit,
          offset,
        },
        count: rows.length,
        prompts: rows.map((r) => ({
          id: r.id,
          sessionId: r.session_id,
          revisionId: r.revision_id,
          attemptId: r.attempt_id,
          telegramUserId: r.telegram_user_id != null ? r.telegram_user_id.toString() : null,
          telegramChatId: r.telegram_chat_id != null ? r.telegram_chat_id.toString() : null,
          telegramMessageId: r.telegram_message_id,
          stage: r.stage,
          sourcePrompt: r.source_prompt,
          previousPrompt: r.previous_prompt,
          revisionInstruction: r.revision_instruction,
          enhancedPrompt: r.enhanced_prompt,
          imagePrompt: r.image_prompt,
          providerConfigId: r.provider_config_id,
          providerRequestId: r.provider_request_id,
          model: r.model,
          status: r.status,
          errorCode: r.error_code,
          createdAt: r.created_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    if (process.env.NODE_ENV !== "production") {
      console.error("admin.prompts.failed", detail, error);
    }
    logStructured("error", "admin.prompts.failed", { detail });
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }
}
