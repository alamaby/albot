// Telegram webhook orchestration (Milestone 3).
// The webhook handler must be fast and must not run inference. It validates the
// update, deduplicates it, enforces access rules and abuse controls, and
// atomically persists the initial session/revision/job. Any outbound Telegram
// message or dispatcher call is best-effort: failures are logged but never fail
// the webhook.

import { getServerEnv, type ServerEnv } from "@/env";
import { sendMessage, answerCallbackQuery } from "@/server/telegram/client";
import { buildBotMessage, buildGenerationStatusMessage } from "@/server/telegram/messages";
import {
  parseCallbackAction,
  parseSlashCommand,
  TELEGRAM_MAX_PROMPT_LENGTH,
} from "@/server/telegram/parser";
import type { ParsedUpdate } from "@/server/telegram/parser";
import { BotUserRepository } from "@/server/repositories/bot-user.repository";
import { SessionPolicyRepository } from "@/server/repositories/session-policy.repository";
import { TelegramUpdateRepository } from "@/server/repositories/telegram-update.repository";
import { CallbackEventRepository } from "@/server/repositories/callback-event.repository";
import { InitialSessionRepository } from "@/server/repositories/initial-session.repository";
import { SessionRepository } from "@/server/repositories/session.repository";
import { JobRepository } from "@/server/repositories/job.repository";
import { logStructured } from "@/server/observability/logger";
import { RevisionInputUseCase } from "./revision-input";
import {
  CallbackStateMachine,
  extractMessageId,
  type CallbackAction,
} from "./callback-state-machine";

export const ACCESS_CONTROLS = {
  maxPromptLength: TELEGRAM_MAX_PROMPT_LENGTH,
  rateLimitWindowMinutes: 10,
  rateLimitMaxSubmissions: 5,
} as const;

const CANCEL_COMMAND_RE = /^\/(cancel|batal)(@\w+)?\s*$/i;
const START_COMMAND_RE = /^\/start(@\w+)?\s*$/i;

export function isCancelCommand(text: string): boolean {
  return CANCEL_COMMAND_RE.test(text.trim());
}

export function isStartCommand(text: string): boolean {
  return START_COMMAND_RE.test(text.trim());
}

// Inject repositories so unit tests can stub the database layer.
export type TelegramWebhookDeps = {
  botUserRepository: BotUserRepository;
  sessionPolicyRepository: SessionPolicyRepository;
  telegramUpdateRepository: TelegramUpdateRepository;
  callbackEventRepository: CallbackEventRepository;
  initialSessionRepository: InitialSessionRepository;
  sessionRepository: SessionRepository;
  jobRepository: JobRepository;
  revisionInput: RevisionInputUseCase;
  callbackStateMachine: CallbackStateMachine;
  sendTelegramMessage: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  answerTelegramCallback: (
    token: string,
    callbackQueryId: string,
    options?: { text?: string; showAlert?: boolean },
  ) => Promise<unknown>;
  dispatchToProcessor: (
    origin: string,
    secret: string,
    payload?: Record<string, unknown>,
  ) => Promise<DispatchResult>;
};

export function createDefaultWebhookDeps(): TelegramWebhookDeps {
  const sendTelegramMessage = sendMessage;
  const answerTelegramCallback = answerCallbackQuery;
  const dispatchToProcessor = dispatchToProcessorUrl;
  return {
    botUserRepository: new BotUserRepository(),
    sessionPolicyRepository: new SessionPolicyRepository(),
    telegramUpdateRepository: new TelegramUpdateRepository(),
    callbackEventRepository: new CallbackEventRepository(),
    initialSessionRepository: new InitialSessionRepository(),
    sessionRepository: new SessionRepository(),
    jobRepository: new JobRepository(),
    // Wire the real Telegram client + dispatcher into the M4 use cases; their
    // default stubs throw "not wired" and would break callbacks/revision input.
    revisionInput: new RevisionInputUseCase({
      sendTelegramMessage,
      dispatchToProcessor,
    }),
    callbackStateMachine: new CallbackStateMachine({
      sendTelegramMessage,
      answerCallbackQuery: answerTelegramCallback,
      dispatchToProcessor,
    }),
    sendTelegramMessage,
    answerTelegramCallback,
    dispatchToProcessor,
  };
}

// Best-effort outbound Telegram message: never throws into the webhook path.
async function trySendMessage(
  env: ServerEnv,
  deps: TelegramWebhookDeps,
  chatId: bigint,
  text: string,
): Promise<void> {
  try {
    await deps.sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "webhook.send_message_failed", { detail });
  }
}

