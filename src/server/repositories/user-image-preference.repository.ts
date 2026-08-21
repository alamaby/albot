// Server-only user image preference repository.
// Stores per-user default image provider (hybrid selection).

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";

export type UserImagePreferenceSafe = {
  telegramUserId: bigint;
  preferredProviderConfigId: string;
  createdAt: string;
  updatedAt: string;
};

export class UserImagePreferenceRepository {
  async getByTelegramUserId(telegramUserId: bigint): Promise<UserImagePreferenceSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_image_preferences")
      .select("telegram_user_id, preferred_provider_config_id, created_at, updated_at")
      .eq("telegram_user_id", bigintToDb(telegramUserId))
      .maybeSingle();

    if (error) throw new Error(`user image preference get failed: ${error.message}`);
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
  ): Promise<UserImagePreferenceSafe> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_image_preferences")
      .upsert(
        {
          telegram_user_id: bigintToDb(telegramUserId),
          preferred_provider_config_id: preferredProviderConfigId,
        },
        { onConflict: "telegram_user_id" },
      )
      .select("telegram_user_id, preferred_provider_config_id, created_at, updated_at")
      .single();

    if (error) throw new Error(`user image preference upsert failed: ${error.message}`);
    return {
      telegramUserId: BigInt(data.telegram_user_id as unknown as number),
      preferredProviderConfigId: data.preferred_provider_config_id as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
    };
  }
}
