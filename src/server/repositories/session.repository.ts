// Server-only session repository (Milestone 4).
// Reads and conditionally updates prompt_sessions. Status transitions must go
// through the transition_prompt_session RPC (compare-and-set); this repository
// only exposes lookups and non-status bookkeeping.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";
import type { Database } from "@/server/supabase/database.types";

type SessionRow = Database["public"]["Tables"]["prompt_sessions"]["Row"];

const SESSION_COLUMNS =
  "id, telegram_user_id, telegram_chat_id, status, active_revision_id, active_generation_attempt_id, created_at, updated_at, expires_at, completed_at";

export type SessionSafe = {
  id: string;
  telegramUserId: bigint;
  telegramChatId: bigint;
  status: string;
  activeRevisionId: string | null;
  activeGenerationAttemptId: string | null;
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
  async findActiveByUserId(telegramUserId: bigint): Promise<SessionSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("prompt_sessions")
      .select(SESSION_COLUMNS)
      .eq("telegram_user_id", bigintToDb(telegramUserId))
      .not("status", "in", '("completed","cancelled","expired")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`active session lookup failed: ${error.message}`);
    return data ? mapRow(data as unknown as WideSessionRow) : null;
  }
}
