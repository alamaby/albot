// Callback state machine (Milestone 4).
//
// Executed inline from the webhook after the callback_events row is persisted
// (deduped by unique callback_query_id). Handles the confirmation actions
// generate / revise / cancel with session ownership and expiry checks. No
// provider call happens here: generate only enqueues a job for Milestone 5.

import { getServerEnv } from "@/env";
import { bigintToDb } from "./bigint-helper";
import { SessionRepository, type SessionSafe } from "@/server/repositories/session.repository";
import { JobRepository } from "@/server/repositories/job.repository";
import { isSessionExpired } from "./session-expiry-check";

export type CallbackAction = "generate" | "revise" | "cancel";

export type CallbackOutcome =
  | { status: "accepted" }
  | { status: "rejected_owner" }
  | { status: "rejected_expired" }
  | { status: "rejected_state" }
  | { status: "duplicate" }
  | { status: "unknown" };

export type CallbackStateMachineDeps = {
  sessionRepository?: SessionRepository;
  jobRepository?: JobRepository;
  sendTelegramMessage?: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  answerCallbackQuery?: (
    token: string,
    callbackQueryId: string,
    options?: { text?: string; showAlert?: boolean },
  ) => Promise<unknown>;
};

export class CallbackStateMachine {
  private readonly sessionRepository: SessionRepository;
  private readonly jobRepository: JobRepository;
  private readonly sendTelegramMessage: (
    token: string,
    chatId: bigint,
    text: string,
  ) => Promise<unknown>;
  private readonly answerCallbackQuery: (
    token: string,
    callbackQueryId: string,
    options?: { text?: string; showAlert?: boolean },
  ) => Promise<unknown>;

  constructor(deps: CallbackStateMachineDeps = {}) {
    this.sessionRepository = deps.sessionRepository ?? new SessionRepository();
    this.jobRepository = deps.jobRepository ?? new JobRepository();
    this.sendTelegramMessage =
      deps.sendTelegramMessage ??
      (async () => {
        throw new Error("sendTelegramMessage not wired");
      });
    this.answerCallbackQuery =
      deps.answerCallbackQuery ??
      (async () => {
        throw new Error("answerCallbackQuery not wired");
      });
  }

  async handle(input: {
    action: CallbackAction;
    sessionId: string;
    session: SessionSafe;
    telegramUserId: bigint;
    callbackQueryId: string;
  }): Promise<CallbackOutcome> {
    const env = getServerEnv();
    const { action, session, telegramUserId, callbackQueryId } = input;

    if (session.telegramUserId !== telegramUserId) {
      return { status: "rejected_owner" };
    }

    if (isSessionExpired(session)) {
      return { status: "rejected_expired" };
    }

    switch (action) {
      case "generate":
        return this.handleGenerate(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "revise":
        return this.handleRevise(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "cancel":
        return this.handleCancel(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      default:
        return { status: "unknown" };
    }
  }

  private async handleGenerate(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    if (input.session.status !== "awaiting_confirmation") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    const revisionId = input.session.activeRevisionId;
    if (!revisionId) {
      await this.ack(token, callbackQueryId, "Belum ada revisi aktif.");
      return { status: "rejected_state" };
    }

    await this.jobRepository.insertGenerateImageJob({
      sessionId: input.sessionId,
      revisionId,
      payload: {
        telegram_user_id: bigintToDb(input.session.telegramUserId),
        telegram_chat_id: bigintToDb(input.session.telegramChatId),
        origin: "callback_generate",
      },
    });

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: "awaiting_confirmation",
        p_new_status: "generating",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    await this.ack(token, callbackQueryId, "Mulai membuat gambar...");
    return { status: "accepted" };
  }

  private async handleRevise(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    if (input.session.status !== "awaiting_confirmation") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: "awaiting_confirmation",
        p_new_status: "awaiting_revision_input",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    await this.ack(token, callbackQueryId, "Silakan kirim instruksi revisi.");
    try {
      await this.sendTelegramMessage(
        token,
        input.session.telegramChatId,
        "Kirim instruksi revisi Anda. Contoh: buat lebih terang, tambah awan, ubah warna.",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`callback: telegram sendMessage failed (${detail})`);
    }
    return { status: "accepted" };
  }

  private async handleCancel(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    if (input.session.status !== "awaiting_confirmation") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: "awaiting_confirmation",
        p_new_status: "cancelled",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    await this.ack(token, callbackQueryId, "Sesi dibatalkan.");
    try {
      await this.sendTelegramMessage(token, input.session.telegramChatId, "Sesi dibatalkan.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`callback: telegram sendMessage failed (${detail})`);
    }
    return { status: "accepted" };
  }

  private async ack(token: string, callbackQueryId: string, text: string): Promise<void> {
    try {
      await this.answerCallbackQuery(token, callbackQueryId, { text });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`callback: answerCallbackQuery failed (${detail})`);
    }
  }
}
