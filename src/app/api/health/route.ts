import { NextResponse } from "next/server";
import { isDatabaseReachable } from "@/server/supabase/admin";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const environment = process.env.NODE_ENV ?? "development";

  let database: "reachable" | "unreachable" | "unconfigured";
  try {
    database = (await isDatabaseReachable()) ? "reachable" : "unreachable";
  } catch {
    database = "unconfigured";
  }

  return NextResponse.json({
    status: "ok",
    environment,
    database,
  });
}
