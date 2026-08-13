// Server-only telegram update repository.
// Inserts a telegram_updates row with a unique update_id so Telegram retries
// and duplicate deliveries are deduplicated at the database level.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";
import type { Database } from "@/server/supabase/database.types";

type TelegramUpdateInsert = Database["public"]["Tables"]["telegram_updates"]["Insert"];

export type InsertTelegramUpdateInput = {
  updateId: bigint;
  telegramUserId?: bigint;
  telegramChatId?: bigint;
  updateType: "message" | "callback_query";
};

export class TelegramUpdateRepository {
  // Inserts the row unless an identical update_id already exists.
  // Returns the new row id, or null when the update is a duplicate.
  async insertIfAbsent(input: InsertTelegramUpdateInput): Promise<string | null> {
    const supabase = getSupabaseAdmin();
    // Telegram ids are 64-bit; they are stored as decimal strings so precision
    // survives the JSON body. The generated types model bigint as number, so
    // the insert is explicitly widened.
    const { data, error } = await supabase
      .from("telegram_updates")
      .insert({
        update_id: bigintToDb(input.updateId),
        telegram_user_id: input.telegramUserId ? bigintToDb(input.telegramUserId) : null,
        telegram_chat_id: input.telegramChatId ? bigintToDb(input.telegramChatId) : null,
        update_type: input.updateType,
      } as unknown as TelegramUpdateInsert)
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 = unique_violation on update_id: a concurrent/duplicate delivery
      // already inserted this update. Treat as duplicate, not failure.
      if (error.code === "23505") return null;
      throw new Error(`telegram update insert failed: ${error.message}`);
    }
    return data?.id ?? null;
  }

  async markProcessed(id: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("telegram_updates")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`telegram update mark processed failed: ${error.message}`);
  }
}
