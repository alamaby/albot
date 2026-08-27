// Inline keyboard builders for the confirmation message (Milestone 4).
// Callback data is `action:sessionId` (session ids are UUIDs, well under the
// 64-byte callback data limit). The parser is strict: data that does not match
// a known action is rejected so the webhook never acts on foreign data.

export const CONFIRMATION_ACTIONS = ["generate", "revise", "cancel"] as const;
export type ConfirmationAction = (typeof CONFIRMATION_ACTIONS)[number];

// Result actions shown after an image is generated (Milestone 5).
export const RESULT_ACTIONS = ["regenerate", "revise", "complete"] as const;
export type ResultAction = (typeof RESULT_ACTIONS)[number];

// Retry action shown after a terminal enhancement failure (Milestone 7 fix).
export const RETRY_ACTIONS = ["retry"] as const;
export type RetryAction = (typeof RETRY_ACTIONS)[number];

// Model picker actions for Pixazo PixelForge hybrid selection.
export const MODEL_PICKER_ACTIONS = [
  "model_picker",
  "model_picked",
  "model_picked_default",
  "model_picker_back",
] as const;
export type ModelPickerAction = (typeof MODEL_PICKER_ACTIONS)[number];

export const MODEL_SHORT_CODES = ["flux", "sdxl"] as const;
export type ModelShortCode = (typeof MODEL_SHORT_CODES)[number];

export const MODEL_CODE_TO_ADAPTER: Record<ModelShortCode, string> = {
  flux: "pixazo_flux_schnell",
  sdxl: "pixazo_sdxl",
};

export const ADAPTER_TO_MODEL_CODE: Record<string, ModelShortCode> = {
  pixazo_flux_schnell: "flux",
  pixazo_sdxl: "sdxl",
};

export const MODEL_CODE_LABEL: Record<ModelShortCode, string> = {
  flux: "Flux Schnell",
  sdxl: "SDXL",
};

export function buildCallbackData(
  action: ConfirmationAction | ResultAction | RetryAction | ModelPickerAction,
  sessionId: string,
): string {
  return `${action}:${sessionId}`;
}

export function buildModelPickedCallback(
  code: ModelShortCode,
  sessionId: string,
  asDefault = false,
): string {
  const action = asDefault ? "model_picked_default" : "model_picked";
  return `${action}:${sessionId}:${code}`;
}

export function buildModelPickerCallback(sessionId: string): string {
  return `model_picker:${sessionId}`;
}

// Returns the action and session id from callback data, or null when the data
// is not a valid confirmation callback for this bot.
export function parseConfirmationData(
  data: string | undefined,
): { action: ConfirmationAction; sessionId: string } | null {
  if (!data || data.length > 64) return null;
  const [action, sessionId, ...rest] = data.split(":");
  if (rest.length > 0 || !sessionId) return null;
  if (!CONFIRMATION_ACTIONS.includes(action as ConfirmationAction)) return null;
  return { action: action as ConfirmationAction, sessionId };
}

// Strict parser for result-action callback data (regenerate/revise/complete).
export function parseResultData(
  data: string | undefined,
): { action: ResultAction; sessionId: string } | null {
  if (!data || data.length > 64) return null;
  const [action, sessionId, ...rest] = data.split(":");
  if (rest.length > 0 || !sessionId) return null;
  if (!RESULT_ACTIONS.includes(action as ResultAction)) return null;
  return { action: action as ResultAction, sessionId };
}

// Strict parser for enhancement-retry callback data (retry).
export function parseRetryData(
  data: string | undefined,
): { action: RetryAction; sessionId: string } | null {
  if (!data || data.length > 64) return null;
  const [action, sessionId, ...rest] = data.split(":");
  if (rest.length > 0 || !sessionId) return null;
  if (!RETRY_ACTIONS.includes(action as RetryAction)) return null;
  return { action: action as RetryAction, sessionId };
}

export function confirmationKeyboard(sessionId: string): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return confirmationKeyboardWithModel(sessionId, null);
}

