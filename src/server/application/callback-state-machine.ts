// Callback state machine (Milestone 4 + Milestone 5).
//
// Executed inline from the webhook after the callback_events row is persisted
// (deduped by unique callback_query_id). Handles the confirmation actions
// generate / revise / cancel and the post-result actions regenerate / revise /
// complete with session ownership and expiry checks. No provider call happens
// here: generate and regenerate only enqueue a durable job.

import { getServerEnv } from "@/env";
import { bigintToDb } from "./bigint-helper";
import { SessionRepository, type SessionSafe } from "@/server/repositories/session.repository";
import { JobRepository } from "@/server/repositories/job.repository";
import { isSessionExpired } from "./session-expiry-check";

export type CallbackAction = "generate" | "revise" | "cancel" | "regenerate" | "complete";

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
  completeSession?: (sessionId: string) => Promise<void>;
  dispatchToProcessor?: (
    origin: string,
    secret: string,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>;
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
  private readonly completeSession: (sessionId: string) => Promise<void>;
  private readonly dispatchToProcessor: (
    origin: string,
    secret: string,
    payload?: Record<string, unknown>,
  ) => Promise<unknown>;
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
    this.completeSession =
      deps.completeSession ??
      (async (sessionId) => {
        const { GenerationRepository } =
          await import("@/server/repositories/generation.repository");
        await new GenerationRepository().completeSession(sessionId);
      });
    this.dispatchToProcessor =
      deps.dispatchToProcessor ??
      (async () => {
        throw new Error("dispatchToProcessor not wired");
      });
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
    origin: string;
  }): Promise<CallbackOutcome> {
    const env = getServerEnv();
    const { action, session, telegramUserId, callbackQueryId, origin } = input;

    if (session.telegramUserId !== telegramUserId) {
      return { status: "rejected_owner" };
    }

    if (isSessionExpired(session)) {
      return { status: "rejected_expired" };
    }

    switch (action) {
      case "generate":
        return this.handleGenerate(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId, origin);
      case "regenerate":
        return this.handleRegenerate(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId, origin);
      case "revise":
        return this.handleRevise(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "cancel":
        return this.handleCancel(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "complete":
        return this.handleComplete(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      default:
        return { status: "unknown" };
    }
  }

  // Shared for initial Generate (awaiting_confirmation), Regenerate
  // (result_ready), and retry-after-failure (generation_failed): transition the
  // session to generating (CAS), enqueue the generate_image job, and dispatch
  // the processor. Transition first so a job can never run before the session
  // is in generating.
  private async enqueueGeneration(
    input: { sessionId: string; session: SessionSafe },
    expectedStatus: "awaiting_confirmation" | "result_ready" | "generation_failed",
    origin: string,
    ackText: string,
    token: string,
    callbackQueryId: string,
    webhookOrigin: string,
  ): Promise<CallbackOutcome> {
    if (input.session.status !== expectedStatus) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    const revisionId = input.session.activeRevisionId;
    if (!revisionId) {
      await this.ack(token, callbackQueryId, "Belum ada revisi aktif.");
      return { status: "rejected_state" };
    }

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: expectedStatus,
        p_new_status: "generating",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    try {
      await this.jobRepository.insertGenerateImageJob({
        sessionId: input.sessionId,
        revisionId,
        payload: {
          telegram_user_id: bigintToDb(input.session.telegramUserId),
          telegram_chat_id: bigintToDb(input.session.telegramChatId),
          origin,
        },
      });
    } catch (error) {
      // Roll the session back so a failed enqueue does not strand it in
      // generating with no job.
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`callback: generate job insert failed (${detail})`);
      try {
        const { data: rollback } = await supabase
          .rpc("transition_prompt_session", {
            p_session_id: input.sessionId,
            p_expected_status: "generating",
            p_new_status: expectedStatus,
          } as never)
          .maybeSingle();
        if (!rollback) {
          console.error("callback: generate job rollback transition failed");
        }
      } catch (rollbackError) {
        const rbDetail = rollbackError instanceof Error ? rollbackError.message : "unknown";
        console.error(`callback: generate job rollback failed (${rbDetail})`);
      }
      await this.ack(token, callbackQueryId, "Gagal mengirim permintaan. Coba lagi.");
      return { status: "rejected_state" };
    }

    // Best-effort dispatch: the durable job row remains claimable by a later
    // webhook or recovery poll even when this call fails.
    try {
      await this.dispatchToProcessor(webhookOrigin, getServerEnv().JOB_PROCESSOR_SECRET, {
        sessionOrigin: origin,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`callback: dispatcher failed (${detail})`);
    }

    await this.ack(token, callbackQueryId, ackText);
    return { status: "accepted" };
  }

  private async handleGenerate(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
    webhookOrigin: string,
  ): Promise<CallbackOutcome> {
    // Generate is available from awaiting_confirmation (initial) and from
    // generation_failed (retry after a terminal failure).
    const expectedStatus =
      input.session.status === "generation_failed" ? "generation_failed" : "awaiting_confirmation";
    if (
      input.session.status !== "awaiting_confirmation" &&
      input.session.status !== "generation_failed"
    ) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }
    return this.enqueueGeneration(
      input,
      expectedStatus,
      "callback_generate",
      "Mulai membuat gambar...",
      token,
      callbackQueryId,
      webhookOrigin,
    );
  }

  private async handleRegenerate(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
    webhookOrigin: string,
  ): Promise<CallbackOutcome> {
    return this.enqueueGeneration(
      input,
      "result_ready",
      "callback_regenerate",
      "Mulai membuat gambar lagi...",
      token,
      callbackQueryId,
      webhookOrigin,
    );
  }

  private async handleRevise(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    // Revise is available before generation (awaiting_confirmation), after a
    // result (result_ready), and after a failed generation
    // (generation_failed). The source status decides the expected CAS state.
    const expectedStatus = input.session.status as
      "awaiting_confirmation" | "result_ready" | "generation_failed";
    if (
      input.session.status !== "awaiting_confirmation" &&
      input.session.status !== "result_ready" &&
      input.session.status !== "generation_failed"
    ) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: expectedStatus,
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

  private async handleComplete(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    if (input.session.status !== "result_ready") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    try {
      await this.completeSession(input.sessionId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.error(`callback: completeSession failed (${detail})`);
      await this.ack(token, callbackQueryId, "Gagal menyelesaikan sesi. Coba lagi.");
      return { status: "rejected_state" };
    }

    await this.ack(token, callbackQueryId, "Sesi selesai.");
    try {
      await this.sendTelegramMessage(
        token,
        input.session.telegramChatId,
        "Sesi selesai. Terima kasih sudah menggunakan bot ini!",
      );
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
