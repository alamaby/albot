// Server-only recovery repository (Milestone 6).
// Thin wrappers around the M6 RPCs: lease-expiry sweep, dead-job marking,
// stale-session expiry, and metadata purging. All RPCs are security definer
// and callable only by service_role.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import type { Database } from "@/server/supabase/database.types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type SessionRow = Database["public"]["Tables"]["prompt_sessions"]["Row"];

export type PurgeResult = { purgedRows: number };

export class RecoveryRepository {
  // Re-queues processing jobs whose lease expired. Returns the recovered rows.
  async expireStaleLeases(maxJobs = 5): Promise<JobRow[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("expire_job_leases" as never, { p_max_jobs: maxJobs } as never)
      .select("*");
    if (error) throw new Error(`expire job leases failed: ${error.message}`);
    return (data as JobRow[] | null) ?? [];
  }

  // Terminal-fails jobs that can never be claimed again. Returns the rows.
  async markDeadJobs(maxJobs = 25): Promise<JobRow[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("mark_dead_jobs" as never, { p_max_jobs: maxJobs } as never)
      .select("*");
    if (error) throw new Error(`mark dead jobs failed: ${error.message}`);
    return (data as JobRow[] | null) ?? [];
  }

  // Marks non-terminal sessions whose expires_at passed as expired. Returns
  // the rows so the caller can notify the user best-effort.
  async recoverStaleSessions(maxSessions = 100): Promise<SessionRow[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("recover_stale_sessions" as never, { p_max_sessions: maxSessions } as never)
      .select("*");
    if (error) throw new Error(`recover stale sessions failed: ${error.message}`);
    return (data as SessionRow[] | null) ?? [];
  }

  // Deletes terminal metadata older than the retention window.
  async purgeExpiredMetadata(retentionDays = 30, maxRows = 1000): Promise<PurgeResult> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc(
        "purge_expired_metadata" as never,
        {
          p_retention_days: retentionDays,
          p_max_rows: maxRows,
        } as never,
      )
      .single();
    if (error) throw new Error(`purge expired metadata failed: ${error.message}`);
    const purgedRows = Number(
      (data as unknown as { purged_rows: number } | null)?.purged_rows ?? 0,
    );
    return { purgedRows };
  }
}
