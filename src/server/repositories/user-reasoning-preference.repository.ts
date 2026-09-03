// Server-only user reasoning preference repository.
// Stores per-user default reasoning provider (hybrid selection), mirroring
// user_image_preferences.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";

export type UserReasoningPreferenceSafe = {
  telegramUserId: bigint;
  preferredProviderConfigId: string;
  createdAt: string;
  updatedAt: string;
};

export class UserReasoningPreferenceRepository {
  async getByTelegramUserId(telegramUserId: bigint): Promise<UserReasoningPreferenceSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_reasoning_preferences")
      .select("telegram_user_id, preferred_provider_config_id, created_at, updated_at")
      .eq("telegram_user_id", bigintToDb(telegramUserId))
      .maybeSingle();

    if (error) throw new Error(`user reasoning preference get failed: ${error.message}`);
    if (!data) return null;
    return {
      telegramUserId: BigInt(data.telegram_user_id as unknown as number),
      preferredProviderConfigId: data.preferred_provider_config_id as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
    };
  }

  async upsert(
    telegramUserId: bigint,
    preferredProviderConfigId: string,
  ): Promise<UserReasoningPreferenceSafe> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_reasoning_preferences")
      .upsert(
        {
          telegram_user_id: bigintToDb(telegramUserId),
          preferred_provider_config_id: preferredProviderConfigId,
        },
        { onConflict: "telegram_user_id" },
      )
      .select("telegram_user_id, preferred_provider_config_id, created_at, updated_at")
      .single();

    if (error) throw new Error(`user reasoning preference upsert failed: ${error.message}`);
    return {
      telegramUserId: BigInt(data.telegram_user_id as unknown as number),
      preferredProviderConfigId: data.preferred_provider_config_id as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
    };
  }
}
