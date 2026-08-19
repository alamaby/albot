import { NextRequest, NextResponse } from "next/server";
import { resolveAppEnv } from "@/env";
import { checkDatabaseReachability } from "@/server/supabase/admin";
import { checkReadiness } from "@/server/application/readiness";
import { logStructured } from "@/server/observability/logger";

export const runtime = "nodejs";

export async function GET(request?: NextRequest): Promise<NextResponse> {
  const environment = resolveAppEnv(process.env);

  let database: "reachable" | "unreachable" | "unauthorized" | "unconfigured";
  try {
    database = await checkDatabaseReachability();
  } catch {
    database = "unconfigured";
  }

  const isHealthy = database === "reachable";

  const body: Record<string, unknown> = {
    status: isHealthy ? "ok" : "degraded",
    environment,
    database,
  };

  // Optional deep-readiness block (no provider calls, no paid inference).
  const includeReadiness = request?.nextUrl.searchParams.get("include") === "readiness";
  if (includeReadiness && isHealthy) {
    try {
      body.readiness = await checkReadiness();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "health.readiness_failed", { detail });
    }
  }

  return NextResponse.json(body, {
    status: isHealthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
