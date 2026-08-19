import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/env";
import { verifyProcessorSecret } from "@/server/jobs/auth";
import { runRecovery } from "@/server/jobs/recovery";
import { withCorrelation } from "@/server/observability/correlation";
import { logStructured } from "@/server/observability/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const correlationId = request.headers.get("x-correlation-id");

  try {
    const result = await withCorrelation(correlationId, async () => {
      logStructured("info", "recovery.start", {});
      const outcome = await runRecovery();
      return outcome;
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "recovery.failed", { detail });
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }
}
