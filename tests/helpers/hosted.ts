import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/server/supabase/database.types";

export interface HostedEnv {
  projectRef: string;
  dbPassword: string;
  url: string;
  serviceRoleKey: string;
  publishableKey: string;
  accessToken: string;
}

// Resolves values from either the migration-workflow names (SUPABASE_*) or the
// local .env names (SUPABASE_*_DEV). Returns null when hosted credentials are
// absent so hosted tests can skip deterministically in secret-less CI.
export function getHostedEnv(): HostedEnv | null {
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? process.env.SUPABASE_PROJECT_REF_DEV;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD ?? process.env.SUPABASE_DB_PASSWORD_DEV;
  const url = process.env.SUPABASE_URL ?? process.env.SUPABASE_URL_DEV;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY_DEV;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY_DEV;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";

  if (!projectRef || !dbPassword || !url || !serviceRoleKey || !publishableKey) {
    return null;
  }
  return { projectRef, dbPassword, url, serviceRoleKey, publishableKey, accessToken };
}

export function isHostedConfigured(): boolean {
  return getHostedEnv() !== null;
}

export function getAdminClient(): SupabaseClient<Database> {
  const env = getHostedEnv();
  if (!env) throw new Error("hosted credentials not configured");
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export function getAnonClient(): SupabaseClient<Database> {
  const env = getHostedEnv();
  if (!env) throw new Error("hosted credentials not configured");
  return createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false },
  });
}

// Resolves the Supabase IPv4 pooler host. <ref>.pooler.supabase.com does not
// resolve directly; the pooler host is region-scoped (aws-0-<region>.pooler.supabase.com),
// so the region is derived once from the Management API using the access token.
export async function getDbHost(): Promise<string> {
  if (process.env.SUPABASE_DB_HOST) return process.env.SUPABASE_DB_HOST;
  const env = getHostedEnv();
  if (!env) throw new Error("hosted credentials not configured");
  if (!env.accessToken) throw new Error("SUPABASE_ACCESS_TOKEN required to derive DB host");
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.projectRef}`, {
    headers: { Authorization: `Bearer ${env.accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`failed to resolve project region: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { region?: string };
  if (!data.region) throw new Error("project region missing from API response");
  return `aws-0-${data.region}.pooler.supabase.com`;
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export async function getDbConfig(): Promise<DbConfig> {
  const env = getHostedEnv();
  if (!env) throw new Error("hosted credentials not configured");
  return {
    host: await getDbHost(),
    port: 6543,
    database: "postgres",
    user: `postgres.${env.projectRef}`,
    password: env.dbPassword,
  };
}
