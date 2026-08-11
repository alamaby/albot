// Server-only callback event repository.
// Inserts a callback_events row with a unique callback_query_id so Telegram
// callback retries are deduplicated at the database level.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import type { Database } from "@/server/supabase/database.types";

type CallbackEventInsert = Database["public"]["Tables"]["callback_events"]["Insert"];

export type InsertCallbackEventInput = {
  callbackQueryId: string;
  action: string;
  telegramUserId: bigint;
  promptSessionId?: string;
};

export class CallbackEventRepository {
  // Inserts the event unless an identical callback_query_id already exists.
  // Returns the new row id, or null when the event is a duplicate.
  async insertIfAbsent(input: InsertCallbackEventInput): Promise<string | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("callback_events")
      .insert({
        callback_query_id: input.callbackQueryId,
        action: input.action,
        telegram_user_id: input.telegramUserId.toString(),
        prompt_session_id: input.promptSessionId ?? null,
      } as unknown as CallbackEventInsert)
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 = unique_violation on callback_query_id.
      if (error.code === "23505") return null;
      throw new Error(`callback event insert failed: ${error.message}`);
    }
    return data?.id ?? null;
  }

  async markProcessed(id: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("callback_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`callback event mark processed failed: ${error.message}`);
  }
}
