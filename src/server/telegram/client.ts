// Thin Telegram Bot API client. No SDK dependency.
// Only the endpoints the bot uses are implemented. Requests carry a bounded
// timeout and never log the bot token.

const TELEGRAM_API_BASE = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 5000;
// sendPhoto instructs Telegram to fetch the image URL itself; allow more time
// for that upstream fetch than for plain text messages.
const PHOTO_REQUEST_TIMEOUT_MS = 15_000;

export type SendMessageResult = {
  messageId: number;
};

export type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][];
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
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<TelegramApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  keyboard: InlineKeyboard,
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

// Sends a photo by URL. Telegram fetches the image itself, so the Vercel
// response body never carries the image bytes. Used for image generation
// results (Milestone 5).
export async function sendPhotoByUrl(
  token: string,
  chatId: bigint,
  imageUrl: string,
  options?: { caption?: string; replyMarkup?: InlineKeyboard },
): Promise<SendMessageResult> {
  const result = await callApi<{ message_id: number }>(
    token,
    "sendPhoto",
    {
      chat_id: chatId.toString(),
      photo: imageUrl,
      ...(options?.caption ? { caption: options.caption } : {}),
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    },
    PHOTO_REQUEST_TIMEOUT_MS,
  );
  if (!result.ok) {
    throw new Error(`telegram sendPhoto failed: ${redactTelegramError(result)}`);
  }
  return { messageId: result.result.message_id };
}

// Edits a previously sent message in place. Used for the generation status
// message: sent once as "Sedang membuat gambar..." and edited to the final
// outcome so the chat does not fill with one-off status bubbles.
export async function editMessageText(
  token: string,
  chatId: bigint,
  messageId: number,
  text: string,
): Promise<SendMessageResult> {
  const result = await callApi<{ message_id: number }>(token, "editMessageText", {
    chat_id: chatId.toString(),
    message_id: messageId,
    text,
  });
  if (!result.ok) {
    throw new Error(`telegram editMessageText failed: ${redactTelegramError(result)}`);
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
