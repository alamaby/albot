// Prompt-config repository: DB-driven system-prompt persona with TTL cache.
//
// Strict-error semantics (per plan): if no active row or DB error, the caller
// gets a ProviderError (retry classification decides job retry vs terminal).
// Callers must not fall back to a hardcoded const on error.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { ProviderError } from "@/server/providers/errors";
import { logStructured } from "@/server/observability/logger";

export const PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA = "enhancement_system_persona";

type CacheEntry = {
  value: string;
  fetchedAt: number;
};

const TTL_MS = 60_000;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

export function resetPromptConfigCache(): void {
  cache.clear();
  inflight.clear();
}

function isCacheValid(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < TTL_MS;
}

export class PromptConfigRepository {
  // Returns the active body for the key. Throws ProviderError if missing or DB errors.
  async getActivePersona(key: string = PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA): Promise<string> {
    const trimmedKey = key?.trim();
    if (!trimmedKey) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "prompt config key must be non-empty",
      });
    }

    const cached = cache.get(trimmedKey);
    if (cached && isCacheValid(cached)) {
      return cached.value;
    }

    // Single-flight: concurrent callers share the same DB fetch.
    const existing = inflight.get(trimmedKey);
    if (existing) return existing;

    const promise = this.fetchActivePersona(trimmedKey)
      .then((value) => {
        cache.set(trimmedKey, { value, fetchedAt: Date.now() });
        return value;
      })
      .finally(() => {
        inflight.delete(trimmedKey);
      });

    inflight.set(trimmedKey, promise);
    return promise;
  }

  // Direct DB fetch without cache (also used to validate strict errors).
  async getActivePersonaNoCache(
    key: string = PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA,
  ): Promise<string> {
    const trimmedKey = key?.trim();
    if (!trimmedKey) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "prompt config key must be non-empty",
      });
    }
    return this.fetchActivePersona(trimmedKey);
  }

  private async fetchActivePersona(key: string): Promise<string> {
    let body: string | null = null;
    try {
      const supabase: any = getSupabaseAdmin() as any;
      // Prefer RPC for stable contract; fall back to direct select if RPC missing.
      const { data, error } = await supabase.rpc("get_active_prompt_config", {
        p_key: key,
      } as never);

      if (error) {
        // Direct select fallback (legacy path before RPC deployed) — try table read.
        logStructured("warn", "prompt_config.rpc_failed_fallback", {
          key,
          detail: (error as { message?: string })?.message ?? String(error),
        });
        const fallback = await supabase
          .from("prompt_configs")
          .select("body")
          .eq("key", key)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (fallback.error) {
          throw new ProviderError({
            code: "provider_unknown_error",
            retryable: true,
            message: `prompt config fetch failed for key ${key}`,
            cause: fallback.error,
          });
        }
        body = (fallback.data?.body as string | null) ?? null;
      } else {
        body = (data as string | null) ?? null;
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "prompt_config.fetch_failed", { key, detail });
      throw new ProviderError({
        code: "provider_unknown_error",
        retryable: true,
        message: `prompt config fetch failed for key ${key}`,
        cause: error,
      });
    }

    if (!body || body.trim().length === 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: `prompt config missing active row for key ${key}`,
      });
    }

    return body;
  }

  // Admin helpers (upsert/activate/list) - thin wrappers over RPCs.
  async upsertPersona(body: string, actor?: string | null): Promise<string> {
    return this.upsert(PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA, body, actor);
  }

  async upsert(key: string, body: string, actor?: string | null): Promise<string> {
    const trimmedKey = key?.trim();
    const trimmedBody = body?.trim();
    if (!trimmedKey) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "prompt config key must be non-empty",
      });
    }
    if (!trimmedBody) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "prompt config body must be non-empty",
      });
    }
    if (trimmedBody.length > 8000) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "prompt config body exceeds 8000 characters",
      });
    }
    const supabase: any = getSupabaseAdmin() as any;
    const { data, error } = await supabase.rpc("upsert_prompt_config", {
      p_key: trimmedKey,
      p_body: trimmedBody,
      p_actor: actor ?? null,
    } as never);
    if (error) {
      throw new ProviderError({
        code: "provider_unknown_error",
        retryable: false,
        message: `prompt config upsert failed for key ${trimmedKey}`,
        cause: error,
      });
    }
    resetPromptConfigCache();
    return data as string;
  }

  async activatePersona(version: number, actor?: string | null): Promise<string> {
    return this.activate(PROMPT_CONFIG_KEY_ENHANCEMENT_PERSONA, version, actor);
  }

  async activate(key: string, version: number, actor?: string | null): Promise<string> {
    const supabase: any = getSupabaseAdmin() as any;
    const { data, error } = await supabase.rpc("activate_prompt_config", {
      p_key: key,
      p_version: version,
      p_actor: actor ?? null,
    } as never);
    if (error) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: `prompt config activate failed for key ${key} version ${version}: ${(error as { message?: string })?.message ?? String(error)}`,
        cause: error,
      });
    }
    resetPromptConfigCache();
    return data as string;
  }

  async list(key?: string): Promise<
    Array<{
      id: string;
      key: string;
      body: string;
      version: number;
      is_active: boolean;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    }>
  > {
    const supabase: any = getSupabaseAdmin() as any;
    let q = supabase
      .from("prompt_configs")
      .select("id, key, body, version, is_active, created_by, created_at, updated_at")
      .order("key", { ascending: true })
      .order("version", { ascending: false });
    if (key) q = q.eq("key", key);
    const { data, error } = await q;
    if (error) throw new Error(`prompt config list failed: ${error.message}`);
    return (data ?? []) as Array<{
      id: string;
      key: string;
      body: string;
      version: number;
      is_active: boolean;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    }>;
  }

  async listAudit(
    key?: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      key: string;
      version: number;
      action: string;
      old_body: string | null;
      new_body: string | null;
      actor: string | null;
      created_at: string;
    }>
  > {
    const supabase: any = getSupabaseAdmin() as any;
    let q = supabase
      .from("prompt_configs_audit")
      .select("id, key, version, action, old_body, new_body, actor, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (key) q = q.eq("key", key);
    const { data, error } = await q;
    if (error) throw new Error(`prompt config audit list failed: ${error.message}`);
    return (data ?? []) as Array<{
      id: string;
      key: string;
      version: number;
      action: string;
      old_body: string | null;
      new_body: string | null;
      actor: string | null;
      created_at: string;
    }>;
  }
}
