import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/env";
import { verifyProcessorSecret } from "@/server/jobs/auth";
import { processNextJob } from "@/server/jobs/processor";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization");
  if (!verifyProcessorSecret(authorization, env.JOB_PROCESSOR_SECRET)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processNextJob();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`job processor: failed (${detail})`);
    return NextResponse.json({ ok: false, reason: "internal" }, { status: 500 });
  }
}
