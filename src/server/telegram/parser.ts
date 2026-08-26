// Narrow Telegram webhook payload parsers.
// Only the fields the bot needs in Milestone 3 are modeled; unknown fields are
// tolerated by zod so Telegram schema additions do not break the webhook.

import { z } from "zod";

export const TELEGRAM_MAX_PROMPT_LENGTH = 4000;

// Telegram user id and chat id are JSON numbers that may exceed JS safe integer
// range. zod coerces them into BigInt for exactness.
const bigintFromJson = z.number().transform((value) => BigInt(value));

const telegramUserSchema = z.object({
  id: bigintFromJson,
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  username: z.string().optional(),
});

const telegramChatSchema = z.object({
  id: bigintFromJson,
  type: z.enum(["private", "group", "supergroup", "channel"]),
});

const telegramMessageSchema = z.object({
  message_id: z.number(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number(),
  text: z.string().optional(),
});

const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: telegramUserSchema,
  message: z
    .object({
      chat: telegramChatSchema,
    })
    .optional(),
  data: z.string().optional(),
});

const telegramUpdateSchema = z
  .object({
    update_id: bigintFromJson,
    message: telegramMessageSchema.optional(),
    callback_query: telegramCallbackQuerySchema.optional(),
  })
  .superRefine((update, ctx) => {
    const hasMessage = update.message !== undefined;
    const hasCallback = update.callback_query !== undefined;
    if (hasMessage && hasCallback) {
      ctx.addIssue({
        code: "custom",
        message: "update must contain either message or callback_query, not both",
      });
    }
    if (!hasMessage && !hasCallback) {
      ctx.addIssue({
        code: "custom",
        message: "update must contain message or callback_query",
      });
    }
  });

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;

export type ParsedPrivateTextMessage = {
  kind: "private_text_message";
  updateId: bigint;
  userId: bigint;
  chatId: bigint;
  messageId: number;
  text: string;
};

export type ParsedCallbackQuery = {
  kind: "callback_query";
  updateId: bigint;
  userId: bigint;
  callbackQueryId: string;
  data?: string;
};

export type ParsedUpdate = ParsedPrivateTextMessage | ParsedCallbackQuery | { kind: "unsupported" };

// A parsed slash command: canonical lowercase name (hyphens normalized to
// underscores, @botname suffix stripped) and the trimmed remainder text.
export type ParsedSlashCommand = {
  name: string;
  args: string;
};

// Parses "/command@botname rest of text" into { name, args }. Returns null for
// non-commands. Hyphens normalize to underscores so "/generate-image" and
// "/generate_image" are the same command (the Telegram command menu itself
// only accepts underscores).
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");
  const token = spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1).trim();
  const rawName = token.split("@")[0] ?? "";
  const name = rawName.toLowerCase().replace(/-/g, "_");
  if (name.length === 0 || !/^[a-z0-9_]+$/.test(name)) return null;
  return { name, args };
}

// Callback actions currently recognized by the database constraint and the M4
// callback state machine. Any other data maps to `unknown` and is only logged
// (M3 does not own callback processing).
export const CALLBACK_ACTIONS = [
  "generate",
  "revise",
  "cancel",
  "retry",
  "regenerate",
  "complete",
  "model_picker",
  "model_picked",
  "model_picked_default",
  "model_picker_back",
] as const;

export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

export function parseCallbackAction(data: string | undefined): CallbackAction | "unknown" {
  if (!data) return "unknown";
  if (data.length > 64) return "unknown";
  const action = data.split(":")[0] as CallbackAction;
  if ((CALLBACK_ACTIONS as readonly string[]).includes(action)) return action;
  return "unknown";
}

export function parseTelegramUpdate(raw: unknown): TelegramUpdate {
  return telegramUpdateSchema.parse(raw);
}

// Reduces a validated Telegram update to the minimal shapes the webhook handler
// understands. Anything that is not a private text message or a callback query
// maps to `unsupported` and is acknowledged without side effects.
export function reduceTelegramUpdate(update: TelegramUpdate): ParsedUpdate {
  if (update.message) {
    const message = update.message;
    if (
      message.chat.type !== "private" ||
      message.from === undefined ||
      message.text === undefined ||
      message.text.length === 0
    ) {
      return { kind: "unsupported" };
    }
    return {
      kind: "private_text_message",
      updateId: update.update_id,
      userId: message.from.id,
      chatId: message.chat.id,
      messageId: message.message_id,
      text: message.text,
    };
  }

  if (update.callback_query) {
    const callback = update.callback_query;
    return {
      kind: "callback_query",
      updateId: update.update_id,
      userId: callback.from.id,
      callbackQueryId: callback.id,
      data: callback.data,
    };
  }

  return { kind: "unsupported" };
}
