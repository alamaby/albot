import { describe, expect, it } from "vitest";
import {
  confirmationKeyboard,
  resultKeyboard,
  retryKeyboard,
  buildCallbackData,
  parseConfirmationData,
  parseResultData,
  parseRetryData,
} from "@/server/telegram/keyboards";

const SESSION_ID = "8f4f9c10-2a5a-4b3c-9d1e-000000000001";

describe("keyboards", () => {
  it("builds a confirmation keyboard with the three actions", () => {
    const keyboard = confirmationKeyboard(SESSION_ID);
    expect(keyboard.inline_keyboard[0]).toHaveLength(3);
    const buttons = keyboard.inline_keyboard[0];
    expect(buttons.map((b) => b.text)).toEqual(["Generate", "Revise Lagi", "Batal"]);
    expect(buttons[0].callback_data).toBe(`generate:${SESSION_ID}`);
    expect(buttons[1].callback_data).toBe(`revise:${SESSION_ID}`);
    expect(buttons[2].callback_data).toBe(`cancel:${SESSION_ID}`);
  });

  it("round-trips callback data through parseConfirmationData", () => {
    for (const action of ["generate", "revise", "cancel"] as const) {
      const data = buildCallbackData(action, SESSION_ID);
      expect(parseConfirmationData(data)).toEqual({ action, sessionId: SESSION_ID });
    }
  });

  it("rejects unknown actions and malformed data", () => {
    expect(parseConfirmationData("regenerate:abc")).toBeNull();
    expect(parseConfirmationData("generate:")).toBeNull();
    expect(parseConfirmationData("generate")).toBeNull();
    expect(parseConfirmationData("generate:session:extra")).toBeNull();
    expect(parseConfirmationData(undefined)).toBeNull();
    expect(parseConfirmationData("")).toBeNull();
  });
});

describe("result keyboard (Milestone 5)", () => {
  it("builds a result keyboard with the three post-result actions", () => {
    const keyboard = resultKeyboard(SESSION_ID);
    expect(keyboard.inline_keyboard[0]).toHaveLength(3);
    const buttons = keyboard.inline_keyboard[0];
    expect(buttons.map((b) => b.text)).toEqual(["Regenerate", "Revise Prompt", "Selesai"]);
    expect(buttons[0].callback_data).toBe(`regenerate:${SESSION_ID}`);
    expect(buttons[1].callback_data).toBe(`revise:${SESSION_ID}`);
    expect(buttons[2].callback_data).toBe(`complete:${SESSION_ID}`);
  });

  it("round-trips callback data through parseResultData", () => {
    for (const action of ["regenerate", "revise", "complete"] as const) {
      const data = buildCallbackData(action, SESSION_ID);
      expect(parseResultData(data)).toEqual({ action, sessionId: SESSION_ID });
    }
  });

  it("rejects non-result actions and malformed data", () => {
    expect(parseResultData("generate:abc")).toBeNull();
    expect(parseResultData("regenerate:")).toBeNull();
    expect(parseResultData("regenerate")).toBeNull();
    expect(parseResultData("regenerate:session:extra")).toBeNull();
    expect(parseResultData(undefined)).toBeNull();
    expect(parseResultData("")).toBeNull();
  });
});

describe("retry keyboard (enhancement terminal failure)", () => {
  it("builds a retry keyboard with a single Coba Lagi button", () => {
    const keyboard = retryKeyboard(SESSION_ID);
    expect(keyboard.inline_keyboard).toHaveLength(1);
    const buttons = keyboard.inline_keyboard[0];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].text).toBe("Coba Lagi");
    expect(buttons[0].callback_data).toBe(`retry:${SESSION_ID}`);
  });

  it("round-trips callback data through parseRetryData", () => {
    const data = buildCallbackData("retry", SESSION_ID);
    expect(parseRetryData(data)).toEqual({ action: "retry", sessionId: SESSION_ID });
  });

  it("rejects non-retry actions and malformed data", () => {
    expect(parseRetryData("generate:abc")).toBeNull();
    expect(parseRetryData("revise:abc")).toBeNull();
    expect(parseRetryData("retry:")).toBeNull();
    expect(parseRetryData("retry")).toBeNull();
    expect(parseRetryData("retry:session:extra")).toBeNull();
    expect(parseRetryData(undefined)).toBeNull();
    expect(parseRetryData("")).toBeNull();
  });
});
