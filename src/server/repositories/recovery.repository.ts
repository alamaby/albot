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
      .rpc("expire_job_leases", { p_max_jobs: maxJobs })
      .select("*");
    if (error) throw new Error(`expire job leases failed: ${error.message}`);
    return (data as JobRow[] | null) ?? [];
  }

  // Terminal-fails jobs that can never be claimed again. Returns the rows.
  async markDeadJobs(maxJobs = 25): Promise<JobRow[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("mark_dead_jobs", { p_max_jobs: maxJobs })
      .select("*");
    if (error) throw new Error(`mark dead jobs failed: ${error.message}`);
    return (data as JobRow[] | null) ?? [];
  }

  // Marks non-terminal sessions whose expires_at passed as expired. Returns
  // the rows so the caller can notify the user best-effort.
  async recoverStaleSessions(maxSessions = 100): Promise<SessionRow[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("recover_stale_sessions", { p_max_sessions: maxSessions })
      .select("*");
    if (error) throw new Error(`recover stale sessions failed: ${error.message}`);
    return (data as SessionRow[] | null) ?? [];
  }

  // Recovers generating sessions stuck with a processing attempt older than
  // p_stuck_minutes (default 15m). Moves them to generation_failed so the
  // user can Regenerate without manual SQL. Returns the recovered rows.
  // Best-effort: returns [] if the RPC does not exist yet (prod before migration).
  async recoverStuckGeneratingSessions(maxSessions = 25, stuckMinutes = 15): Promise<SessionRow[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("recover_stuck_generating_sessions", {
        p_max_sessions: maxSessions,
        p_stuck_minutes: stuckMinutes,
      })
      .select("*");
    if (error) {
      if (
        error.message.includes("does not exist") ||
        error.message.includes("recover_stuck_generating_sessions")
      ) {
        return [];
      }
      throw new Error(`recover stuck generating failed: ${error.message}`);
    }
    return (data as SessionRow[] | null) ?? [];
  }

  // Deletes terminal metadata older than the retention window.
  async purgeExpiredMetadata(retentionDays = 30, maxRows = 1000): Promise<PurgeResult> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("purge_expired_metadata", {
        p_retention_days: retentionDays,
        p_max_rows: maxRows,
      })
      .single();
    if (error) throw new Error(`purge expired metadata failed: ${error.message}`);
    const purgedRows = Number(
      (data as unknown as { purged_rows: number } | null)?.purged_rows ?? 0,
    );
    return { purgedRows };
  }

  // Deletes prompt_audit rows older than the (longer) cross-purge retention
  // window. Independent of purgeExpiredMetadata (which only handles the 30-day
  // transactional tables).
  async purgePromptAudit(retentionDays = 180, maxRows = 5000): Promise<PurgeResult> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("purge_prompt_audit", {
        p_retention_days: retentionDays,
        p_max_rows: maxRows,
      })
      .single();
    if (error) throw new Error(`purge prompt audit failed: ${error.message}`);
    const purgedRows = Number(
      (data as unknown as { purged_rows: number } | null)?.purged_rows ?? 0,
    );
    return { purgedRows };
  }
}
