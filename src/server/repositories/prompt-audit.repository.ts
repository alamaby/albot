// Server-only prompt audit repository.
// Captures per-stage prompt + provider_used for cross-purge audit. Inserts
// are best-effort: a failure here must never block the underlying job.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";
import { logStructured } from "@/server/observability/logger";
import type { Database } from "@/server/supabase/database.types";

export type PromptAuditStage = "enhance_input" | "enhance_output" | "generate_input";

export type PromptAuditRecord = {
  sessionId?: string | null;
  revisionId?: string | null;
  attemptId?: string | null;
  telegramUserId: bigint;
  telegramChatId: bigint;
  telegramMessageId?: number | null;
  stage: PromptAuditStage;
  sourcePrompt?: string | null;
  previousPrompt?: string | null;
  revisionInstruction?: string | null;
  enhancedPrompt?: string | null;
  imagePrompt?: string | null;
  providerConfigId?: string | null;
  providerRequestId?: string | null;
  model?: string | null;
  status: "ok" | "failed";
  errorCode?: string | null;
};

type PromptAuditRow = Database["public"]["Tables"]["prompt_audit"]["Row"];

export class PromptAuditRepository {
  // Best-effort insert. Never throws — failures are logged and the caller
  // continues without blocking the job lifecycle.
  async insert(record: PromptAuditRecord): Promise<void> {
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("prompt_audit").insert({
        session_id: record.sessionId ?? null,
        revision_id: record.revisionId ?? null,
        attempt_id: record.attemptId ?? null,
        telegram_user_id: bigintToDb(record.telegramUserId),
        telegram_chat_id: bigintToDb(record.telegramChatId),
        telegram_message_id: record.telegramMessageId ?? null,
        stage: record.stage,
        source_prompt: record.sourcePrompt ?? null,
        previous_prompt: record.previousPrompt ?? null,
        revision_instruction: record.revisionInstruction ?? null,
        enhanced_prompt: record.enhancedPrompt ?? null,
        image_prompt: record.imagePrompt ?? null,
        provider_config_id: record.providerConfigId ?? null,
        provider_request_id: record.providerRequestId ?? null,
        model: record.model ?? null,
        status: record.status,
        error_code: record.errorCode ?? null,
      } as Database["public"]["Tables"]["prompt_audit"]["Insert"]);
      if (error) {
        logStructured("warn", "prompt_audit.insert_failed", { error: error.message });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : "unknown";
      logStructured("warn", "prompt_audit.insert_failed", { detail });
    }
  }

  async query(opts: {
    telegramUserId?: bigint;
    sessionId?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  }): Promise<PromptAuditRow[]> {
    const supabase = getSupabaseAdmin();
    let q = supabase
      .from("prompt_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(opts.limit ?? 100, 500))
      .range(opts.offset ?? 0, (opts.offset ?? 0) + (Math.min(opts.limit ?? 100, 500) - 1));
    if (opts.telegramUserId !== undefined) {
      q = q.eq("telegram_user_id", bigintToDb(opts.telegramUserId));
    }
    if (opts.sessionId) {
      q = q.eq("session_id", opts.sessionId);
    }
    if (opts.since) {
      q = q.gte("created_at", opts.since);
    }
    if (opts.until) {
      q = q.lt("created_at", opts.until);
    }
    const { data, error } = await q;
    if (error) throw new Error(`prompt audit query failed: ${error.message}`);
    return data ?? [];
  }
}
