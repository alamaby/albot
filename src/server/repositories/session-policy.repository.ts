// Server-only session policy repository.
// Derives abuse-control state from the prompt_sessions table (no extra tables):
// - active session: session whose status is not terminal (received..generation_failed)
// - recent submissions: sessions created within the rate-limit window
// Both values are used by the webhook handler before creating a new session.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";

const TERMINAL_STATUSES = ["completed", "cancelled", "expired"];

export type SessionPolicyState = {
  activeSessionCount: number;
  recentSubmissionCount: number;
};

export type SessionPolicyLimits = {
  rateLimitWindowMinutes: number;
  rateLimitMaxSubmissions: number;
};

export class SessionPolicyRepository {
  // Counts sessions for a user that are not in a terminal status and not yet
  // expired by time. Sessions in `expired` status are terminal; sessions whose
  // expires_at passed but status was never swept are filtered by time here.
  async countActiveSessions(telegramUserId: bigint): Promise<number> {
    const supabase = getSupabaseAdmin();
    const userId = bigintToDb(telegramUserId);
    const { count, error } = await supabase
      .from("prompt_sessions")
      .select("id", { count: "exact", head: true })
      .eq("telegram_user_id", userId)
      .not("status", "in", `("${TERMINAL_STATUSES.join('","')}")`)
      .gt("expires_at", new Date().toISOString());

    if (error) throw new Error(`active session count failed: ${error.message}`);
    return count ?? 0;
  }

  // Counts sessions created within the sliding window. Used for the per-user
  // prompt submission rate limit (default 5 per 10 minutes).
  async countRecentSubmissions(telegramUserId: bigint, windowMinutes: number): Promise<number> {
    const supabase = getSupabaseAdmin();
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const { count, error } = await supabase
      .from("prompt_sessions")
      .select("id", { count: "exact", head: true })
      .eq("telegram_user_id", bigintToDb(telegramUserId))
      .gte("created_at", since);

    if (error) throw new Error(`recent submission count failed: ${error.message}`);
    return count ?? 0;
  }

  async getPolicyState(
    telegramUserId: bigint,
    limits: SessionPolicyLimits,
  ): Promise<SessionPolicyState> {
    const [activeSessionCount, recentSubmissionCount] = await Promise.all([
      this.countActiveSessions(telegramUserId),
      this.countRecentSubmissions(telegramUserId, limits.rateLimitWindowMinutes),
    ]);
    return { activeSessionCount, recentSubmissionCount };
  }
}

export const DEFAULT_SESSION_POLICY_LIMITS: SessionPolicyLimits = {
  rateLimitWindowMinutes: 10,
  rateLimitMaxSubmissions: 5,
};
