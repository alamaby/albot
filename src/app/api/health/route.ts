import { NextResponse } from "next/server";
import { resolveAppEnv } from "@/env";
import { checkDatabaseReachability } from "@/server/supabase/admin";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const environment = resolveAppEnv(process.env);

  let database: "reachable" | "unreachable" | "unauthorized" | "unconfigured";
  try {
    database = await checkDatabaseReachability();
  } catch {
    database = "unconfigured";
  }

  const isHealthy = database === "reachable";

  return NextResponse.json(
    {
      status: isHealthy ? "ok" : "degraded",
      environment,
      database,
    },
    {
      status: isHealthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
