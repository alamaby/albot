// Inline keyboard builders for the confirmation message (Milestone 4).
// Callback data is `action:sessionId` (session ids are UUIDs, well under the
// 64-byte callback data limit). The parser is strict: data that does not match
// a known action is rejected so the webhook never acts on foreign data.

export const CONFIRMATION_ACTIONS = ["generate", "revise", "cancel"] as const;
export type ConfirmationAction = (typeof CONFIRMATION_ACTIONS)[number];

// Result actions shown after an image is generated (Milestone 5).
export const RESULT_ACTIONS = ["regenerate", "revise", "complete"] as const;
export type ResultAction = (typeof RESULT_ACTIONS)[number];

export function buildCallbackData(
  action: ConfirmationAction | ResultAction,
  sessionId: string,
): string {
  return `${action}:${sessionId}`;
}

// Returns the action and session id from callback data, or null when the data
// is not a valid confirmation callback for this bot.
export function parseConfirmationData(
  data: string | undefined,
): { action: ConfirmationAction; sessionId: string } | null {
  if (!data) return null;
  const [action, sessionId, ...rest] = data.split(":");
  if (rest.length > 0 || !sessionId) return null;
  if (!CONFIRMATION_ACTIONS.includes(action as ConfirmationAction)) return null;
  return { action: action as ConfirmationAction, sessionId };
}

// Strict parser for result-action callback data (regenerate/revise/complete).
export function parseResultData(
  data: string | undefined,
): { action: ResultAction; sessionId: string } | null {
  if (!data) return null;
  const [action, sessionId, ...rest] = data.split(":");
  if (rest.length > 0 || !sessionId) return null;
  if (!RESULT_ACTIONS.includes(action as ResultAction)) return null;
  return { action: action as ResultAction, sessionId };
}

export function confirmationKeyboard(sessionId: string): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: [
      [
        { text: "Generate", callback_data: buildCallbackData("generate", sessionId) },
        { text: "Revise Lagi", callback_data: buildCallbackData("revise", sessionId) },
        { text: "Batal", callback_data: buildCallbackData("cancel", sessionId) },
      ],
    ],
  };
}

// Result keyboard shown with the generated image: Regenerate / Revise Prompt /
// Selesai. `revise` reuses the confirmation action id so the parser already
// recognizes it.
export function resultKeyboard(sessionId: string): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: [
      [
        { text: "Regenerate", callback_data: buildCallbackData("regenerate", sessionId) },
        { text: "Revise Prompt", callback_data: buildCallbackData("revise", sessionId) },
        { text: "Selesai", callback_data: buildCallbackData("complete", sessionId) },
      ],
    ],
  };
}
