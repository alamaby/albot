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
  sendTelegramMessage: (token: string, chatId: bigint, text: string) => Promise<unknown>;
  answerTelegramCallback: (token: string, callbackQueryId: string) => Promise<unknown>;
  dispatchToProcessor: (origin: string, secret: string) => Promise<unknown>;
};

export function createDefaultWebhookDeps(): TelegramWebhookDeps {
  return {
    botUserRepository: new BotUserRepository(),
    sessionPolicyRepository: new SessionPolicyRepository(),
    telegramUpdateRepository: new TelegramUpdateRepository(),
    callbackEventRepository: new CallbackEventRepository(),
    initialSessionRepository: new InitialSessionRepository(),
    sendTelegramMessage: sendMessage,
    answerTelegramCallback: answerCallbackQuery,
    dispatchToProcessor: dispatchToProcessorUrl,
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
    console.error(`webhook: telegram sendMessage failed (${detail})`);
  }
}

// Best-effort dispatcher call: fires the internal job processor. Failures are
// logged; the durable job row remains and a recovery poll (M7) can pick it up.
export async function dispatchToProcessorUrl(origin: string, secret: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${origin}/api/jobs/process`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`webhook: dispatcher returned HTTP ${response.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`webhook: dispatcher call failed (${detail})`);
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
      await handleCallbackQuery(env, deps, update);
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
): Promise<void> {
  // Dedupe the update first. A duplicate update_id is acknowledged silently.
  const inserted = await deps.telegramUpdateRepository.insertIfAbsent({
    updateId: callback.updateId,
    telegramUserId: callback.userId,
    updateType: "callback_query",
  });
  if (!inserted) return;

  // Milestone 3 does not own the callback state machine (Milestone 4 does), but
  // recognized callback actions are recorded for deduplication. Unrecognized
  // data is acknowledged without persisting.
  const action = parseCallbackAction(callback.data);
  let callbackEventId: string | null = null;
  if (action !== "unknown") {
    callbackEventId = await deps.callbackEventRepository.insertIfAbsent({
      callbackQueryId: callback.callbackQueryId,
      action,
      telegramUserId: callback.userId,
    });
  }

  // Answer the callback promptly so Telegram clears the loading indicator.
  try {
    await deps.answerTelegramCallback(env.TELEGRAM_BOT_TOKEN, callback.callbackQueryId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`webhook: telegram answerCallbackQuery failed (${detail})`);
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
  //    delivery we already handled; acknowledge silently.
  const inserted = await deps.telegramUpdateRepository.insertIfAbsent({
    updateId: message.updateId,
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    updateType: "message",
  });
  if (!inserted) return;

  // 2. Allowlist check by numeric Telegram user id.
  const user = await deps.botUserRepository.findByTelegramUserId(message.userId);
  if (!user || !user.isAllowed) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("access_denied"));
    return;
  }

  // 3. Prompt length limit.
  if (message.text.length > ACCESS_CONTROLS.maxPromptLength) {
    await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_too_long"));
    return;
  }

  // 4. Abuse controls (derived from prompt_sessions).
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

  // 5. Atomically create session + first revision + enhancement job.
  await deps.initialSessionRepository.create({
    telegramUserId: message.userId,
    telegramChatId: message.chatId,
    sourcePrompt: message.text,
    updateId: message.updateId,
  });

  // 6. Acknowledge and dispatch asynchronously.
  await trySendMessage(env, deps, message.chatId, buildBotMessage("prompt_received"));
  try {
    await deps.dispatchToProcessor(origin, env.JOB_PROCESSOR_SECRET);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`webhook: dispatcher failed (${detail})`);
  }
}
