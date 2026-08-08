import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/env";
import type { Database } from "./database.types";

export type DatabaseReachability = "reachable" | "unreachable" | "unauthorized";

let cachedClient: SupabaseClient<Database> | undefined;

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (!cachedClient) {
    const env = getServerEnv();
    cachedClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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
    const url = `${env.SUPABASE_URL}/rest/v1/_health_probe?select=*&limit=1`;
    response = await fetch(url, {
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
      // non-JSON 404 body
    }
  }
  return "unreachable";
}
