// Server-only job repository (Milestone 4).
// Durable job rows for the revision loop and the enhancement processor:
// inserting follow-up jobs and completing/retrying/failing claimed jobs.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";
import type { Database } from "@/server/supabase/database.types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

const JOB_COLUMNS =
  "id, job_type, prompt_session_id, prompt_revision_id, generation_attempt_id, status, payload, attempt_count, max_attempts, available_at, locked_at, locked_by, lease_expires_at, last_error_code, last_error_message_redacted, created_at, updated_at, completed_at";

export type JobSafe = {
  id: string;
  jobType: string;
  promptSessionId: string | null;
  promptRevisionId: string | null;
  generationAttemptId: string | null;
  status: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  lockedBy: string | null;
  lastErrorCode: string | null;
  lastErrorMessageRedacted: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type InsertEnhancementJobInput = {
  sessionId: string;
  revisionId: string;
  payload?: Record<string, unknown>;
};

function mapRow(row: JobRow): JobSafe {
  return {
    id: row.id,
    jobType: row.job_type,
    promptSessionId: row.prompt_session_id,
    promptRevisionId: row.prompt_revision_id,
    generationAttemptId: row.generation_attempt_id,
    status: row.status,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    lockedBy: row.locked_by,
    lastErrorCode: row.last_error_code,
    lastErrorMessageRedacted: row.last_error_message_redacted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export class JobRepository {
  async getById(id: string): Promise<JobSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`job get failed: ${error.message}`);
    return data ? mapRow(data) : null;
  }

  // Creates a follow-up enhance_prompt job for a (new) revision. Used by the
  // revision-input flow so the new revision is enhanced on the processor side.
  async insertEnhancementJob(input: InsertEnhancementJobInput): Promise<string> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        job_type: "enhance_prompt",
        prompt_session_id: input.sessionId,
        prompt_revision_id: input.revisionId,
        status: "queued",
        payload: input.payload ?? {},
      } as Database["public"]["Tables"]["jobs"]["Insert"])
      .select("id")
      .single();

    if (error) throw new Error(`enhancement job insert failed: ${error.message}`);
    return data!.id;
  }

  // Links a job to its generation attempt once the attempt exists (created by
  // the generate-image use case after claim). Keeps the job row auditable and
  // lets a retried claim find the attempt id on failure.
  async attachGenerationAttempt(jobId: string, attemptId: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("jobs")
      .update({ generation_attempt_id: attemptId })
      .eq("id", jobId);

    if (error) throw new Error(`job attach generation attempt failed: ${error.message}`);
  }

  // Creates a session-less enhance_only job (/enhance-prompt). The raw prompt
  // travels in the payload; there is no session or revision row. The handler
  // replies with the enhanced prompt as plain text.
  // `preferredReasoningConfigId` is the user's default reasoning preference
  // (resolved by the webhook) so the session-less flow honors it.
  async insertEnhanceOnlyJob(input: {
    telegramUserId: bigint;
    telegramChatId: bigint;
    sourcePrompt: string;
    preferredReasoningConfigId?: string | null;
  }): Promise<string> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        job_type: "enhance_only",
        prompt_session_id: null,
        prompt_revision_id: null,
        status: "queued",
        payload: {
          telegram_user_id: bigintToDb(input.telegramUserId),
          telegram_chat_id: bigintToDb(input.telegramChatId),
          source_prompt: input.sourcePrompt,
          ...(input.preferredReasoningConfigId
            ? { preferred_reasoning_config_id: input.preferredReasoningConfigId }
            : {}),
        },
      } as Database["public"]["Tables"]["jobs"]["Insert"])
      .select("id")
      .single();

    if (error) throw new Error(`enhance only job insert failed: ${error.message}`);
    return data!.id;
  }

  // Counts enhance_only jobs created for a user within the sliding window.
  // The session-based rate limit cannot see these session-less jobs, so the
  // webhook uses this counter to give /enhance-prompt the same abuse-control
  // budget as prompt submissions.
  async countRecentEnhanceOnlyJobs(telegramUserId: bigint, windowMinutes: number): Promise<number> {
    const supabase = getSupabaseAdmin();
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    const { count, error } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "enhance_only")
      .filter("payload->>telegram_user_id", "eq", bigintToDb(telegramUserId))
      .gte("created_at", since);

    if (error) throw new Error(`recent enhance_only job count failed: ${error.message}`);
    return count ?? 0;
  }

  // Creates a generate_image job from a confirmed revision (Milestone 5 owns
  // the handler; the job stays queued until then).
  async insertGenerateImageJob(input: {
    sessionId: string;
    revisionId: string;
    payload?: Record<string, unknown>;
  }): Promise<string> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        job_type: "generate_image",
        prompt_session_id: input.sessionId,
        prompt_revision_id: input.revisionId,
        status: "queued",
        payload: input.payload ?? {},
      } as Database["public"]["Tables"]["jobs"]["Insert"])
      .select("id")
      .single();

    if (error) throw new Error(`generate image job insert failed: ${error.message}`);
    return data!.id;
  }

  // Marks the job terminal-successful. Guarded by worker ownership so a stale
  // worker cannot complete a job another worker already re-claimed.
  async markSucceeded(jobId: string, workerId: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("jobs")
      .update({
        status: "succeeded",
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("locked_by", workerId);

    if (error) throw new Error(`job mark succeeded failed: ${error.message}`);
  }

  // Reschedules a claimed job with a future available_at (bounded backoff).
  // Guarded by worker ownership.
  async markRetryScheduled(
    jobId: string,
    workerId: string,
    availableAt: string,
    errorCode: string,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("jobs")
      .update({
        status: "retry_scheduled",
        available_at: availableAt,
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        last_error_code: errorCode,
      })
      .eq("id", jobId)
      .eq("locked_by", workerId);

    if (error) throw new Error(`job mark retry scheduled failed: ${error.message}`);
  }

  // Marks the job terminal-failed. Guarded by worker ownership.
  async markFailed(
    jobId: string,
    workerId: string,
    options?: { errorCode?: string; errorMessageRedacted?: string },
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("jobs")
      .update({
        status: "failed",
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        completed_at: new Date().toISOString(),
        ...(options?.errorCode ? { last_error_code: options.errorCode } : {}),
        ...(options?.errorMessageRedacted
          ? { last_error_message_redacted: options.errorMessageRedacted }
          : {}),
      })
      .eq("id", jobId)
      .eq("locked_by", workerId);

    if (error) throw new Error(`job mark failed failed: ${error.message}`);
  }
}
