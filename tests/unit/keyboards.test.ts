import { describe, expect, it } from "vitest";
import {
  confirmationKeyboard,
  resultKeyboard,
  retryKeyboard,
  buildCallbackData,
  parseConfirmationData,
  parseResultData,
  parseRetryData,
  buildModelPickedCallback,
  buildModelPickerCallback,
  buildReasoningPickedCallback,
  buildReasoningPickerCallback,
  parseModelPickerData,
  parseReasoningPickerData,
  modelPickerKeyboard,
  reasoningPickerKeyboard,
  confirmationKeyboardWithModel,
  resultKeyboardWithModel,
  MODEL_SHORT_CODES,
  MODEL_CODE_TO_ADAPTER,
  MODEL_CODE_LABEL,
  REASONING_SHORT_CODES,
  REASONING_CODE_TO_ADAPTER,
  REASONING_CODE_LABEL,
  ADAPTER_TO_MODEL_CODE,
  REASONING_ADAPTER_TO_CODE,
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

describe("image model picker (hybrid)", () => {
  it("includes the four Aichixia codes mapped to their adapter types", () => {
    expect(MODEL_SHORT_CODES).toContain("axf2");
    expect(MODEL_SHORT_CODES).toContain("axlc");
    expect(MODEL_SHORT_CODES).toContain("axph");
    expect(MODEL_SHORT_CODES).toContain("axgm");
    expect(MODEL_CODE_TO_ADAPTER["axf2"]).toBe("aichixia_flux2");
    expect(MODEL_CODE_TO_ADAPTER["axlc"]).toBe("aichixia_lucid");
    expect(MODEL_CODE_TO_ADAPTER["axph"]).toBe("aichixia_phoenix");
    expect(MODEL_CODE_TO_ADAPTER["axgm"]).toBe("aichixia_gemini");
    expect(ADAPTER_TO_MODEL_CODE["aichixia_flux2"]).toBe("axf2");
    expect(ADAPTER_TO_MODEL_CODE["aichixia_gemini"]).toBe("axgm");
    expect(MODEL_CODE_LABEL["axf2"]).toBe("Aichixia Flux 2 Dev");
  });

  it("renders the confirmation keyboard with an image picker row", () => {
    const keyboard = confirmationKeyboardWithModel(SESSION_ID, "flux");
    expect(keyboard.inline_keyboard[1][0].callback_data).toBe(buildModelPickerCallback(SESSION_ID));
    expect(keyboard.inline_keyboard[1][0].text).toContain("Flux Schnell");
    // Aichixia label round-trip
    expect(confirmationKeyboardWithModel(SESSION_ID, "axf2").inline_keyboard[1][0].text).toContain(
      "Aichixia Flux 2 Dev",
    );
  });

  it("model picker keyboard lists all image codes with picked/default callbacks", () => {
    const keyboard = modelPickerKeyboard(SESSION_ID, "axlc");
    const texts = keyboard.inline_keyboard.flatMap((row) => row.map((b) => b.text));
    for (const code of MODEL_SHORT_CODES) {
      expect(texts).toContain(MODEL_CODE_LABEL[code] + (code === "axlc" ? " ✓" : ""));
    }
    const picked = keyboard.inline_keyboard
      .flatMap((row) => row.map((b) => b.callback_data))
      .filter((d) => d.startsWith("model_picked_default:"));
    expect(picked).toHaveLength(MODEL_SHORT_CODES.length);
  });

  it("round-trips image picker callback data", () => {
    expect(parseModelPickerData(`model_picker:${SESSION_ID}`)).toEqual({
      action: "model_picker",
      sessionId: SESSION_ID,
    });
    expect(parseModelPickerData(buildModelPickedCallback("axgm", SESSION_ID))).toEqual({
      action: "model_picked",
      code: "axgm",
      sessionId: SESSION_ID,
    });
    expect(parseModelPickerData(buildModelPickedCallback("axgm", SESSION_ID, true))).toEqual({
      action: "model_picked_default",
      code: "axgm",
      sessionId: SESSION_ID,
    });
    expect(parseModelPickerData(`model_picker_back:${SESSION_ID}`)).toEqual({
      action: "model_picker_back",
      sessionId: SESSION_ID,
    });
    expect(parseModelPickerData(`model_picked:${SESSION_ID}:nope`)).toBeNull();
    expect(parseModelPickerData(`model_picked:${SESSION_ID}`)).toBeNull();
    expect(parseModelPickerData("reasoning_picker:session")).toBeNull();
    expect(parseModelPickerData(undefined)).toBeNull();
  });
});

describe("reasoning model picker (enhance/revise)", () => {
  it("maps reasoning codes to adapter types with provider labels", () => {
    expect(REASONING_SHORT_CODES).toEqual([
      "cf0",
      "poll",
      "byn",
      "orF",
      "orIn",
      "orLa",
      "orGl",
      "orM3",
    ]);
    expect(REASONING_CODE_TO_ADAPTER["cf0"]).toBe("openai_compatible");
    expect(REASONING_CODE_TO_ADAPTER["poll"]).toBe("pollinations");
    expect(REASONING_CODE_TO_ADAPTER["byn"]).toBe("bynara");
    expect(REASONING_CODE_TO_ADAPTER["orF"]).toBe("openrouter_free");
    expect(REASONING_CODE_TO_ADAPTER["orM3"]).toBe("openrouter_m3");
    expect(REASONING_ADAPTER_TO_CODE["openrouter_laguna"]).toBe("orLa");
    expect(REASONING_CODE_LABEL["cf0"]).toContain("Cloudflare");
    expect(REASONING_CODE_LABEL["orM3"]).toContain("MiniMax M3");
  });

  it("callback data stays under the 64-byte Telegram limit", () => {
    const longSession = "00000000-1111-2222-3333-444455556666";
    for (const code of REASONING_SHORT_CODES) {
      expect(buildReasoningPickedCallback(code, longSession, true).length).toBeLessThanOrEqual(64);
    }
    expect(buildReasoningPickerCallback(longSession).length).toBeLessThanOrEqual(64);
  });

  it("renders the reasoning picker keyboard with picked/default callbacks", () => {
    const keyboard = reasoningPickerKeyboard(SESSION_ID, "orLa");
    const texts = keyboard.inline_keyboard.flatMap((row) => row.map((b) => b.text));
    for (const code of REASONING_SHORT_CODES) {
      expect(texts).toContain(REASONING_CODE_LABEL[code] + (code === "orLa" ? " ✓" : ""));
    }
    const defaults = keyboard.inline_keyboard
      .flatMap((row) => row.map((b) => b.callback_data))
      .filter((d) => d.startsWith("reasoning_default:"));
    expect(defaults).toHaveLength(REASONING_SHORT_CODES.length);
    expect(keyboard.inline_keyboard.at(-1)?.[0]?.text).toBe("Kembali");
  });

  it("round-trips reasoning picker callback data", () => {
    expect(parseReasoningPickerData(`reasoning_picker:${SESSION_ID}`)).toEqual({
      action: "reasoning_picker",
      sessionId: SESSION_ID,
    });
    expect(parseReasoningPickerData(buildReasoningPickedCallback("cf0", SESSION_ID))).toEqual({
      action: "reasoning_picked",
      code: "cf0",
      sessionId: SESSION_ID,
    });
    expect(parseReasoningPickerData(buildReasoningPickedCallback("byn", SESSION_ID, true))).toEqual(
      { action: "reasoning_default", code: "byn", sessionId: SESSION_ID },
    );
    expect(parseReasoningPickerData(`reasoning_picker_back:${SESSION_ID}`)).toEqual({
      action: "reasoning_picker_back",
      sessionId: SESSION_ID,
    });
    expect(parseReasoningPickerData(`reasoning_picked:${SESSION_ID}:nope`)).toBeNull();
    expect(parseReasoningPickerData(`reasoning_picked:${SESSION_ID}`)).toBeNull();
    expect(parseReasoningPickerData(`model_picker:${SESSION_ID}`)).toBeNull();
    expect(parseReasoningPickerData(undefined)).toBeNull();
  });

  it("confirmation and result keyboards carry both picker rows", () => {
    const confirmation = confirmationKeyboardWithModel(SESSION_ID, "flux", "cf0");
    expect(confirmation.inline_keyboard).toHaveLength(3);
    expect(confirmation.inline_keyboard[1][0].text).toContain("Flux Schnell");
    expect(confirmation.inline_keyboard[2][0].text).toContain("Cloudflare gpt-oss-120b");
    expect(confirmation.inline_keyboard[2][0].callback_data).toBe(
      buildReasoningPickerCallback(SESSION_ID),
    );

    const noSelection = confirmationKeyboard(SESSION_ID);
    expect(noSelection.inline_keyboard).toHaveLength(3);
    expect(noSelection.inline_keyboard[1][0].text).toBe("Pilih Model");
    expect(noSelection.inline_keyboard[2][0].text).toBe("Pilih Reasoning");

    const result = resultKeyboardWithModel(SESSION_ID, "axgm", "orF");
    expect(result.inline_keyboard).toHaveLength(3);
    expect(result.inline_keyboard[1][0].text).toContain("Aichixia Gemini 3 Pro");
    expect(result.inline_keyboard[2][0].text).toBe("Reasoning: OpenRouter Free Router ✓");

    const resultNoReasoning = resultKeyboard(SESSION_ID);
    expect(resultNoReasoning.inline_keyboard[2][0].text).toBe("Ganti Reasoning");
  });
});
