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
  type ModelShortCode,
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
  | "model_picker_back";

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
    if (input.session.status !== "result_ready") {
      await this.ack(token, callbackQueryId, "Sesi sedang diproses.");
      return { status: "rejected_state" };
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
    // Re-show confirmation or result context
    const selected = await this.resolveSelectedCode(input.session);
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
          ? resultKeyboardWithModel(input.session.id, selected)
          : confirmationKeyboardWithModel(input.session.id, selected);
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
    await this.ack(token, callbackQueryId, "Kembali");
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
function extractMessageId(result: unknown): number | null {
  if (typeof result === "object" && result !== null) {
    const candidate = (result as { messageId?: unknown }).messageId;
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return null;
}
