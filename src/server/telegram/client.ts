// Thin Telegram Bot API client. No SDK dependency.
// Only the endpoints the bot uses are implemented. Requests carry a bounded
// timeout and never log the bot token.

const TELEGRAM_API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 5000;

export type SendMessageResult = {
  messageId: number;
};

export type TelegramApiError = {
  ok: false;
  error_code: number;
  description: string;
};

export type TelegramApiResult<T> = { ok: true; result: T } | TelegramApiError;

async function callApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await response.json()) as TelegramApiResult<T>;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(
  token: string,
  chatId: bigint,
  text: string,
  options?: { replyToMessageId?: number },
): Promise<SendMessageResult> {
  const result = await callApi<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId.toString(),
    text,
    ...(options?.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
  });
  if (!result.ok) {
    throw new Error(`telegram sendMessage failed: ${redactTelegramError(result)}`);
  }
  return { messageId: result.result.message_id };
}

// Sends a message with an inline keyboard (reply_markup). Used for the
// enhancement confirmation so the user can Generate / Revise Lagi / Batal.
export async function sendMessageWithKeyboard(
  token: string,
  chatId: bigint,
  text: string,
  keyboard: { inline_keyboard: { text: string; callback_data: string }[][] },
): Promise<SendMessageResult> {
  const result = await callApi<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId.toString(),
    text,
    reply_markup: keyboard,
  });
  if (!result.ok) {
    throw new Error(`telegram sendMessageWithKeyboard failed: ${redactTelegramError(result)}`);
  }
  return { messageId: result.result.message_id };
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  options?: { text?: string; showAlert?: boolean },
): Promise<void> {
  const result = await callApi<boolean>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(options?.text ? { text: options.text } : {}),
    ...(options?.showAlert ? { show_alert: true } : {}),
  });
  if (!result.ok) {
    throw new Error(`telegram answerCallbackQuery failed: ${redactTelegramError(result)}`);
  }
}

// Telegram errors may echo the offending input (including prompt text) in the
// description. Only the numeric code is safe to expose; the description is
// never surfaced to the user or logs as-is.
export function redactTelegramError(error: TelegramApiError): string {
  return `code ${error.error_code}`;
}
