// Telegram webhook orchestration (Milestone 3).
// The webhook handler must be fast and must not run inference. It validates the
// update, deduplicates it, enforces access rules and abuse controls, and
// atomically persists the initial session/revision/job. Any outbound Telegram
// message or dispatcher call is best-effort: failures are logged but never fail
// the webhook.

import { getServerEnv, type ServerEnv } from "@/env";
import { sendMessage, answerCallbackQuery } from "@/server/telegram/client";
import { buildBotMessage } from "@/server/telegram/messages";
import { parseCallbackAction, TELEGRAM_MAX_PROMPT_LENGTH } from "@/server/telegram/parser";
import type { ParsedUpdate } from "@/server/telegram/parser";
import { BotUserRepository } from "@/server/repositories/bot-user.repository";
import { SessionPolicyRepository } from "@/server/repositories/session-policy.repository";
import { TelegramUpdateRepository } from "@/server/repositories/telegram-update.repository";
import { CallbackEventRepository } from "@/server/repositories/callback-event.repository";
import { InitialSessionRepository } from "@/server/repositories/initial-session.repository";
import { SessionRepository } from "@/server/repositories/session.repository";
import { logStructured } from "@/server/observability/logger";
import { RevisionInputUseCase } from "./revision-input";
import { CallbackStateMachine } from "./callback-state-machine";

export const ACCESS_CONTROLS = {
  maxPromptLength: TELEGRAM_MAX_PROMPT_LENGTH,
  rateLimitWindowMinutes: 10,
  rateLimitMaxSubmissions: 5,
} as const;

// Inject repositories so unit tests can stub the database layer.
export type TelegramWebhookDeps = {
  botUserRepository: BotUserRepository;
  sessionPolicyRepository: SessionPolicyRepository;
  telegramUpdateRepository: TelegramUpdateRepository;
  callbackEventRepository: CallbackEventRepository;
  initialSessionRepository: InitialSessionRepository;
  sessionRepository: SessionRepository;
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
  ) => Promise<unknown>;
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

// Best-effort dispatcher call: fires the internal job processor. Failures are
// logged; the durable job row remains and a recovery poll (M7) can pick it up.
export async function dispatchToProcessorUrl(
  origin: string,
  secret: string,
  payload?: Record<string, unknown>,
): Promise<void> {
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
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "webhook.dispatcher_failed", { detail });
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
  // Callback data shape: "<action>:<sessionId>". Parse early so the callback
  // event row links to the session (audit + dedupe).
  const sessionId = callback.data?.split(":")[1];
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
          action: action as "generate" | "revise" | "cancel" | "regenerate" | "complete",
          sessionId,
          session,
          telegramUserId: callback.userId,
          callbackQueryId: callback.callbackQueryId,
          origin,
        });
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

  // 3. Revision-input mode: a session in awaiting_revision_input consumes the
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

  // 4. Prompt length limit.
  if (message.text.length > ACCESS_CONTROLS.maxPromptLength) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_too_long"));
    return;
  }

  // 5. Abuse controls (derived from prompt_sessions).
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

  // 6. Atomically create session + first revision + enhancement job.
  await deps.initialSessionRepository.create({
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    sourcePrompt: message.text,
    updateId: message.updateId,
  });

  // 7. Acknowledge and dispatch asynchronously.
  await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_received"));
  try {
    await deps.dispatchToProcessor(origin, env.JOB_PROCESSOR_SECRET, { sessionOrigin: "webhook" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    logStructured("error", "webhook.dispatcher_failed", { detail });
  }
}
