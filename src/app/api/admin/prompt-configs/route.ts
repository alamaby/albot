import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/env";
import { verifyProcessorSecret } from "@/server/jobs/auth";
import { PromptConfigRepository } from "@/server/repositories/prompt-config.repository";
import { logStructured } from "@/server/observability/logger";
import { z } from "zod";

export const runtime = "nodejs";

// Admin API for DB-driven prompt configs (persona-only).
//
// Auth: Bearer JOB_PROCESSOR_SECRET
//
// GET  ?key=<key> [&audit=true] [&limit=50]
//   - without audit: lists prompt_configs rows for key (or all keys)
//   - with audit=true: lists prompt_configs_audit rows
//
// POST { key, body, actor? }  -> create new version (upsert, auto-activate)
// POST { key, version, actor? } -> activate existing version (rollback)
//

const upsertSchema = z.object({
  key: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  actor: z.string().max(200).optional().nullable(),
});

const activateSchema = z.object({
  key: z.string().min(1).max(200),
  version: z.number().int().min(1),
  actor: z.string().max(200).optional().nullable(),
});

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return unauthorized();
  }

  const params = request.nextUrl.searchParams;
  const key = params.get("key")?.trim() || undefined;
  const audit = params.get("audit") === "true" || params.get("audit") === "1";
  const limitRaw = params.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 200);

  try {
    const repo = new PromptConfigRepository();
    if (audit) {
      const rows = await repo.listAudit(key, limit);
      return NextResponse.json(
        {
          ok: true,
          count: rows.length,
          filter: { ...(key ? { key } : {}), limit },
          audit: rows.map((r) => ({
            id: r.id,
            key: r.key,
            version: r.version,
            action: r.action,
            oldBody: r.old_body,
            newBody: r.new_body,
            actor: r.actor,
            createdAt: r.created_at,
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const rows = await repo.list(key);
    logStructured("info", "admin.prompt_configs.listed", {
      key: key ?? "all",
      rows: rows.length,
    });
    return NextResponse.json(
      {
        ok: true,
        count: rows.length,
        filter: { ...(key ? { key } : {}), limit },
        configs: rows.map((r) => ({
          id: r.id,
          key: r.key,
          body: r.body,
          version: r.version,
          isActive: r.is_active,
          createdBy: r.created_by,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "admin.prompt_configs.get_failed", { detail });
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return unauthorized();
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid json" }, { status: 400 });
  }

  const bodyObj = raw as Record<string, unknown>;

  // Activate path: has version but no body
  if (typeof bodyObj.version === "number" && typeof bodyObj.body !== "string") {
    const parsed = activateSchema.safeParse(bodyObj);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, reason: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    try {
      const repo = new PromptConfigRepository();
      const id = await repo.activate(
        parsed.data.key,
        parsed.data.version,
        parsed.data.actor ?? null,
      );
      logStructured("info", "admin.prompt_configs.activated", {
        key: parsed.data.key,
        version: parsed.data.version,
        actor: parsed.data.actor ?? null,
      });
      return NextResponse.json({
        ok: true,
        id,
        key: parsed.data.key,
        version: parsed.data.version,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "admin.prompt_configs.activate_failed", { detail });
      return NextResponse.json({ ok: false, reason: detail }, { status: 400 });
    }
  }

  // Upsert path
  const parsed = upsertSchema.safeParse(bodyObj);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  try {
    const repo = new PromptConfigRepository();
    const id = await repo.upsert(parsed.data.key, parsed.data.body, parsed.data.actor ?? null);
    logStructured("info", "admin.prompt_configs.upserted", {
      key: parsed.data.key,
      actor: parsed.data.actor ?? null,
    });
    return NextResponse.json({ ok: true, id, key: parsed.data.key });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "admin.prompt_configs.upsert_failed", { detail });
    return NextResponse.json({ ok: false, reason: detail }, { status: 400 });
  }
}
