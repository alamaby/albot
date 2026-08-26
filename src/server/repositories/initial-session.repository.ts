// Server-only initial session repository.
// Wraps the create_initial_session RPC which atomically creates the first
// prompt_session, the first prompt_revision, and the enhancement job.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import { bigintToDb } from "@/server/application/bigint-helper";
import type { Database } from "@/server/supabase/database.types";

export type CreateInitialSessionInput = {
  telegramUserId: bigint;
  telegramChatId: bigint;
  sourcePrompt: string;
  updateId: bigint;
  // Direct-generation mode (/generate-image): when set, the RPC marks the
  // revision completed with this prompt, starts the session in `generating`,
  // and enqueues a generate_image job instead of an enhancement job.
  enhancedPrompt?: string;
};

export type CreateInitialSessionResult = {
  sessionId: string;
  revisionId: string;
  jobId: string;
};

// Telegram ids are 64-bit and must not pass through JS Number. PostgREST
// accepts decimal strings for bigint columns; the generated types model them
// as number, so the args are explicitly widened.
type InitialSessionRpcArgs = Database["public"]["Functions"]["create_initial_session"]["Args"];

export class InitialSessionRepository {
  async create(input: CreateInitialSessionInput): Promise<CreateInitialSessionResult> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("create_initial_session", {
        p_telegram_user_id: bigintToDb(input.telegramUserId),
        p_telegram_chat_id: bigintToDb(input.telegramChatId),
        p_source_prompt: input.sourcePrompt,
        p_update_id: bigintToDb(input.updateId),
        p_job_type: "enhance_prompt",
        p_enhanced_prompt: input.enhancedPrompt ?? null,
      } as unknown as InitialSessionRpcArgs)
      .single();

    if (error) throw new Error(`create_initial_session failed: ${error.message}`);
    return {
      sessionId: data.session_id,
      revisionId: data.revision_id,
      jobId: data.job_id,
    };
  }
}
