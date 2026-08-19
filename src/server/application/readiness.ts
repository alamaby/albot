// Operational readiness checks (Milestone 6).
//
// Read-only database probes that never call a provider, never spend credit,
// and never expose secrets. Used by the health endpoint (?include=readiness)
// and by the admin diagnostics endpoint.

import { getSupabaseAdmin } from "@/server/supabase/admin";

export type ReadinessReport = {
  database: "reachable" | "unreachable";
  jobs: {
    queued: number;
    retryScheduled: number;
    processing: number;
    failed: number;
    succeeded: number;
  };
  deadJobs: number;
  leaseExpired: number;
  expiredSessions: number; // swept to 'expired'
  expiringSessions: number; // non-terminal with expires_at in the past
  cooldownKeys: number;
};

// Runs the diagnostics queries concurrently; a failing probe degrades the
// report instead of throwing, so health never 500s on a transient DB error.
export async function checkReadiness(): Promise<ReadinessReport> {
  const supabase = getSupabaseAdmin();

  const [jobCounts, deadJobs, leaseExpired, expiredSessions, expiringSessions, cooldownKeys] =
    await Promise.all([
      countJobsByStatus(supabase),
      countWhere(supabase, "jobs", { status: "failed", last_error_code: "dead_job" }),
      countProcessingWithExpiredLease(supabase),
      countWhere(supabase, "prompt_sessions", { status: "expired" }),
      countExpiringSessions(supabase),
      countWhereActive(supabase, "provider_keys", { is_active: true }),
    ]);

  return {
    database: "reachable",
    jobs: {
      queued: jobCounts.queued,
      retryScheduled: jobCounts.retryScheduled,
      processing: jobCounts.processing,
      failed: jobCounts.failed,
      succeeded: jobCounts.succeeded,
    },
    deadJobs,
    leaseExpired,
    expiredSessions,
    expiringSessions,
    cooldownKeys,
  };
}

type SupabaseClient = ReturnType<typeof getSupabaseAdmin>;

async function countJobsByStatus(
  supabase: SupabaseClient,
): Promise<Record<"queued" | "retryScheduled" | "processing" | "failed" | "succeeded", number>> {
  const statuses = ["queued", "retry_scheduled", "processing", "failed", "succeeded"] as const;
  const entries = await Promise.all(
    statuses.map(async (status) => {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      return [status, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    "queued" | "retryScheduled" | "processing" | "failed" | "succeeded",
    number
  >;
}

async function countWhere(
  supabase: SupabaseClient,
  table: "jobs" | "prompt_sessions" | "provider_keys",
  filters: Record<string, string | number | boolean>,
): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  const { count } = await query;
  return count ?? 0;
}

async function countProcessingWithExpiredLease(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .lte("lease_expires_at", new Date().toISOString());
  return count ?? 0;
}

async function countExpiringSessions(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("prompt_sessions")
    .select("id", { count: "exact", head: true })
    .not("status", "in", '("completed","cancelled","expired")')
    .lte("expires_at", new Date().toISOString());
  return count ?? 0;
}

async function countWhereActive(
  supabase: SupabaseClient,
  table: "provider_keys",
  filters: Record<string, string | number | boolean>,
): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  // Cooldown = cooldown_until in the future.
  query = query.gt("cooldown_until", new Date().toISOString());
  const { count } = await query;
  return count ?? 0;
}