// Dispatcher call: fires the internal job processor. Returns a structured
// result so the webhook can give the user explicit feedback when the dispatch
// fails. The durable job row remains and a recovery poll (M7) or the new
// process-jobs cron (2026-08-22) can pick it up later.
export type DispatchResult =
  { ok: true; status: number } | { ok: false; status?: number; error: string };

export async function dispatchToProcessorUrl(
  origin: string,
  secret: string,
  payload?: Record<string, unknown>,
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${origin}/api/jobs/process`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      logStructured("error", "webhook.dispatcher_http_error", { status: response.status });
      return { ok: false, status: response.status, error: `http_${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "webhook.dispatcher_failed", { detail });
    return { ok: false, error: detail };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleTelegramUpdate(
  update: ParsedUpdate,
  origin: string,
  deps: TelegramWebhookDeps = createDefaultWebhookDeps(),
): Promise<void> {
  const env = getServerEnv();

  switch (update.kind) {
    case "unsupported":
      return;
    case "callback_query":
      await handleCallbackQuery(env, deps, update, origin);
      return;
    case "private_text_message":
      await handlePrivateTextMessage(env, deps, update, origin);
      return;
  }
}

async function handleCallbackQuery(
  env: ServerEnv,
  deps: TelegramWebhookDeps,
  callback: Extract<ParsedUpdate, { kind: "callback_query" }>,
  origin: string,
): Promise<void> {
  // Dedupe the update first. A duplicate update_id is acknowledged silently.
  const inserted = await deps.telegramUpdateRepository.insertIfAbsent({
    updateId: callback.updateId,
    telegramUserId: callback.userId,
    updateType: "callback_query",
  });
  if (!inserted) return;

  // Recognized callback actions are recorded for deduplication before the state
  // machine runs (Milestone 4). Unknown data is acknowledged without persisting.
  const action = parseCallbackAction(callback.data);
  // Callback data shape: "<action>:<sessionId>" or "<action>:<sessionId>:<code>" for model picker.
  // Strict length check: 2 parts for simple actions, 3 for model_picked variants.
  const rawParts = callback.data?.split(":") ?? [];
  const sessionId = (() => {
    if (!callback.data || rawParts.length < 2) return undefined;
    // For model_picked variants the session is still part[1], code is part[2]
    return rawParts[1];
  })();
  let callbackEventId: string | null = null;
  if (action !== "unknown") {
    callbackEventId = await deps.callbackEventRepository.insertIfAbsent({
      callbackQueryId: callback.callbackQueryId,
      action,
      telegramUserId: callback.userId,
      promptSessionId: sessionId,
    });
  }

  // A duplicate callback_query_id returns null: acknowledge and stop.
  if (!callbackEventId) {
    try {
      await deps.answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.callbackQueryId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "webhook.answer_callback_failed", { detail });
    }
    return;
  }

  // Resolve the session id from the callback data (action:sessionId) and run
  // the inline state machine. Failures are logged; the callback is answered.
  if (sessionId && action !== "unknown") {
    try {
      const session = await deps.sessionRepository.getById(sessionId);
      if (session) {
        await deps.callbackStateMachine.handle({
          action: action as CallbackAction,
          sessionId,
          session,
          telegramUserId: callback.userId,
          callbackQueryId: callback.callbackQueryId,
          origin,
          rawData: callback.data,
        } as unknown as Parameters<typeof deps.callbackStateMachine.handle>[0]);
      } else {
        await deps.answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.callbackQueryId, {
          text: "Sesi tidak ditemukan.",
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "webhook.callback_state_machine_failed", {
        sessionId: sessionId ?? null,
        detail,
      });
      try {
        await deps.answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.callbackQueryId);
      } catch (ackError) {
        const ackDetail = ackError instanceof Error ? ackError.message : "unknown";
        logStructured("error", "webhook.answer_callback_failed", { detail: ackDetail });
      }
    }
  } else {
    // Acknowledge the callback promptly so Telegram clears the loading indicator.
    try {
      await deps.answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.callbackQueryId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "webhook.answer_callback_failed", { detail });
    }
  }

  if (callbackEventId) {
    await deps.callbackEventRepository.markProcessed(callbackEventId);
  }
}

