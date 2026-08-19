// Server-only generation repository (Milestone 5).
// Persists generation attempt lifecycle and provider request audit rows for
// image generation. Session status transitions stay on
// transition_prompt_session (compare-and-set); attempt terminal states go
// through guarded RPCs so a stale worker cannot overwrite a completed attempt.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import type { Database } from "@/server/supabase/database.types";

type AttemptRow = Database["public"]["Tables"]["generation_attempts"]["Row"];

const ATTEMPT_COLUMNS =
  "id, session_id, revision_id, attempt_number, status, image_provider_config_id, provider_request_id, parameters, telegram_message_id, error_code, error_message_redacted, started_at, completed_at, created_at";

export type GenerationAttemptSafe = {
  id: string;
  sessionId: string;
  revisionId: string;
  attemptNumber: number;
  status: string;
  imageProviderConfigId: string | null;
  providerRequestId: string | null;
  parameters: Record<string, unknown>;
  telegramMessageId: number | null;
  errorCode: string | null;
  errorMessageRedacted: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type RecordProviderRequestInput = {
  jobId: string;
  providerConfigId: string;
  providerKeyId: string;
  capability: "reasoning" | "image_generation";
};

function mapAttempt(row: AttemptRow): GenerationAttemptSafe {
  return {
    id: row.id,
    sessionId: row.session_id,
    revisionId: row.revision_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    imageProviderConfigId: row.image_provider_config_id,
    providerRequestId: row.provider_request_id,
    parameters: (row.parameters as Record<string, unknown> | null) ?? {},
    telegramMessageId: row.telegram_message_id,
    errorCode: row.error_code,
    errorMessageRedacted: row.error_message_redacted,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export class GenerationRepository {
  async getAttemptById(id: string): Promise<GenerationAttemptSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("generation_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`generation attempt get failed: ${error.message}`);
    return data ? mapAttempt(data) : null;
  }

  // Atomically creates the next attempt and repoints the session's active
  // generation attempt. Raises when a generation is already in progress for
  // the session (anti double-click regenerate).
  async createAttempt(input: {
    sessionId: string;
    revisionId: string;
  }): Promise<{ attemptId: string; attemptNumber: number }> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("create_generation_attempt", {
        p_session_id: input.sessionId,
        p_revision_id: input.revisionId,
      })
      .single();

    if (error) throw new Error(`create_generation_attempt failed: ${error.message}`);
    const row = data as unknown as { attempt_id: string; attempt_number: number };
    return { attemptId: row.attempt_id, attemptNumber: row.attempt_number };
  }

  // Marks the attempt processing (guard: only from queued) so the guarded
  // mark_*_failed RPCs cannot race a completed attempt.
  async markProcessing(attemptId: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("generation_attempts")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
      } as Database["public"]["Tables"]["generation_attempts"]["Update"])
      .eq("id", attemptId)
      .eq("status", "queued")
      .select("id");

    if (error) throw new Error(`generation attempt mark processing failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error("generation attempt mark processing: attempt not in queued state");
    }
  }

  // Records which provider config was selected for this attempt and the
  // parameters used (e.g. seed). Called after markProcessing, so no status
  // guard is needed.
  async attachProviderToAttempt(
    attemptId: string,
    imageProviderConfigId: string,
    parameters?: Record<string, unknown>,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("generation_attempts")
      .update({
        image_provider_config_id: imageProviderConfigId,
        ...(parameters ? { parameters } : {}),
      } as Database["public"]["Tables"]["generation_attempts"]["Update"])
      .eq("id", attemptId)
      .select("id");

    if (error) throw new Error(`generation attempt attach provider failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error("generation attempt attach provider: attempt not found");
    }
  }

  async markAttemptFailed(
    attemptId: string,
    errorCode: string,
    errorMessageRedacted?: string,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .rpc("mark_generation_attempt_failed", {
        p_attempt_id: attemptId,
        p_error_code: errorCode,
        p_error_message_redacted: errorMessageRedacted ?? null,
      } as never)
      .single();

    if (error) throw new Error(`mark generation attempt failed: ${error.message}`);
  }

  async markAttemptSucceeded(
    attemptId: string,
    providerRequestId: string | null,
    telegramMessageId: number | null,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .rpc("mark_generation_attempt_succeeded", {
        p_attempt_id: attemptId,
        p_provider_request_id: providerRequestId ?? null,
        p_telegram_message_id: telegramMessageId ?? null,
      } as never)
      .single();

    if (error) throw new Error(`mark generation attempt succeeded: ${error.message}`);
  }

  // Terminal completion via the guarded RPC (rejects terminal source states
  // and in-flight generation).
  async completeSession(sessionId: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .rpc("complete_prompt_session", {
        p_session_id: sessionId,
      })
      .single();

    if (error) throw new Error(`complete prompt session failed: ${error.message}`);
  }

  // Persists the provider request audit row before the outbound call so every
  // generation is traceable even when the request never completes.
  async recordProviderRequest(input: RecordProviderRequestInput): Promise<string> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_requests")
      .insert({
        job_id: input.jobId,
        provider_config_id: input.providerConfigId,
        provider_key_id: input.providerKeyId,
        capability: input.capability,
        status: "requested",
      } as Database["public"]["Tables"]["provider_requests"]["Insert"])
      .select("id")
      .single();

    if (error) throw new Error(`provider request record failed: ${error.message}`);
    return data!.id;
  }

  async markProviderRequestSucceeded(input: {
    requestId: string;
    providerRequestId?: string;
    httpStatus?: number;
    latencyMs?: number;
  }): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("provider_requests")
      .update({
        status: "succeeded",
        provider_request_id: input.providerRequestId ?? null,
        http_status: input.httpStatus ?? null,
        latency_ms: input.latencyMs ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.requestId);

    if (error) throw new Error(`provider request mark succeeded failed: ${error.message}`);
  }

  async markProviderRequestFailed(input: {
    requestId: string;
    errorCode: string;
    httpStatus?: number;
  }): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("provider_requests")
      .update({
        status: "failed",
        error_code: input.errorCode,
        http_status: input.httpStatus ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.requestId);

    if (error) throw new Error(`provider request mark failed failed: ${error.message}`);
  }
}
