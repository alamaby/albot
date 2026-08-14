// Server-only job repository (Milestone 4).
// Durable job rows for the revision loop and the enhancement processor:
// inserting follow-up jobs and completing/retrying/failing claimed jobs.

import { getSupabaseAdmin } from "@/server/supabase/admin";
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
