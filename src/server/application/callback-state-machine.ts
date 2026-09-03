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
import { logStructured } from "@/server/observability/logger";
import { buildGenerationStatusMessage } from "@/server/telegram/messages";
import {
  ADAPTER_TO_MODEL_CODE,
  MODEL_CODE_TO_ADAPTER,
  MODEL_CODE_LABEL,
  REASONING_CODE_TO_ADAPTER,
  REASONING_CODE_LABEL,
  REASONING_ADAPTER_TO_CODE,
  type ModelShortCode,
  type ReasoningShortCode,
} from "@/server/telegram/keyboards";

export type CallbackAction =
  | "generate"
  | "revise"
  | "cancel"
  | "regenerate"
  | "complete"
  | "retry"
  | "model_picker"
  | "model_picked"
  | "model_picked_default"
  | "model_picker_back"
  | "reasoning_picker"
  | "reasoning_picked"
  | "reasoning_default"
  | "reasoning_picker_back";

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
  // Persists the Telegram message id of the generation status message so the
  // job worker can edit it to the final outcome. Defaults to the real
  // SessionRepository; injected in tests.
  saveStatusMessageId?: (sessionId: string, messageId: number) => Promise<void>;
  // Model picker deps (lazy injected to avoid circular)
  providerConfigRepository?: {
    getById(id: string): Promise<unknown>;
    listActive(cap: string): Promise<unknown[]>;
  };
  userImagePreferenceRepository?: {
    upsert(telegramUserId: bigint, preferredProviderConfigId: string): Promise<unknown>;
  };
  userReasoningPreferenceRepository?: {
    upsert(telegramUserId: bigint, preferredProviderConfigId: string): Promise<unknown>;
  };
  sendMessageWithKeyboard?: (
    token: string,
    chatId: bigint,
    text: string,
    keyboard: { inline_keyboard: { text: string; callback_data: string }[][] },
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
  private readonly saveStatusMessageId: (sessionId: string, messageId: number) => Promise<void>;
  private readonly providerConfigRepository: CallbackStateMachineDeps["providerConfigRepository"];
  private readonly userImagePreferenceRepository: CallbackStateMachineDeps["userImagePreferenceRepository"];
  private readonly userReasoningPreferenceRepository: CallbackStateMachineDeps["userReasoningPreferenceRepository"];
  private readonly sendMessageWithKeyboard: CallbackStateMachineDeps["sendMessageWithKeyboard"];

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
    this.saveStatusMessageId =
      deps.saveStatusMessageId ??
      (async (sessionId, messageId) => {
        await this.sessionRepository.saveStatusMessageId(sessionId, messageId);
      });
    this.providerConfigRepository = deps.providerConfigRepository;
    this.userImagePreferenceRepository = deps.userImagePreferenceRepository;
    this.userReasoningPreferenceRepository = deps.userReasoningPreferenceRepository;
    this.sendMessageWithKeyboard = deps.sendMessageWithKeyboard;
  }

  async handle(input: {
    action: CallbackAction;
    sessionId: string;
    session: SessionSafe;
    telegramUserId: bigint;
    callbackQueryId: string;
    origin: string;
    rawData?: string;
  }): Promise<CallbackOutcome> {
    const env = getServerEnv();
    const { action, session, telegramUserId, callbackQueryId, origin } = input;

    if (session.telegramUserId !== telegramUserId) {
      return { status: "rejected_owner" };
    }

    if (isSessionExpired(session)) {
      // Tell the user the session ended instead of silently rejecting; without
      // this the callback loading indicator just stops with no feedback.
      await this.ack(
        env.TELEGRAM_BOT_TOKEN,
        callbackQueryId,
        "Sesi telah berakhir. Kirim prompt baru.",
      );
      return { status: "rejected_expired" };
    }

    const rawData = input.rawData;
    if (rawData) {
      const parsed = await this.handleModelPickerRaw(
        input,
        rawData,
        env.TELEGRAM_BOT_TOKEN,
        callbackQueryId,
      );
      if (parsed) return parsed;
      const parsedReasoning = await this.handleReasoningPickerRaw(
        input,
        rawData,
        env.TELEGRAM_BOT_TOKEN,
        callbackQueryId,
      );
      if (parsedReasoning) return parsedReasoning;
    }
    if (rawData && rawData.length > 64) {
      logStructured("warn", "callback.data_too_long", { sessionId: input.sessionId });
      return { status: "rejected_state" };
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
      case "retry":
        return this.handleRetry(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId, origin);
      case "model_picker":
        return this.handleModelPicker(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "model_picker_back":
        return this.handleModelPickerBack(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "model_picked":
        return this.handleModelPicked(
          input,
          env.TELEGRAM_BOT_TOKEN,
          callbackQueryId,
          false,
          undefined,
        );
      case "model_picked_default":
        return this.handleModelPicked(
          input,
          env.TELEGRAM_BOT_TOKEN,
          callbackQueryId,
          true,
          undefined,
        );
      case "reasoning_picker":
        return this.handleReasoningPicker(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "reasoning_picker_back":
        return this.handleReasoningPickerBack(input, env.TELEGRAM_BOT_TOKEN, callbackQueryId);
      case "reasoning_picked":
        return this.handleReasoningPicked(
          input,
          env.TELEGRAM_BOT_TOKEN,
          callbackQueryId,
          false,
          undefined,
        );
      case "reasoning_default":
        return this.handleReasoningPicked(
          input,
          env.TELEGRAM_BOT_TOKEN,
          callbackQueryId,
          true,
          undefined,
        );
      default:
        logStructured("warn", "callback.unknown_action", { action, sessionId: input.sessionId });
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
      logStructured("error", "callback.generate_job_insert_failed", {
        sessionId: input.sessionId,
        detail,
      });
      try {
        const { data: rollback } = await supabase
          .rpc("transition_prompt_session", {
            p_session_id: input.sessionId,
            p_expected_status: "generating",
            p_new_status: expectedStatus,
          } as never)
          .maybeSingle();
        if (!rollback) {
          logStructured("error", "callback.generate_rollback_transition_failed", {
            sessionId: input.sessionId,
          });
        }
      } catch (rollbackError) {
        const rbDetail = rollbackError instanceof Error ? rollbackError.message : "unknown";
        logStructured("error", "callback.generate_rollback_failed", {
          sessionId: input.sessionId,
          detail: rbDetail,
        });
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
      logStructured("error", "callback.dispatcher_failed", { sessionId: input.sessionId, detail });
    }

    // Persist a status message the user can see while the job runs; the worker
    // edits it to the final outcome. Best-effort: a failure here must not
    // reject an accepted generation.
    try {
      const result = await this.sendTelegramMessage(
        token,
        input.session.telegramChatId,
        buildGenerationStatusMessage("generating"),
      );
      const messageId = extractMessageId(result);
      if (messageId !== null) {
        await this.saveStatusMessageId(input.sessionId, messageId);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.status_message_failed", {
        sessionId: input.sessionId,
        detail,
      });
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
    if (input.session.status === "generation_failed") {
      await this.cleanupStuckProcessingAttempt(input.sessionId);
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
    // Regenerate is now allowed from both result_ready (normal) and
    // generation_failed (retry after terminal failure) — see plan
    // 2026-08-27-regenerate-after-failure-toast-fix.
    if (input.session.status !== "result_ready" && input.session.status !== "generation_failed") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }
    // Best-effort: clean stuck `processing` attempt that blocks
    // create_generation_attempt (guard queued|processing). This handles the
    // prod stuck case 559f8439 where the job failed but the attempt was never
    // marked failed.
    if (input.session.status === "generation_failed") {
      await this.cleanupStuckProcessingAttempt(input.sessionId);
    }
    const expectedStatus =
      input.session.status === "generation_failed" ? "generation_failed" : "result_ready";
    return this.enqueueGeneration(
      input,
      expectedStatus as "result_ready" | "generation_failed",
      "callback_regenerate",
      "Mulai membuat gambar lagi...",
      token,
      callbackQueryId,
      webhookOrigin,
    );
  }

  // Best-effort: mark any `processing` attempt for the session as failed
  // so a retried generation can create a fresh attempt. Uses the guarded RPC
  // (service_role, security definer) — safe to call even when no stuck row.
  private async cleanupStuckProcessingAttempt(sessionId: string): Promise<void> {
    try {
      const { getSupabaseAdmin } = await import("@/server/supabase/admin");
      const supabase = getSupabaseAdmin();
      const { data: stuck } = await supabase
        .from("generation_attempts")
        .select("id")
        .eq("session_id", sessionId)
        .eq("status", "processing")
        .limit(1)
        .maybeSingle();
      if (stuck && (stuck as { id: string }).id) {
        const attemptId = (stuck as { id: string }).id;
        const { error } = await supabase.rpc("mark_generation_attempt_failed", {
          p_attempt_id: attemptId,
          p_error_code: "stuck_processing_cleanup",
          p_error_message_redacted: "cleanup before retry from generation_failed",
        } as never);
        if (error) {
          logStructured("warn", "callback.cleanup_stuck_attempt_failed", {
            sessionId,
            attemptId,
            detail: error.message,
          });
        } else {
          logStructured("info", "callback.cleanup_stuck_attempt", { sessionId, attemptId });
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "callback.cleanup_stuck_attempt_error", { sessionId, detail });
    }
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
      logStructured("error", "callback.send_message_failed", {
        sessionId: input.sessionId,
        detail,
      });
    }
    return { status: "accepted" };
  }

  private async handleCancel(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    // Cancel is available from awaiting_confirmation (normal) and from the
    // terminal failure states enhancement_failed/generation_failed — the
    // "Prompt Baru" button on a failed session discards it so a new prompt can
    // start (content-policy refusals cannot be resolved by retrying the same
    // input).
    const allowed =
      input.session.status === "awaiting_confirmation" ||
      input.session.status === "enhancement_failed" ||
      input.session.status === "generation_failed";
    if (!allowed) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    const { getSupabaseAdmin } = await import("@/server/supabase/admin");
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: input.session.status,
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
      await this.sendTelegramMessage(
        token,
        input.session.telegramChatId,
        "Sesi dibatalkan. Kirim prompt baru untuk membuat gambar.",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.send_message_failed", {
        sessionId: input.sessionId,
        detail,
      });
    }
    return { status: "accepted" };
  }

  private async handleComplete(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    // Complete is allowed from result_ready (normal) and generation_failed
    // (user decision #1 — close session without image).
    if (input.session.status !== "result_ready" && input.session.status !== "generation_failed") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    // generation_failed → completed is a terminal transition; result_ready
    // uses the dedicated completeSession RPC (which validates terminal guard).
    if (input.session.status === "generation_failed") {
      const { getSupabaseAdmin } = await import("@/server/supabase/admin");
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .rpc("transition_prompt_session", {
          p_session_id: input.sessionId,
          p_expected_status: "generation_failed",
          p_new_status: "completed",
        } as never)
        .maybeSingle();
      if (error) throw new Error(`session transition failed: ${error.message}`);
      if (!data) {
        await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
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
        logStructured("error", "callback.send_message_failed", {
          sessionId: input.sessionId,
          detail,
        });
      }
      return { status: "accepted" };
    }

    try {
      await this.completeSession(input.sessionId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.complete_failed", { sessionId: input.sessionId, detail });
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
      logStructured("error", "callback.send_message_failed", {
        sessionId: input.sessionId,
        detail,
      });
    }
    return { status: "accepted" };
  }

  // Enhancement retry after a terminal failure (enhancement_failed): CAS back
  // to enhancing, enqueue a fresh enhance_prompt job for the same revision, and
  // dispatch the processor. Mirrors enqueueGeneration but for the enhancement
  // job type.
  private async handleRetry(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
    origin: string,
  ): Promise<CallbackOutcome> {
    if (input.session.status !== "enhancement_failed") {
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

    // Prevent double-active: if the user already started a new session after
    // this failure, retrying the old failed session would create a second
    // active session and violate prompt_sessions_one_active_idx.
    {
      const { count, error: activeError } = await supabase
        .from("prompt_sessions")
        .select("id", { count: "exact", head: true })
        .eq("telegram_user_id", bigintToDb(input.session.telegramUserId))
        .not(
          "status",
          "in",
          '("completed","cancelled","expired","enhancement_failed","generation_failed")',
        )
        .gt("expires_at", new Date().toISOString())
        .neq("id", input.sessionId);
      if (activeError) throw new Error(`active session check failed: ${activeError.message}`);
      if ((count ?? 0) > 0) {
        await this.ack(
          token,
          callbackQueryId,
          "Masih ada sesi aktif. Selesaikan atau batalkan sesi baru terlebih dahulu.",
        );
        return { status: "rejected_state" };
      }
    }

    const { data, error } = await supabase
      .rpc("transition_prompt_session", {
        p_session_id: input.sessionId,
        p_expected_status: "enhancement_failed",
        p_new_status: "enhancing",
      } as never)
      .maybeSingle();
    if (error) throw new Error(`session transition failed: ${error.message}`);
    if (!data) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }

    try {
      await this.jobRepository.insertEnhancementJob({
        sessionId: input.sessionId,
        revisionId,
        payload: {
          telegram_user_id: bigintToDb(input.session.telegramUserId),
          telegram_chat_id: bigintToDb(input.session.telegramChatId),
          origin: "callback_retry",
        },
      });
    } catch (error) {
      // Roll the session back so a failed enqueue does not strand it in
      // enhancing with no job.
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.retry_job_insert_failed", {
        sessionId: input.sessionId,
        detail,
      });
      try {
        const { data: rollback } = await supabase
          .rpc("transition_prompt_session", {
            p_session_id: input.sessionId,
            p_expected_status: "enhancing",
            p_new_status: "enhancement_failed",
          } as never)
          .maybeSingle();
        if (!rollback) {
          logStructured("error", "callback.retry_rollback_transition_failed", {
            sessionId: input.sessionId,
          });
        }
      } catch (rollbackError) {
        const rbDetail = rollbackError instanceof Error ? rollbackError.message : "unknown";
        logStructured("error", "callback.retry_rollback_failed", {
          sessionId: input.sessionId,
          detail: rbDetail,
        });
      }
      await this.ack(token, callbackQueryId, "Gagal mengirim permintaan. Coba lagi.");
      return { status: "rejected_state" };
    }

    // Best-effort dispatch: the durable job row remains claimable by a later
    // webhook or recovery poll even when this call fails.
    try {
      await this.dispatchToProcessor(origin, getServerEnv().JOB_PROCESSOR_SECRET, {
        sessionOrigin: "callback_retry",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.dispatcher_failed", { sessionId: input.sessionId, detail });
    }

    // Tell the user the enhancement is running again. Best-effort: a failure
    // here must not reject an accepted retry.
    try {
      await this.sendTelegramMessage(
        token,
        input.session.telegramChatId,
        "Sedang memproses ulang prompt, mohon tunggu...",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.send_message_failed", {
        sessionId: input.sessionId,
        detail,
      });
    }

    await this.ack(token, callbackQueryId, "Mencoba lagi...");
    return { status: "accepted" };
  }

  // ---- Model picker (hybrid) ----

  private async handleModelPickerRaw(
    input: {
      sessionId: string;
      session: SessionSafe;
      telegramUserId: bigint;
      callbackQueryId: string;
    },
    rawData: string,
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome | null> {
    const { parseModelPickerData } = await import("@/server/telegram/keyboards");
    const parsed = parseModelPickerData(rawData);
    if (!parsed) return null;
    if (parsed.action === "model_picker")
      return this.handleModelPicker(input as never, token, callbackQueryId);
    if (parsed.action === "model_picker_back")
      return this.handleModelPickerBack(input as never, token, callbackQueryId);
    if (parsed.action === "model_picked")
      return this.handleModelPicked(input as never, token, callbackQueryId, false, parsed.code);
    if (parsed.action === "model_picked_default")
      return this.handleModelPicked(input as never, token, callbackQueryId, true, parsed.code);
    return null;
  }

  private async handleModelPicker(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    if (
      input.session.status !== "awaiting_confirmation" &&
      input.session.status !== "result_ready" &&
      input.session.status !== "generation_failed"
    ) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }
    const selected = await this.resolveSelectedCode(input.session);
    try {
      const { modelPickerKeyboard } = await import("@/server/telegram/keyboards");
      const { buildModelPickerMessage } = await import("@/server/telegram/messages");
      const label = selected ? MODEL_CODE_LABEL[selected] : null;
      const keyboard = modelPickerKeyboard(input.session.id, selected);
      if (this.sendMessageWithKeyboard) {
        await this.sendMessageWithKeyboard(
          token,
          input.session.telegramChatId,
          buildModelPickerMessage(label),
          keyboard,
        );
      } else {
        const { sendMessageWithKeyboard } = await import("@/server/telegram/client");
        await sendMessageWithKeyboard(
          token,
          input.session.telegramChatId,
          buildModelPickerMessage(label),
          keyboard,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.model_picker_send_failed", {
        sessionId: input.session.id,
        detail,
      });
    }
    await this.ack(token, callbackQueryId, "Pilih model");
    return { status: "accepted" };
  }

  private async handleModelPickerBack(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    return this.reshowContextWithPickers(input, token, callbackQueryId, "Kembali");
  }

  // Re-show the confirmation or result context with BOTH picker rows (image +
  // reasoning) so the user returns to the same context they left.
  private async reshowContextWithPickers(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
    ackText: string,
  ): Promise<CallbackOutcome> {
    const selected = await this.resolveSelectedCode(input.session);
    const reasoningCode = await this.resolveSelectedReasoningCode(input.session);
    try {
      const { confirmationKeyboardWithModel, resultKeyboardWithModel } =
        await import("@/server/telegram/keyboards");
      const { buildEnhancedPromptMessage } = await import("@/server/telegram/messages");
      const { EnhancementRepository } =
        await import("@/server/repositories/enhancement.repository");
      const repo = new EnhancementRepository();
      const rev = input.session.activeRevisionId
        ? await repo.getRevisionById(input.session.activeRevisionId)
        : null;
      const label = selected ? MODEL_CODE_LABEL[selected] : null;
      const text = rev?.enhancedPrompt
        ? buildEnhancedPromptMessage({
            enhancedPrompt: rev.enhancedPrompt,
            revisionNumber: rev.revisionNumber ?? 1,
            sourcePrompt: rev.sourcePrompt ?? "",
            selectedModelLabel: label,
          })
        : label
          ? `Model terpilih: ${label} ✓`
          : "Pilih aksi untuk melanjutkan.";
      const keyboard =
        input.session.status === "result_ready"
          ? resultKeyboardWithModel(input.session.id, selected, reasoningCode)
          : confirmationKeyboardWithModel(input.session.id, selected, reasoningCode);
      if (this.sendMessageWithKeyboard) {
        await this.sendMessageWithKeyboard(token, input.session.telegramChatId, text, keyboard);
      } else {
        const { sendMessageWithKeyboard } = await import("@/server/telegram/client");
        await sendMessageWithKeyboard(token, input.session.telegramChatId, text, keyboard);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.model_picker_back_failed", {
        sessionId: input.session.id,
        detail,
      });
    }
    await this.ack(token, callbackQueryId, ackText);
    return { status: "accepted" };
  }

  private async handleModelPicked(
    input: { sessionId: string; session: SessionSafe; telegramUserId: bigint },
    token: string,
    callbackQueryId: string,
    asDefault: boolean,
    code?: ModelShortCode,
  ): Promise<CallbackOutcome> {
    if (
      input.session.status !== "awaiting_confirmation" &&
      input.session.status !== "result_ready" &&
      input.session.status !== "generation_failed"
    ) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }
    if (!code) {
      await this.ack(token, callbackQueryId, "Model tidak valid.");
      return { status: "rejected_state" };
    }
    const adapterType = MODEL_CODE_TO_ADAPTER[code];
    try {
      // Resolve provider config by adapter_type among active configs
      const { ProviderConfigRepository } =
        await import("@/server/repositories/provider-config.repository");
      const repo = this.providerConfigRepository as unknown as
        InstanceType<typeof ProviderConfigRepository> | undefined;
      const cfgRepo = repo ?? new ProviderConfigRepository();
      const configs = await cfgRepo.listActive("image_generation");
      const matched = configs.find((c) => c.adapterType === adapterType && c.isActive);
      if (!matched) {
        await this.ack(token, callbackQueryId, "Model tidak tersedia. Pilih lain.");
        return { status: "rejected_state" };
      }
      // Validate key eligibility (at least one eligible key)
      const { ProviderKeyRepository } =
        await import("@/server/repositories/provider-key.repository");
      const { parseEncryptionKey } = await import("@/server/security/encryption");
      const { getServerEnv: getEnv } = await import("@/env");
      let eligible = true;
      try {
        const keyRepo = new ProviderKeyRepository(
          parseEncryptionKey(getEnv().PROVIDER_KEY_ENCRYPTION_KEY),
        );
        const keys = await keyRepo.listSafeKeys(matched.id);
        eligible = keys.some(
          (k) =>
            k.isActive && (!k.cooldownUntil || new Date(k.cooldownUntil).getTime() <= Date.now()),
        );
        if (!eligible && keys.length === 0) eligible = false;
      } catch {
        // If check fails, still allow selection (generation will fallback)
        eligible = true;
      }
      if (!eligible) {
        await this.ack(token, callbackQueryId, "Model sedang cooldown, pilih lain.");
        return { status: "rejected_state" };
      }

      await this.sessionRepository.setPreferredImageProvider(input.session.id, matched.id);

      if (asDefault) {
        try {
          const { UserImagePreferenceRepository } =
            await import("@/server/repositories/user-image-preference.repository");
          const prefRepo =
            (this.userImagePreferenceRepository as unknown as InstanceType<
              typeof UserImagePreferenceRepository
            >) ?? new UserImagePreferenceRepository();
          await prefRepo.upsert(input.telegramUserId, matched.id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "unknown";
          logStructured("error", "callback.model_default_upsert_failed", {
            sessionId: input.session.id,
            detail,
          });
        }
      }

      const label = MODEL_CODE_LABEL[code];
      const { buildModelSelectedMessage } = await import("@/server/telegram/messages");
      try {
        await this.sendTelegramMessage(
          token,
          input.session.telegramChatId,
          buildModelSelectedMessage(label, asDefault),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        logStructured("error", "callback.model_picked_notify_failed", {
          sessionId: input.session.id,
          detail,
        });
      }

      await this.ack(token, callbackQueryId, asDefault ? `Default: ${label}` : label);
      return { status: "accepted" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.model_picked_failed", {
        sessionId: input.session.id,
        detail,
      });
      await this.ack(token, callbackQueryId, "Gagal mengatur model. Coba lagi.");
      return { status: "rejected_state" };
    }
  }

  private async resolveSelectedCode(session: SessionSafe): Promise<ModelShortCode | null> {
    if (!session.preferredImageProviderConfigId) return null;
    try {
      const { ProviderConfigRepository } =
        await import("@/server/repositories/provider-config.repository");
      const repo = this.providerConfigRepository as unknown as
        InstanceType<typeof ProviderConfigRepository> | undefined;
      const cfgRepo = repo ?? new ProviderConfigRepository();
      const cfg = await cfgRepo.getById(session.preferredImageProviderConfigId);
      if (!cfg) return null;
      return ADAPTER_TO_MODEL_CODE[cfg.adapterType] ?? null;
    } catch {
      return null;
    }
  }

  // ---- Reasoning (enhance/revise) picker ----

  private async handleReasoningPickerRaw(
    input: {
      sessionId: string;
      session: SessionSafe;
      telegramUserId: bigint;
      callbackQueryId: string;
    },
    rawData: string,
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome | null> {
    const { parseReasoningPickerData } = await import("@/server/telegram/keyboards");
    const parsed = parseReasoningPickerData(rawData);
    if (!parsed) return null;
    if (parsed.action === "reasoning_picker")
      return this.handleReasoningPicker(input as never, token, callbackQueryId);
    if (parsed.action === "reasoning_picker_back")
      return this.handleReasoningPickerBack(input as never, token, callbackQueryId);
    if (parsed.action === "reasoning_picked")
      return this.handleReasoningPicked(input as never, token, callbackQueryId, false, parsed.code);
    if (parsed.action === "reasoning_default")
      return this.handleReasoningPicked(input as never, token, callbackQueryId, true, parsed.code);
    return null;
  }

  // The reasoning model only affects future enhance/revise runs, so the picker
  // is also available from enhancement_failed (pick a different model, then
  // retry) — unlike the image picker which needs a revision to generate from.
  private async handleReasoningPicker(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    if (
      input.session.status !== "awaiting_confirmation" &&
      input.session.status !== "result_ready" &&
      input.session.status !== "generation_failed" &&
      input.session.status !== "enhancement_failed"
    ) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }
    const selected = await this.resolveSelectedReasoningCode(input.session);
    try {
      const { reasoningPickerKeyboard } = await import("@/server/telegram/keyboards");
      const { buildReasoningPickerMessage } = await import("@/server/telegram/messages");
      const label = selected ? REASONING_CODE_LABEL[selected] : null;
      const keyboard = reasoningPickerKeyboard(input.session.id, selected);
      if (this.sendMessageWithKeyboard) {
        await this.sendMessageWithKeyboard(
          token,
          input.session.telegramChatId,
          buildReasoningPickerMessage(label),
          keyboard,
        );
      } else {
        const { sendMessageWithKeyboard } = await import("@/server/telegram/client");
        await sendMessageWithKeyboard(
          token,
          input.session.telegramChatId,
          buildReasoningPickerMessage(label),
          keyboard,
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.reasoning_picker_send_failed", {
        sessionId: input.session.id,
        detail,
      });
    }
    await this.ack(token, callbackQueryId, "Pilih model reasoning");
    return { status: "accepted" };
  }

  private async handleReasoningPickerBack(
    input: { sessionId: string; session: SessionSafe },
    token: string,
    callbackQueryId: string,
  ): Promise<CallbackOutcome> {
    // Same context re-show as the image picker back (both picker rows visible).
    return this.reshowContextWithPickers(input, token, callbackQueryId, "Kembali");
  }

  private async handleReasoningPicked(
    input: { sessionId: string; session: SessionSafe; telegramUserId: bigint },
    token: string,
    callbackQueryId: string,
    asDefault: boolean,
    code?: ReasoningShortCode,
  ): Promise<CallbackOutcome> {
    if (
      input.session.status !== "awaiting_confirmation" &&
      input.session.status !== "result_ready" &&
      input.session.status !== "generation_failed" &&
      input.session.status !== "enhancement_failed"
    ) {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
    }
    if (!code) {
      await this.ack(token, callbackQueryId, "Model tidak valid.");
      return { status: "rejected_state" };
    }
    const adapterType = REASONING_CODE_TO_ADAPTER[code];
    try {
      // Resolve provider config by adapter_type among active configs. An
      // adapter_type may map to several active configs (e.g. openai_compatible
      // for Cloudflare + other OpenAI-compatible endpoints); the picker
      // resolves to the highest-priority active one, matching selector order.
      const { ProviderConfigRepository } =
        await import("@/server/repositories/provider-config.repository");
      const repo = this.providerConfigRepository as unknown as
        InstanceType<typeof ProviderConfigRepository> | undefined;
      const cfgRepo = repo ?? new ProviderConfigRepository();
      const configs = (await cfgRepo.listActive("reasoning")) as Array<{
        id: string;
        adapterType: string;
        priority: number;
        isActive: boolean;
      }>;
      const matched = configs
        .filter((c) => c.adapterType === adapterType && c.isActive)
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0];
      if (!matched) {
        await this.ack(token, callbackQueryId, "Model tidak tersedia. Pilih lain.");
        return { status: "rejected_state" };
      }
      // Validate key eligibility (at least one eligible key)
      const { ProviderKeyRepository } =
        await import("@/server/repositories/provider-key.repository");
      const { parseEncryptionKey } = await import("@/server/security/encryption");
      const { getServerEnv: getEnv } = await import("@/env");
      let eligible = true;
      try {
        const keyRepo = new ProviderKeyRepository(
          parseEncryptionKey(getEnv().PROVIDER_KEY_ENCRYPTION_KEY),
        );
        const keys = await keyRepo.listSafeKeys(matched.id);
        eligible = keys.some(
          (k) =>
            k.isActive && (!k.cooldownUntil || new Date(k.cooldownUntil).getTime() <= Date.now()),
        );
        if (!eligible && keys.length === 0) eligible = false;
      } catch {
        // If check fails, still allow selection (generation will fallback)
        eligible = true;
      }
      if (!eligible) {
        await this.ack(token, callbackQueryId, "Model sedang cooldown, pilih lain.");
        return { status: "rejected_state" };
      }

      await this.sessionRepository.setPreferredReasoningProvider(input.session.id, matched.id);

      if (asDefault) {
        try {
          const prefRepo =
            this.userReasoningPreferenceRepository ??
            new (
              await import("@/server/repositories/user-reasoning-preference.repository")
            ).UserReasoningPreferenceRepository();
          await prefRepo.upsert(input.telegramUserId, matched.id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "unknown";
          logStructured("error", "callback.reasoning_default_upsert_failed", {
            sessionId: input.session.id,
            detail,
          });
        }
      }

      const label = REASONING_CODE_LABEL[code];
      const { buildReasoningSelectedMessage } = await import("@/server/telegram/messages");
      try {
        await this.sendTelegramMessage(
          token,
          input.session.telegramChatId,
          buildReasoningSelectedMessage(label, asDefault),
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown";
        logStructured("error", "callback.reasoning_picked_notify_failed", {
          sessionId: input.session.id,
          detail,
        });
      }

      await this.ack(token, callbackQueryId, asDefault ? `Default: ${label}` : label);
      return { status: "accepted" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.reasoning_picked_failed", {
        sessionId: input.session.id,
        detail,
      });
      await this.ack(token, callbackQueryId, "Gagal mengatur model reasoning. Coba lagi.");
      return { status: "rejected_state" };
    }
  }

  // Resolves the reasoning code to display on the picker row: the session
  // preference wins; otherwise the provider that produced the active revision
  // (so the picker reflects the model actually used for this enhancement).
  private async resolveSelectedReasoningCode(
    session: SessionSafe,
  ): Promise<ReasoningShortCode | null> {
    const byConfigId = async (configId: string | null): Promise<ReasoningShortCode | null> => {
      if (!configId) return null;
      try {
        const { ProviderConfigRepository } =
          await import("@/server/repositories/provider-config.repository");
        const repo = this.providerConfigRepository as unknown as
          InstanceType<typeof ProviderConfigRepository> | undefined;
        const cfgRepo = repo ?? new ProviderConfigRepository();
        const cfg = await cfgRepo.getById(configId);
        if (!cfg) return null;
        return REASONING_ADAPTER_TO_CODE[cfg.adapterType] ?? null;
      } catch {
        return null;
      }
    };

    const preferred = await byConfigId(session.preferredReasoningProviderConfigId);
    if (preferred) return preferred;
    if (!session.activeRevisionId) return null;
    try {
      const { EnhancementRepository } =
        await import("@/server/repositories/enhancement.repository");
      const rev = await new EnhancementRepository().getRevisionById(session.activeRevisionId);
      return await byConfigId(rev?.reasoningProviderConfigId ?? null);
    } catch {
      return null;
    }
  }

  private async ack(token: string, callbackQueryId: string, text: string): Promise<void> {
    try {
      await this.answerCallbackQuery(token, callbackQueryId, { text });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "callback.answer_callback_failed", { detail });
    }
  }
}

// The sendTelegramMessage dep is typed Promise<unknown> so tests can return
// anything; production sendMessage returns { messageId }. Tolerate both.
export function extractMessageId(result: unknown): number | null {
  if (typeof result === "object" && result !== null) {
    const candidate = (result as { messageId?: unknown }).messageId;
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return null;
}
