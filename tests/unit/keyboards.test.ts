import { describe, expect, it } from "vitest";
import {
  confirmationKeyboard,
  buildCallbackData,
  parseConfirmationData,
} from "@/server/telegram/keyboards";

const SESSION_ID = "8f4f9c10-2a5a-4b3c-9d1e-000000000001";

describe("keyboards", () => {
  it("builds a confirmation keyboard with the three actions", () => {
    const keyboard = confirmationKeyboard(SESSION_ID);
    expect(keyboard.inline_keyboard).toHaveLength(1);
    const buttons = keyboard.inline_keyboard[0];
    expect(buttons).toHaveLength(3);
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
