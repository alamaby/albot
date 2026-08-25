import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServerEnv } from "@/env";
import { verifyProcessorSecret } from "@/server/jobs/auth";
import { claimNextJob, executeClaimedJob, generateWorkerId } from "@/server/jobs/processor";
import { withCorrelation } from "@/server/observability/correlation";
import { logStructured } from "@/server/observability/logger";

export const runtime = "nodejs";

// Headroom for background job execution (provider calls can take tens of
// seconds). The HTTP response itself returns immediately after the claim.
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const correlationId = request.headers.get("x-correlation-id");

  let workerId: string;
  let job: Awaited<ReturnType<typeof claimNextJob>>;
  try {
    const claimed = await withCorrelation(correlationId, async () => {
      logStructured("info", "processor.requested", {});
      workerId = generateWorkerId();
      return claimNextJob(workerId);
    });
    job = claimed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "processor.claim_failed", { detail });
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ ok: true, status: "idle" });
  }

  // Execute after the response so the dispatcher (5s timeout) is never blocked
  // by provider latency. Lease expiry + recovery sweep cover a crashed
  // background execution, so this stays durable.
  after(() =>
    withCorrelation(correlationId, () => executeClaimedJob(job!, workerId!)).catch((error) => {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "processor.background_failed", { jobId: job!.id, detail });
    }),
  );

  return NextResponse.json({ ok: true, status: "claimed", jobId: job.id });
}
