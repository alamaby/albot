// Server-only bot user repository (allowlist).
// Queries the bot_users table by numeric Telegram user id (bigint).

import { getSupabaseAdmin } from "@/server/supabase/admin";

export type BotUserSafe = {
  id: string;
  telegramUserId: bigint;
  isAllowed: boolean;
  isAdmin: boolean;
  username?: string;
};

export class BotUserRepository {
  async findByTelegramUserId(telegramUserId: bigint): Promise<BotUserSafe | null> {
    const supabase = getSupabaseAdmin();
    // Telegram user ids are 64-bit; PostgREST accepts decimal strings for
    // bigint columns even though the generated types model them as number.
    const { data, error } = await supabase
      .from("bot_users")
      .select("id, telegram_user_id, is_allowed, is_admin, username")
      .eq("telegram_user_id", telegramUserId.toString() as unknown as number)
      .maybeSingle();

    if (error) throw new Error(`bot user lookup failed: ${error.message}`);
    if (!data) return null;

    return {
      id: data.id,
      telegramUserId: BigInt(data.telegram_user_id),
      isAllowed: data.is_allowed,
      isAdmin: data.is_admin,
      username: data.username ?? undefined,
    };
  }

  async touchLastSeen(id: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("bot_users")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`bot user touch failed: ${error.message}`);
  }
}
