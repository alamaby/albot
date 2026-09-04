// Inline keyboard builders for the confirmation message (Milestone 4).
// Callback data is `action:sessionId` (session ids are UUIDs, well under the
// 64-byte callback data limit). The parser is strict: data that does not match
// a known action is rejected so the webhook never acts on foreign data.
//
// DB-driven labels: button texts come from DEFAULT_KEYBOARD_LABELS; pass
// `labels` (merged DB overrides from the bot_keyboards prompt config) to
// render customized text. The sync builders default to the hardcoded labels
// so unit tests stay pure; use getKeyboardLabels() for the DB-driven map.

export type KeyboardLabels = Record<string, string>;

export const DEFAULT_KEYBOARD_LABELS: KeyboardLabels = {
  generate: "Generate",
  revise: "Revise Lagi",
  cancel: "Batal",
  pick_model: "Pilih Model",
  pick_reasoning: "Pilih Reasoning",
  change_model: "Ganti Model",
  change_reasoning: "Ganti Reasoning",
  regenerate: "Regenerate",
  revise_prompt: "Revise Prompt",
  done: "Selesai",
  back: "Kembali",
  retry: "Coba Lagi",
  new_prompt: "Prompt Baru",
  model_picked: "Model: {label} ✓",
  reasoning_picked: "Reasoning: {label} ✓",
};

function label(labels: KeyboardLabels | undefined, key: string): string {
  const v = labels?.[key];
  return typeof v === "string" && v.length > 0 ? v : (DEFAULT_KEYBOARD_LABELS[key] ?? key);
}

function renderLabel(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars[key] !== undefined ? vars[key] : match,
  );
}

