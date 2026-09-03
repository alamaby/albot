// Server-only session repository (Milestone 4).
// Reads and conditionally updates prompt_sessions. Status transitions must go
// through the transition_prompt_session RPC (compare-and-set); this repository
// only exposes lookups and non-status bookkeeping.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";
import type { Database } from "@/server/supabase/database.types";

type SessionRow = Database["public"]["Tables"]["prompt_sessions"]["Row"];

const SESSION_COLUMNS =
  "id, telegram_user_id, telegram_chat_id, status, active_revision_id, active_generation_attempt_id, preferred_image_provider_config_id, preferred_reasoning_provider_config_id, telegram_status_message_id, created_at, updated_at, expires_at, completed_at";

export type SessionSafe = {
  id: string;
  telegramUserId: bigint;
  telegramChatId: bigint;
  status: string;
  activeRevisionId: string | null;
  activeGenerationAttemptId: string | null;
  preferredImageProviderConfigId: string | null;
  preferredReasoningProviderConfigId: string | null;
  telegramStatusMessageId: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
};

function mapRow(row: WideSessionRow): SessionSafe {
  return {
    id: row.id,
    telegramUserId: BigInt(row.telegram_user_id),
    telegramChatId: BigInt(row.telegram_chat_id),
    status: row.status,
    activeRevisionId: row.active_revision_id,
    activeGenerationAttemptId: row.active_generation_attempt_id,
    preferredImageProviderConfigId: row.preferred_image_provider_config_id ?? null,
    preferredReasoningProviderConfigId: row.preferred_reasoning_provider_config_id ?? null,
    telegramStatusMessageId:
      row.telegram_status_message_id === null ? null : Number(row.telegram_status_message_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
  };
}

// The generated types model bigint columns as number. Telegram ids are 64-bit
// and must never round-trip through JS Number; widen the select type so the
// mapper stays honest.
type WideSessionRow = Omit<
  SessionRow,
  "telegram_user_id" | "telegram_chat_id" | "telegram_status_message_id"
> & {
  telegram_user_id: number | string;
  telegram_chat_id: number | string;
  telegram_status_message_id: number | string | null;
  preferred_image_provider_config_id: string | null;
  preferred_reasoning_provider_config_id: string | null;
};

export class SessionRepository {
  async getById(id: string): Promise<SessionSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("prompt_sessions")
      .select(SESSION_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`session get failed: ${error.message}`);
    return data ? mapRow(data as unknown as WideSessionRow) : null;
  }

  // Latest non-terminal session for a user, used to detect revision-input mode.
  // enhancement_failed / generation_failed are treated as terminal for this
  // lookup so a new prompt can start without being blocked by a prior failure
  // (prompt_sessions_one_active_idx is aligned via migration 20260821090000).
  async findActiveByUserId(telegramUserId: bigint): Promise<SessionSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("prompt_sessions")
      .select(SESSION_COLUMNS)
      .eq("telegram_user_id", bigintToDb(telegramUserId))
      .not(
        "status",
        "in",
        '("completed","cancelled","expired","enhancement_failed","generation_failed")',
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`active session lookup failed: ${error.message}`);
    return data ? mapRow(data as unknown as WideSessionRow) : null;
  }

  // Persists the Telegram message id of the generation status message so the
  // job worker can edit it to the final outcome. Non-status bookkeeping; a
  // plain update (no CAS) matches the other non-status writes in this repo.
  async saveStatusMessageId(sessionId: string, messageId: number): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("prompt_sessions")
      .update({ telegram_status_message_id: messageId })
      .eq("id", sessionId);
    if (error) throw new Error(`save status message id failed: ${error.message}`);
  }

  async setPreferredImageProvider(
    sessionId: string,
    providerConfigId: string | null,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("prompt_sessions")
      .update({ preferred_image_provider_config_id: providerConfigId })
      .eq("id", sessionId);
    if (error) throw new Error(`set preferred image provider failed: ${error.message}`);
  }

  async setPreferredReasoningProvider(
    sessionId: string,
    providerConfigId: string | null,
  ): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("prompt_sessions")
      .update({ preferred_reasoning_provider_config_id: providerConfigId })
      .eq("id", sessionId);
    if (error) throw new Error(`set preferred reasoning provider failed: ${error.message}`);
  }

  async cancelActiveSession(sessionId: string, expectedStatus: string): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: sessionId,
        p_expected_status: expectedStatus,
        p_new_status: "cancelled",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`cancel session failed: ${error.message}`);
    return Boolean(data);
  }
}
