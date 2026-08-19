import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/env";
import { verifyProcessorSecret } from "@/server/jobs/auth";
import { checkReadiness } from "@/server/application/readiness";
import { withCorrelation } from "@/server/observability/correlation";
import { logStructured } from "@/server/observability/logger";

export const runtime = "nodejs";

// Admin diagnostics: read-only operational state (job counts, dead/lease-expired
// jobs, session expiry pressure, provider key cooldown). Protected by the same
// shared secret as the job processor. Never returns secrets or plaintext keys.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  try {
    const readiness = await withCorrelation(request.headers.get("x-correlation-id"), async () => {
      logStructured("info", "diagnostics.requested", {});
      return checkReadiness();
    });
    return NextResponse.json(
      { ok: true, generatedAt: new Date().toISOString(), readiness },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "diagnostics.failed", { detail });
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }
}