async function handlePrivateTextMessage(
  env: ServerEnv,
  deps: TelegramWebhookDeps,
  message: Extract<ParsedUpdate, { kind: "private_text_message" }>,
  origin: string,
): Promise<void> {
  // 1. Dedupe the update. A duplicate update_id means Telegram retried a
  //    delivery we already handled; a duplicate telegram_message_id means this
  //    is a later part of a Telegram-split long message. Both are acknowledged
  //    silently so a split message is never treated as multiple prompts.
  const inserted = await deps.telegramUpdateRepository.insertIfAbsent({
    updateId: message.updateId,
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    telegramMessageId: message.messageId,
    updateType: "message",
  });
  if (!inserted) return;

  // 2. Allowlist check by numeric Telegram user id.
  const user = await deps.botUserRepository.findByTelegramUserId(message.userId);
  if (!user || !user.isAllowed) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("access_denied"));
    return;
  }

  // 3. Slash /start — onboarding welcome with the command list. Must not
  //    create a session or spend provider credit: the text "/start" is not a
  //    prompt.
  if (isStartCommand(message.text)) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("welcome"));
    return;
  }

  // 3b. Slash /help — command reference. Static text, no side effects.
  const command = parseSlashCommand(message.text);
  if (command?.name === "help") {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("help"));
    return;
  }

  // 3c. Slash /generate-image (or /generate_image) — direct generation without
  //     enhancement. Same guards as the default text flow; the RPC creates the
  //     session directly in `generating` with a completed revision.
  if (command?.name === "generate_image") {
    await handleDirectGenerateCommand(env, deps, message, command.args, origin);
    return;
  }

  // 3d. Slash /enhance-prompt (or /enhance_prompt) — enhance-only: replies
  //     with the enhanced prompt as plain text. No session, no generation.
  if (command?.name === "enhance_prompt") {
    await handleEnhanceOnlyCommand(env, deps, message, command.args, origin);
    return;
  }

  // 4. Slash /cancel (or /batal) — cancel the latest active session so the
  //    user can start a new prompt. Takes precedence over revision-input mode
  //    so a stuck awaiting_revision_input can be escaped.
  if (isCancelCommand(message.text)) {
    const activeToCancel = await deps.sessionRepository.findActiveByUserId(message.userId);
    if (!activeToCancel) {
      await trySendMessage(env, deps, message.chatId, buildBotMessage("no_active_session"));
      return;
    }
    try {
      const cancelled = await deps.sessionRepository.cancelActiveSession(
        activeToCancel.id,
        activeToCancel.status,
      );
      if (!cancelled) {
        await trySendMessage(
          env,
          deps,
          message.chatId,
          "Sesi sedang diproses. Coba lagi sebentar.",
        );
        return;
      }
      await trySendMessage(env, deps, message.chatId, buildBotMessage("session_cancelled"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("error", "webhook.cancel_failed", {
        sessionId: activeToCancel.id,
        detail,
      });
      await trySendMessage(env, deps, message.chatId, "Gagal membatalkan sesi. Coba lagi.");
    }
    return;
  }

  // 5. Revision-input mode: a session in awaiting_revision_input consumes the
  //    next message as a revision instruction instead of a new prompt.
  const activeSession = await deps.sessionRepository.findActiveByUserId(message.userId);
  if (activeSession && activeSession.status === "awaiting_revision_input") {
    const outcome = await deps.revisionInput.handle(activeSession, message.text, origin);
    if (outcome.status === "expired") {
      await trySendMessage(env, deps, message.chatId, buildBotMessage("session_expired"));
    } else if (outcome.status === "too_long") {
      await trySendMessage(
        env,
        deps,
        message.chatId,
        buildBotMessage("revision_instruction_too_long", {
          maxPromptLength: ACCESS_CONTROLS.maxPromptLength,
        }),
      );
    }
    // 'accepted' and 'ignored' need no extra message here (the use case sends
    // its own acknowledgment).
    return;
  }

  // 6. Prompt length limit.
  if (message.text.length > ACCESS_CONTROLS.maxPromptLength) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_too_long"));
    return;
  }

  // 7. Abuse controls (derived from prompt_sessions).
  const policy = await deps.sessionPolicyRepository.getPolicyState(message.userId, {
    rateLimitWindowMinutes: ACCESS_CONTROLS.rateLimitWindowMinutes,
    rateLimitMaxSubmissions: ACCESS_CONTROLS.rateLimitMaxSubmissions,
  });

  if (policy.recentSubmissionCount >= ACCESS_CONTROLS.rateLimitMaxSubmissions) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("rate_limited"));
    return;
  }

  if (policy.activeSessionCount > 0) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("active_session_exists"));
    return;
  }

  // 8. Atomically create session + first revision + enhancement job.
  await deps.initialSessionRepository.create({
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    sourcePrompt: message.text,
    updateId: message.updateId,
  });

  // 8. Dispatch first, then acknowledge so the user only sees "queued" when the
  //    dispatcher confirmed the processor accepted the job. If the dispatcher
  //    call itself fails (network, 401, timeout) we surface an explicit error to
  //    the user instead of leaving them with a silent black hole — the durable
  //    job row stays and the new process-jobs cron (2026-08-22) will claim it.
  const dispatchResult = await deps.dispatchToProcessor(origin, env.JOB_PROCESSOR_SECRET, {
    sessionOrigin: "webhook",
  });
  if (dispatchResult.ok) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_received"));
  } else {
    logStructured("error", "webhook.dispatcher_returned_error", {
      status: dispatchResult.status ?? null,
      error: dispatchResult.error,
    });
    await trySendMessage(
      env,
      deps,
      message.chatId,
      "Gagal memulai pemrosesan. Silakan coba lagi sebentar.",
    );
  }
}

