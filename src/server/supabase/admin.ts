import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/env";

export type DatabaseReachability = "reachable" | "unreachable" | "unauthorized";

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

export async function checkDatabaseReachability(): Promise<DatabaseReachability> {
  const env = getServerEnv();

  let response: Response;
  try {
    response = await fetch(`${env.SUPABASE_URL}/rest/v1/_health_probe?select=*&limit=1`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  } catch {
    return "unreachable";
  }

  if (response.ok) {
    return "reachable";
  }
  if (response.status === 401 || response.status === 403) {
    return "unauthorized";
  }
  if (response.status === 404) {
    try {
      const body = (await response.json()) as { code?: string };
      if (body.code === "42P01" || body.code === "PGRST205") {
        return "reachable";
      }
    } catch {
      // non-JSON 404 body: not a PostgREST table-missing response
    }
  }
  return "unreachable";
}