export function confirmationKeyboardWithModel(
  sessionId: string,
  selectedCode: ModelShortCode | null,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const modelLabel = selectedCode ? MODEL_CODE_LABEL[selectedCode] : null;
  const pickerText = modelLabel ? `Model: ${modelLabel} ✓` : "Pilih Model";
  return {
    inline_keyboard: [
      [
        { text: "Generate", callback_data: buildCallbackData("generate", sessionId) },
        { text: "Revise Lagi", callback_data: buildCallbackData("revise", sessionId) },
        { text: "Batal", callback_data: buildCallbackData("cancel", sessionId) },
      ],
      [{ text: pickerText, callback_data: buildModelPickerCallback(sessionId) }],
    ],
  };
}

export function modelPickerKeyboard(
  sessionId: string,
  selectedCode: ModelShortCode | null,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const row = MODEL_SHORT_CODES.map((code) => {
    const isSelected = code === selectedCode;
    const label = MODEL_CODE_LABEL[code] + (isSelected ? " ✓" : "");
    return { text: label, callback_data: buildModelPickedCallback(code, sessionId, false) };
  });
  const defaultRow = MODEL_SHORT_CODES.map((code) => ({
    text: `${MODEL_CODE_LABEL[code]} ★`,
    callback_data: buildModelPickedCallback(code, sessionId, true),
  }));
  return {
    inline_keyboard: [
      row,
      defaultRow,
      [{ text: "Kembali", callback_data: `model_picker_back:${sessionId}` }],
    ],
  };
}

// Result keyboard shown with the generated image: Regenerate / Revise Prompt /
// Selesai. `revise` reuses the confirmation action id so the parser already
// recognizes it.
export function resultKeyboard(sessionId: string): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return resultKeyboardWithModel(sessionId, null);
}

export function resultKeyboardWithModel(
  sessionId: string,
  selectedCode: ModelShortCode | null,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const modelLabel = selectedCode ? MODEL_CODE_LABEL[selectedCode] : null;
  const pickerText = modelLabel ? `Model: ${modelLabel} ✓` : "Ganti Model";
  return {
    inline_keyboard: [
      [
        { text: "Regenerate", callback_data: buildCallbackData("regenerate", sessionId) },
        { text: "Revise Prompt", callback_data: buildCallbackData("revise", sessionId) },
        { text: "Selesai", callback_data: buildCallbackData("complete", sessionId) },
      ],
      [{ text: pickerText, callback_data: buildModelPickerCallback(sessionId) }],
    ],
  };
}

export function parseModelPickerData(
  data: string | undefined,
):
  | { action: "model_picker"; sessionId: string }
  | { action: "model_picked"; code: ModelShortCode; sessionId: string }
  | { action: "model_picked_default"; code: ModelShortCode; sessionId: string }
  | { action: "model_picker_back"; sessionId: string }
  | null {
  if (!data || data.length > 64) return null;
  const parts = data.split(":");
  const action = parts[0];
  if (action === "model_picker" && parts.length === 2 && parts[1]) {
    return { action: "model_picker", sessionId: parts[1] };
  }
  if (action === "model_picker_back" && parts.length === 2 && parts[1]) {
    return { action: "model_picker_back", sessionId: parts[1] };
  }
  if (
    (action === "model_picked" || action === "model_picked_default") &&
    parts.length === 3 &&
    parts[1] &&
    parts[2]
  ) {
    const code = parts[2] as ModelShortCode;
    if (!MODEL_SHORT_CODES.includes(code)) return null;
    return { action, code, sessionId: parts[1] };
  }
  return null;
}

// Retry keyboard shown after a terminal enhancement failure: re-runs the
// enhancement of the same revision (retry) OR discards the failed session and
// starts fresh (new_prompt). newPrompt is shown when the failure is a
// content-policy refusal, which retrying the same input cannot resolve.
export function retryKeyboard(
  sessionId: string,
  options?: { showNewPrompt?: boolean },
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const row = [{ text: "Coba Lagi", callback_data: buildCallbackData("retry", sessionId) }];
  if (options?.showNewPrompt) {
    row.push({ text: "Prompt Baru", callback_data: buildCallbackData("cancel", sessionId) });
  }
  return { inline_keyboard: [row] };
}