// Shared guard block for prompt-carrying commands (/generate-image): prompt
// length, rate limit, and the one-active-session rule. Returns true when the
// command may proceed.
async function checkPromptCommandGuards(
  env: ServerEnv,
  deps: TelegramWebhookDeps,
  message: Extract<ParsedUpdate, { kind: "private_text_message" }>,
  prompt: string,
): Promise<boolean> {
  if (prompt.length > ACCESS_CONTROLS.maxPromptLength) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_too_long"));
    return false;
  }

  const policy = await deps.sessionPolicyRepository.getPolicyState(message.userId, {
    rateLimitWindowMinutes: ACCESS_CONTROLS.rateLimitWindowMinutes,
    rateLimitMaxSubmissions: ACCESS_CONTROLS.rateLimitMaxSubmissions,
  });
  if (policy.recentSubmissionCount >= ACCESS_CONTROLS.rateLimitMaxSubmissions) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("rate_limited"));
    return false;
  }
  if (policy.activeSessionCount > 0) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("active_session_exists"));
    return false;
  }
  return true;
}

// /generate-image <prompt>: direct generation without enhancement. Creates the
// session directly in `generating` with a completed revision (RPC), enqueues
// generate_image, dispatches, and persists a status message the worker edits
// to the final outcome (mirrors the callback generate path).
async function handleDirectGenerateCommand(
  env: ServerEnv,
  deps: TelegramWebhookDeps,
  message: Extract<ParsedUpdate, { kind: "private_text_message" }>,
  args: string,
  origin: string,
): Promise<void> {
  if (args.length === 0) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("generate_usage"));
    return;
  }

  const allowed = await checkPromptCommandGuards(env, deps, message, args);
  if (!allowed) return;

  const created = await deps.initialSessionRepository.create({
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    sourcePrompt: args,
    updateId: message.updateId,
    enhancedPrompt: args,
  });

  const dispatchResult = await deps.dispatchToProcessor(origin, env.JOB_PROCESSOR_SECRET, {
    sessionOrigin: "webhook",
  });
  if (!dispatchResult.ok) {
    logStructured("error", "webhook.direct_generate_dispatch_error", {
      sessionId: created.sessionId,
      status: dispatchResult.status ?? null,
      error: dispatchResult.error,
    });
    // Durable job row remains; the recovery sweep claims it.
    await trySendMessage(env, deps, message.chatId, buildBotMessage("dispatch_failed"));
    return;
  }

  // Persisted status message (worker edits it to the outcome), mirroring the
  // callback generate path. Best-effort.
  try {
    const result = await deps.sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      message.chatId,
      buildGenerationStatusMessage("generating"),
    );
    const messageId = extractMessageId(result);
    if (messageId !== null) {
      await deps.sessionRepository.saveStatusMessageId(created.sessionId, messageId);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "webhook.direct_generate_status_failed", {
      sessionId: created.sessionId,
      detail,
    });
  }
}

// /enhance-prompt <prompt>: enhance-only. Inserts a session-less enhance_only
// job and dispatches; the handler replies with the enhanced prompt as plain
// text. Not counted by the session-based rate limit (documented limitation).
async function handleEnhanceOnlyCommand(
  env: ServerEnv,
  deps: TelegramWebhookDeps,
  message: Extract<ParsedUpdate, { kind: "private_text_message" }>,
  args: string,
  origin: string,
): Promise<void> {
  if (args.length === 0) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("enhance_usage"));
    return;
  }

  if (args.length > ACCESS_CONTROLS.maxPromptLength) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_too_long"));
    return;
  }

  await deps.jobRepository.insertEnhanceOnlyJob({
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    sourcePrompt: args,
  });

  const dispatchResult = await deps.dispatchToProcessor(origin, env.JOB_PROCESSOR_SECRET, {
    sessionOrigin: "webhook",
  });
  if (dispatchResult.ok) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("enhance_only_received"));
  } else {
    logStructured("error", "webhook.enhance_only_dispatch_error", {
      status: dispatchResult.status ?? null,
      error: dispatchResult.error,
    });
    await trySendMessage(env, deps, message.chatId, buildBotMessage("dispatch_failed"));
  }
}