export async function getKeyboardLabels(
  explicit?: KeyboardLabels,
): Promise<KeyboardLabels | undefined> {
  if (explicit) return explicit;
  const { BotTextRepository } = await import("@/server/repositories/bot-text.repository");
  const repo = new BotTextRepository();
  const overrides = await repo.getKeyboardLabels();
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

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

// Reasoning (enhance/revise) model picker actions.
// NOTE: "reasoning_default" (not "reasoning_picked_default") keeps the callback
// data under Telegram's 64-byte limit: `reasoning_default:<uuid>:orM3` = 59.
export const REASONING_PICKER_ACTIONS = [
  "reasoning_picker",
  "reasoning_picked",
  "reasoning_default",
  "reasoning_picker_back",
] as const;
export type ReasoningPickerAction = (typeof REASONING_PICKER_ACTIONS)[number];

export const MODEL_SHORT_CODES = [
  "flux",
  "a20f",
  "a21f",
  "nbn",
  "axf2",
  "axlc",
  "axph",
  "axgm",
] as const;
export type ModelShortCode = (typeof MODEL_SHORT_CODES)[number];

export const MODEL_CODE_TO_ADAPTER: Record<ModelShortCode, string> = {
  flux: "pixazo_flux_schnell",
  a20f: "bynara_a20f",
  a21f: "bynara_a21f",
  nbn: "bynara_nbn",
  axf2: "aichixia_flux2",
  axlc: "aichixia_lucid",
  axph: "aichixia_phoenix",
  axgm: "aichixia_gemini",
};

export const ADAPTER_TO_MODEL_CODE: Record<string, ModelShortCode> = {
  pixazo_flux_schnell: "flux",
  bynara_a20f: "a20f",
  bynara_a21f: "a21f",
  bynara_nbn: "nbn",
  aichixia_flux2: "axf2",
  aichixia_lucid: "axlc",
  aichixia_phoenix: "axph",
  aichixia_gemini: "axgm",
};

export const MODEL_CODE_LABEL: Record<ModelShortCode, string> = {
  flux: "Flux Schnell",
  a20f: "Agnes 2.0 Flash",
  a21f: "Agnes 2.1 Flash",
  nbn: "Nano Banana Pro",
  axf2: "Aichixia Flux 2 Dev",
  axlc: "Aichixia Lucid Origin",
  axph: "Aichixia Phoenix 1.0",
  axgm: "Aichixia Gemini 3 Pro",
};

// Reasoning (enhance/revise) model picker. One short code per reasoning
// adapter_type. The "reasoning_default" action (rather than a longer
// "_picked_default" name) keeps the callback data under the 64-byte limit:
// `reasoning_default:<uuid>:orM3` = 59 bytes.
export const REASONING_SHORT_CODES = [
  "cf0",
  "poll",
  "byn",
  "ag25",
  "mm3f",
  "mm35",
  "ms12",
  "qw38",
  "orF",
  "orIn",
  "orLa",
  "orGl",
  "orM3",
] as const;
export type ReasoningShortCode = (typeof REASONING_SHORT_CODES)[number];

export const REASONING_CODE_TO_ADAPTER: Record<ReasoningShortCode, string> = {
  cf0: "openai_compatible",
  poll: "pollinations",
  byn: "bynara",
  ag25: "bynara_ag25",
  mm3f: "bynara_mm3f",
  mm35: "bynara_mm35",
  ms12: "bynara_ms12",
  qw38: "bynara_qw38",
  orF: "openrouter_free",
  orIn: "openrouter_ing",
  orLa: "openrouter_laguna",
  orGl: "openrouter_glm",
  orM3: "openrouter_m3",
};

export const REASONING_ADAPTER_TO_CODE: Record<string, ReasoningShortCode> = {
  openai_compatible: "cf0",
  pollinations: "poll",
  bynara: "byn",
  bynara_ag25: "ag25",
  bynara_mm3f: "mm3f",
  bynara_mm35: "mm35",
  bynara_ms12: "ms12",
  bynara_qw38: "qw38",
  openrouter_free: "orF",
  openrouter_ing: "orIn",
  openrouter_laguna: "orLa",
  openrouter_glm: "orGl",
  openrouter_m3: "orM3",
};

export const REASONING_CODE_LABEL: Record<ReasoningShortCode, string> = {
  cf0: "Cloudflare gpt-oss-120b",
  poll: "Pollinations gpt-oss",
  byn: "Bynara laguna-s-2.1",
  ag25: "Bynara Agnes 2.5 Flash",
  mm3f: "Bynara MiniMax M3 Free",
  mm35: "Bynara Mistral Medium 3.5",
  ms12: "Bynara Muse Spark 1.2",
  qw38: "Bynara Qwen 3.8 27B",
  orF: "OpenRouter Free Router",
  orIn: "OpenRouter Ling Flash",
  orLa: "OpenRouter Laguna",
  orGl: "OpenRouter GLM",
  orM3: "OpenRouter MiniMax M3",
};

export function buildCallbackData(
  action:
    ConfirmationAction | ResultAction | RetryAction | ModelPickerAction | ReasoningPickerAction,
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

export function buildReasoningPickedCallback(
  code: ReasoningShortCode,
  sessionId: string,
  asDefault = false,
): string {
  const action = asDefault ? "reasoning_default" : "reasoning_picked";
  return `${action}:${sessionId}:${code}`;
}

export function buildReasoningPickerCallback(sessionId: string): string {
  return `reasoning_picker:${sessionId}`;
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
  reasoningCode: ReasoningShortCode | null = null,
  labels?: KeyboardLabels,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const modelLabel = selectedCode ? MODEL_CODE_LABEL[selectedCode] : null;
  const pickerText = modelLabel
    ? renderLabel(label(labels, "model_picked"), { label: modelLabel })
    : label(labels, "pick_model");
  const reasoningLabel = reasoningCode ? REASONING_CODE_LABEL[reasoningCode] : null;
  const reasoningPickerText = reasoningLabel
    ? renderLabel(label(labels, "reasoning_picked"), { label: reasoningLabel })
    : label(labels, "pick_reasoning");
  return {
    inline_keyboard: [
      [
        {
          text: label(labels, "generate"),
          callback_data: buildCallbackData("generate", sessionId),
        },
        { text: label(labels, "revise"), callback_data: buildCallbackData("revise", sessionId) },
        { text: label(labels, "cancel"), callback_data: buildCallbackData("cancel", sessionId) },
      ],
      [{ text: pickerText, callback_data: buildModelPickerCallback(sessionId) }],
      [{ text: reasoningPickerText, callback_data: buildReasoningPickerCallback(sessionId) }],
    ],
  };
}

export function modelPickerKeyboard(
  sessionId: string,
  selectedCode: ModelShortCode | null,
  labels?: KeyboardLabels,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const rows = chunked(
    MODEL_SHORT_CODES.map((code) => {
      const isSelected = code === selectedCode;
      const label = MODEL_CODE_LABEL[code] + (isSelected ? " ✓" : "");
      return { text: label, callback_data: buildModelPickedCallback(code, sessionId, false) };
    }),
    2,
  );
  const defaultRows = chunked(
    MODEL_SHORT_CODES.map((code) => ({
      text: `${MODEL_CODE_LABEL[code]} ★`,
      callback_data: buildModelPickedCallback(code, sessionId, true),
    })),
    2,
  );
  return {
    inline_keyboard: [
      ...rows,
      ...defaultRows,
      [{ text: label(labels, "back"), callback_data: `model_picker_back:${sessionId}` }],
    ],
  };
}

// Reasoning model picker: choose the enhance/revise provider for this session,
// or set it as the per-user default (★). Same layout as the image picker.
export function reasoningPickerKeyboard(
  sessionId: string,
  selectedCode: ReasoningShortCode | null,
  labels?: KeyboardLabels,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const rows = chunked(
    REASONING_SHORT_CODES.map((code) => {
      const isSelected = code === selectedCode;
      const label = REASONING_CODE_LABEL[code] + (isSelected ? " ✓" : "");
      return { text: label, callback_data: buildReasoningPickedCallback(code, sessionId, false) };
    }),
    2,
  );
  const defaultRows = chunked(
    REASONING_SHORT_CODES.map((code) => ({
      text: `${REASONING_CODE_LABEL[code]} ★`,
      callback_data: buildReasoningPickedCallback(code, sessionId, true),
    })),
    2,
  );
  return {
    inline_keyboard: [
      ...rows,
      ...defaultRows,
      [{ text: label(labels, "back"), callback_data: `reasoning_picker_back:${sessionId}` }],
    ],
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
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
  reasoningCode: ReasoningShortCode | null = null,
  labels?: KeyboardLabels,
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const modelLabel = selectedCode ? MODEL_CODE_LABEL[selectedCode] : null;
  const pickerText = modelLabel
    ? renderLabel(label(labels, "model_picked"), { label: modelLabel })
    : label(labels, "change_model");
  const reasoningLabel = reasoningCode ? REASONING_CODE_LABEL[reasoningCode] : null;
  const reasoningPickerText = reasoningLabel
    ? renderLabel(label(labels, "reasoning_picked"), { label: reasoningLabel })
    : label(labels, "change_reasoning");
  return {
    inline_keyboard: [
      [
        {
          text: label(labels, "regenerate"),
          callback_data: buildCallbackData("regenerate", sessionId),
        },
        {
          text: label(labels, "revise_prompt"),
          callback_data: buildCallbackData("revise", sessionId),
        },
        { text: label(labels, "done"), callback_data: buildCallbackData("complete", sessionId) },
      ],
      [{ text: pickerText, callback_data: buildModelPickerCallback(sessionId) }],
      [{ text: reasoningPickerText, callback_data: buildReasoningPickerCallback(sessionId) }],
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

// Strict parser for reasoning-picker callback data (reasoning_picker /
// reasoning_picked / reasoning_default / reasoning_picker_back).
export function parseReasoningPickerData(
  data: string | undefined,
):
  | { action: "reasoning_picker"; sessionId: string }
  | { action: "reasoning_picked"; code: ReasoningShortCode; sessionId: string }
  | { action: "reasoning_default"; code: ReasoningShortCode; sessionId: string }
  | { action: "reasoning_picker_back"; sessionId: string }
  | null {
  if (!data || data.length > 64) return null;
  const parts = data.split(":");
  const action = parts[0];
  if (action === "reasoning_picker" && parts.length === 2 && parts[1]) {
    return { action: "reasoning_picker", sessionId: parts[1] };
  }
  if (action === "reasoning_picker_back" && parts.length === 2 && parts[1]) {
    return { action: "reasoning_picker_back", sessionId: parts[1] };
  }
  if (
    (action === "reasoning_picked" || action === "reasoning_default") &&
    parts.length === 3 &&
    parts[1] &&
    parts[2]
  ) {
    const code = parts[2] as ReasoningShortCode;
    if (!REASONING_SHORT_CODES.includes(code)) return null;
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
  options?: { showNewPrompt?: boolean; labels?: KeyboardLabels },
): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const labels = options?.labels;
  const row = [
    { text: label(labels, "retry"), callback_data: buildCallbackData("retry", sessionId) },
  ];
  if (options?.showNewPrompt) {
    row.push({
      text: label(labels, "new_prompt"),
      callback_data: buildCallbackData("cancel", sessionId),
    });
  }
  return { inline_keyboard: [row] };
}
