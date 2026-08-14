// Server-only enhancement repository (Milestone 4).
// Persists the enhancement outcome: provider request audit rows, the completed
// revision fields, and revision failure marking. Status transitions on the
// session itself must go through transition_prompt_session (compare-and-set).

import { getSupabaseAdmin } from "@/server/supabase/admin";
import type { Database } from "@/server/supabase/database.types";

type RevisionRow = Database["public"]["Tables"]["prompt_revisions"]["Row"];

const REVISION_COLUMNS =
  "id, session_id, revision_number, source_prompt, previous_prompt, revision_instruction, enhanced_prompt, negative_prompt, aspect_ratio, reasoning_provider_config_id, status, created_at, completed_at";

export type RevisionSafe = {
  id: string;
  sessionId: string;
  revisionNumber: number;
  sourcePrompt: string;
  previousPrompt: string | null;
  revisionInstruction: string | null;
  enhancedPrompt: string | null;
  negativePrompt: string | null;
  aspectRatio: string | null;
  reasoningProviderConfigId: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
};

export type RecordProviderRequestInput = {
  jobId: string;
  providerConfigId: string;
  providerKeyId: string;
  capability: "reasoning" | "image_generation";
};

export type SaveEnhancedPromptInput = {
  revisionId: string;
  enhancedPrompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  reasoningProviderConfigId: string;
};

function mapRevision(row: RevisionRow): RevisionSafe {
  return {
    id: row.id,
    sessionId: row.session_id,
    revisionNumber: row.revision_number,
    sourcePrompt: row.source_prompt,
    previousPrompt: row.previous_prompt,
    revisionInstruction: row.revision_instruction,
    enhancedPrompt: row.enhanced_prompt,
    negativePrompt: row.negative_prompt,
    aspectRatio: row.aspect_ratio,
    reasoningProviderConfigId: row.reasoning_provider_config_id,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class EnhancementRepository {
  async getRevisionById(id: string): Promise<RevisionSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("prompt_revisions")
      .select(REVISION_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`revision get failed: ${error.message}`);
    return data ? mapRevision(data) : null;
  }

  // Persists the provider request audit row before the outbound call so every
  // enhancement is traceable even when the request never completes.
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

  async saveEnhancedPrompt(input: SaveEnhancedPromptInput): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("prompt_revisions")
      .update({
        enhanced_prompt: input.enhancedPrompt,
        negative_prompt: input.negativePrompt ?? null,
        aspect_ratio: input.aspectRatio ?? null,
        reasoning_provider_config_id: input.reasoningProviderConfigId,
        status: "completed",
        completed_at: new Date().toISOString(),
      } as Database["public"]["Tables"]["prompt_revisions"]["Update"])
      .eq("id", input.revisionId);

    if (error) throw new Error(`enhanced prompt save failed: ${error.message}`);
  }

  // Marks a revision processing-state as failed via RPC (guard-patched so a
  // stale worker cannot overwrite a completed revision).
  async markRevisionFailed(
    revisionId: string,
    errorCode: string,
    errorMessageRedacted?: string,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .rpc(
        "mark_revision_failed" as never,
        {
          p_revision_id: revisionId,
          p_error_code: errorCode,
          p_error_message_redacted: errorMessageRedacted ?? null,
        } as never,
      )
      .single();

    if (error) throw new Error(`mark revision failed: ${error.message}`);
  }
}
