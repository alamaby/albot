import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/env";

let cachedClient: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (!cachedClient) {
    const env = getServerEnv();
    cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedClient;
}

export async function isDatabaseReachable(): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from("_health_probe").select("*").limit(1);
  if (!error) {
    return true;
  }
  if (error.code === "42P01") {
    return true;
  }
  return false;
}
