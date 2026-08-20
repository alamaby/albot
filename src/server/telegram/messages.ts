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
  | "callback_acknowledged"
  | "revision_instruction_too_long"
  | "session_expired"
  | "enhancement_failed"
  | "generation_failed"
  | "session_cancelled";

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
    case "revision_instruction_too_long":
      return `Instruksi revisi terlalu panjang. Maksimal ${maxPromptLength} karakter.`;
    case "session_expired":
      return "Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru.";
    case "enhancement_failed":
      return "Gagal memproses prompt. Silakan coba lagi nanti.";
    case "generation_failed":
      return "Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.";
    case "session_cancelled":
      return "Sesi dibatalkan.";
  }
}

// Enhanced prompt confirmation message. Shows the (user-editable) enhanced
// prompt with the confirmation actions. The prompt text is plain text so no
// markdown escaping is needed; the inline keyboard carries the session id.
export function buildEnhancedPromptMessage(input: {
  enhancedPrompt: string;
  revisionNumber: number;
  sourcePrompt: string;
}): string {
  return [
    `Prompt yang akan digunakan (revisi ${input.revisionNumber}):`,
    "",
    input.enhancedPrompt,
    "",
    "—",
    "",
    "Pilih aksi di bawah untuk melanjutkan.",
  ].join("\n");
}

// Caption for a generated image. Shows which attempt produced which revision.
export function buildResultCaption(input: {
  attemptNumber: number;
  revisionNumber: number;
}): string {
  return `Gambar ${input.attemptNumber} dari revisi ${input.revisionNumber}.`;
}

// Single persisted status message for image generation: sent once when the
// user taps Generate/Regenerate and edited to the final outcome so the user
// always knows the job is running, done, or failed.
export type GenerationStatusKind =
  "generating" | "succeeded" | "failed" | "expired" | "succeeded_generic";

export function buildGenerationStatusMessage(
  kind: GenerationStatusKind,
  input?: { attemptNumber: number; revisionNumber: number },
): string {
  switch (kind) {
    case "generating":
      return "Sedang membuat gambar, mohon tunggu...";
    case "succeeded":
      return `Gambar ${input?.attemptNumber} dari revisi ${input?.revisionNumber} berhasil dibuat.`;
    case "succeeded_generic":
      return "Gambar berhasil dibuat.";
    case "failed":
      return "Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.";
    case "expired":
      return "Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru.";
  }
}
