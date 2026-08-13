// User-facing Telegram message builders (Indonesian).
// Messages must never embed secrets, raw provider errors, or raw DB errors.
// Dynamic content is escaped for MarkdownV2 when sent as Markdown; the bot
// currently sends plain text so no escaping is required, but builders are the
// single place to change that later.

export type BotMessage =
  | "access_denied"
  | "prompt_too_long"
  | "active_session_exists"
  | "rate_limited"
  | "prompt_received"
  | "callback_acknowledged";

export function buildBotMessage(
  kind: BotMessage,
  options?: { maxPromptLength?: number; rateLimitWindowMinutes?: number; rateLimitMax?: number },
): string {
  const maxPromptLength = options?.maxPromptLength ?? 4000;
  const rateLimitWindowMinutes = options?.rateLimitWindowMinutes ?? 10;
  const rateLimitMax = options?.rateLimitMax ?? 5;

  switch (kind) {
    case "access_denied":
      return "Akses ditolak. Akun Telegram Anda belum terdaftar.";
    case "prompt_too_long":
      return `Prompt terlalu panjang. Maksimal ${maxPromptLength} karakter.`;
    case "active_session_exists":
      return "Masih ada sesi aktif. Selesaikan atau batalkan sesi sebelumnya terlebih dahulu.";
    case "rate_limited":
      return `Terlalu banyak permintaan. Maksimal ${rateLimitMax} prompt per ${rateLimitWindowMinutes} menit.`;
    case "prompt_received":
      return "Prompt diterima. Sedang dalam antrian...";
    case "callback_acknowledged":
      return "Diterima.";
  }
}
