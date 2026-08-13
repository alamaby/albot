import { describe, expect, it } from "vitest";
import {
  parseTelegramUpdate,
  reduceTelegramUpdate,
  parseCallbackAction,
  TELEGRAM_MAX_PROMPT_LENGTH,
} from "@/server/telegram/parser";

// Telegram sends JSON numbers for user/chat/update ids. The parser converts
// them to BigInt, so fixtures use plain numbers (JSON shape) and assertions
// expect BigInt.
const PRIVATE_USER_ID = 123456789;
const PRIVATE_CHAT_ID = 123456789;
const UPDATE_ID = 42;

function privateMessageUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: UPDATE_ID,
    message: {
      message_id: 7,
      from: { id: PRIVATE_USER_ID, is_bot: false, first_name: "Test" },
      chat: { id: PRIVATE_CHAT_ID, type: "private" },
      date: 1_700_000_000,
      text: "a cozy cabin in the mountains",
      ...overrides,
    },
  };
}

function callbackUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: UPDATE_ID,
    callback_query: {
      id: "callback-1",
      from: { id: PRIVATE_USER_ID, is_bot: false, first_name: "Test" },
      data: "generate",
      ...overrides,
    },
  };
}

describe("parseTelegramUpdate", () => {
  it("parses a valid private message update", () => {
    const update = parseTelegramUpdate(privateMessageUpdate());
    expect(update.update_id).toBe(BigInt(UPDATE_ID));
    expect(update.message?.chat.type).toBe("private");
    expect(update.message?.from?.id).toBe(BigInt(PRIVATE_USER_ID));
  });

  it("converts numeric JSON ids to bigint", () => {
    const update = parseTelegramUpdate(privateMessageUpdate());
    expect(typeof update.update_id).toBe("bigint");
    expect(update.message?.from?.id).toBeTypeOf("bigint");
    expect(update.message?.chat.id).toBe(BigInt(PRIVATE_CHAT_ID));
  });

  it("rejects an update without message or callback_query", () => {
    expect(() => parseTelegramUpdate({ update_id: UPDATE_ID })).toThrow();
  });

  it("rejects an update containing both message and callback_query", () => {
    const update = privateMessageUpdate();
    (update as Record<string, unknown>).callback_query = {
      id: "cb",
      from: { id: PRIVATE_USER_ID },
      data: "revise",
    };
    expect(() => parseTelegramUpdate(update)).toThrow();
  });

  it("rejects a non-integer update_id", () => {
    expect(() => parseTelegramUpdate({ update_id: "abc", message: {} })).toThrow();
  });

  it("rejects an invalid chat type", () => {
    const update = privateMessageUpdate();
    update.message.chat = { id: PRIVATE_CHAT_ID, type: "mars" };
    expect(() => parseTelegramUpdate(update)).toThrow();
  });

  it("tolerates unknown fields", () => {
    const update = parseTelegramUpdate({
      ...privateMessageUpdate(),
      edited_message: { message_id: 1 },
    });
    expect(update.update_id).toBe(BigInt(UPDATE_ID));
  });

  it("parses a valid callback query update", () => {
    const update = parseTelegramUpdate(callbackUpdate());
    expect(update.callback_query?.id).toBe("callback-1");
    expect(update.callback_query?.data).toBe("generate");
  });
});

describe("reduceTelegramUpdate", () => {
  it("reduces a private text message", () => {
    const reduced = reduceTelegramUpdate(parseTelegramUpdate(privateMessageUpdate()));
    expect(reduced).toEqual({
      kind: "private_text_message",
      updateId: BigInt(UPDATE_ID),
      userId: BigInt(PRIVATE_USER_ID),
      chatId: BigInt(PRIVATE_CHAT_ID),
      messageId: 7,
      text: "a cozy cabin in the mountains",
    });
  });

  it("maps a group message to unsupported", () => {
    const update = privateMessageUpdate();
    update.message.chat = { id: 1, type: "group" };
    expect(reduceTelegramUpdate(parseTelegramUpdate(update)).kind).toBe("unsupported");
  });

  it("maps a channel post to unsupported", () => {
    const update = privateMessageUpdate();
    update.message.chat = { id: 1, type: "channel" };
    expect(reduceTelegramUpdate(parseTelegramUpdate(update)).kind).toBe("unsupported");
  });

  it("maps a message without text to unsupported", () => {
    const update = privateMessageUpdate();
    delete (update.message as Record<string, unknown>).text;
    expect(reduceTelegramUpdate(parseTelegramUpdate(update)).kind).toBe("unsupported");
  });

  it("maps a callback query", () => {
    const reduced = reduceTelegramUpdate(parseTelegramUpdate(callbackUpdate()));
    expect(reduced).toEqual({
      kind: "callback_query",
      updateId: BigInt(UPDATE_ID),
      userId: BigInt(PRIVATE_USER_ID),
      callbackQueryId: "callback-1",
      data: "generate",
    });
  });
});

describe("parseCallbackAction", () => {
  it("recognizes exact known actions", () => {
    expect(parseCallbackAction("generate")).toBe("generate");
    expect(parseCallbackAction("revise")).toBe("revise");
    expect(parseCallbackAction("cancel")).toBe("cancel");
    expect(parseCallbackAction("regenerate")).toBe("regenerate");
    expect(parseCallbackAction("complete")).toBe("complete");
    expect(parseCallbackAction("retry")).toBe("retry");
  });

  it("recognizes known actions with a payload suffix", () => {
    expect(parseCallbackAction("generate:abc123")).toBe("generate");
  });

  it("maps empty and unknown data to unknown", () => {
    expect(parseCallbackAction(undefined)).toBe("unknown");
    expect(parseCallbackAction("")).toBe("unknown");
    expect(parseCallbackAction("not-an-action")).toBe("unknown");
    expect(parseCallbackAction("evil:generate")).toBe("unknown");
  });
});

describe("TELEGRAM_MAX_PROMPT_LENGTH", () => {
  it("matches the documented limit", () => {
    expect(TELEGRAM_MAX_PROMPT_LENGTH).toBe(4000);
  });
});
