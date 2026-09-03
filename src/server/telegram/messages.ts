// User-facing Telegram message builders (Indonesian).
// Messages must never embed secrets, raw provider errors, or raw DB errors.
// Dynamic content is escaped for MarkdownV2 when sent as Markdown; the bot
// currently sends plain text so no escaping is required, but builders are the
// single place to change that later.

import type { EnhancedPromptStructured } from "@/server/providers/prompt-structure";

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
  | "content_policy_declined"
  | "session_cancelled"
  | "no_active_session"
  | "welcome"
  | "help"
  | "generate_usage"
  | "enhance_usage"
  | "enhance_only_received"
  | "enhance_only_failed"
  | "dispatch_failed";

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
      return "Gagal memproses prompt. Silakan coba lagi.";
    case "generation_failed":
      return "Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.";
    case "content_policy_declined":
      return "Prompt ditolak karena kebijakan konten provider. Ubah prompt dan coba lagi.";
    case "session_cancelled":
      return "Sesi dibatalkan.";
    case "no_active_session":
      return "Tidak ada sesi aktif untuk dibatalkan.";
    case "welcome":
      return [
        "Selamat datang! Saya membuat gambar dari prompt Anda.",
        "",
        COMMAND_HELP_TEXT,
        "",
        'Atau kirim teks biasa — prompt otomatis disempurnakan dulu, mis. "kucing oren duduk di atap saat senja".',
      ].join("\n");
    case "help":
      return [
        "Command yang tersedia:",
        "",
        COMMAND_HELP_TEXT,
        "",
        "Tanpa command: kirim teks biasa untuk flow lengkap dengan penyempurnaan prompt dan konfirmasi.",
      ].join("\n");
    case "generate_usage":
      return "Kirim /generate-image <prompt> untuk langsung membuat gambar tanpa penyempurnaan. Contoh: /generate-image kucing oren duduk di atap saat senja";
    case "enhance_usage":
      return "Kirim /enhance-prompt <prompt> untuk menyempurnakan prompt. Contoh: /enhance-prompt kucing oren duduk di atap saat senja";
    case "enhance_only_received":
      return "Sedang menyempurnakan prompt, mohon tunggu...";
    case "enhance_only_failed":
      return "Gagal menyempurnakan prompt. Silakan coba lagi.";
    case "dispatch_failed":
      return "Gagal memulai pemrosesan. Silakan coba lagi sebentar.";
  }
}

// Shared command list used by /start (welcome) and /help.
export const COMMAND_HELP_TEXT = [
  "/generate-image <prompt> — langsung buat gambar tanpa penyempurnaan",
  "/enhance-prompt <prompt> — sempurnakan prompt (hasil teks saja)",
  "/cancel atau /batal — batalkan sesi aktif",
  "/help — bantuan",
].join("\n");

// Enhance-only result: the enhanced prompt as plain copyable text. The
// optional `reasoningLine` (e.g. "Reasoning: Cloudflare gpt-oss-120b ✓") shows
// which enhance/revise provider produced the result — the session-less
// /enhance-prompt flow has no picker, so this is the only provider info shown.
export function buildEnhanceOnlyMessage(
  prompt: EnhancedPromptStructured,
  reasoningLine?: string | null,
): string {
  const lines = ["✨ Prompt hasil penyempurnaan:", "", prompt.prompt];
  if (prompt.negative_prompt) {
    lines.push("", `Negative prompt: ${prompt.negative_prompt}`);
  }
  if (prompt.aspect_ratio) {
    lines.push("", `Aspect ratio: ${prompt.aspect_ratio}`);
  }
  if (reasoningLine) {
    lines.push("", reasoningLine);
  }
  lines.push(
    "",
    "—",
    "",
    "Salin prompt di atas, lalu kirim /generate-image <prompt> untuk membuat gambar.",
  );
  return lines.join("\n");
}

// Enhanced prompt confirmation message. Shows the (user-editable) enhanced
// prompt with the confirmation actions. The prompt text is plain text so no
// markdown escaping is needed; the inline keyboard carries the session id.
export function buildEnhancedPromptMessage(input: {
  enhancedPrompt: string;
  revisionNumber: number;
  sourcePrompt: string;
  selectedModelLabel?: string | null;
  reasoningProviderLabel?: string | null;
  reasoningModel?: string | null;
  imageModelLabel?: string | null;
}): string {
  const lines = [
    `Prompt yang akan digunakan (revisi ${input.revisionNumber}):`,
    "",
    input.enhancedPrompt,
    "",
    "—",
  ];
  const reasoningLine = formatReasoningLine(input.reasoningProviderLabel, input.reasoningModel);
  if (reasoningLine) {
    lines.push("", reasoningLine);
  }
  const imageLabel = input.imageModelLabel ?? input.selectedModelLabel ?? null;
  if (imageLabel) {
    lines.push("", `Model gambar: ${imageLabel} ✓`);
  }
  lines.push("", "Pilih aksi di bawah untuk melanjutkan.");
  return lines.join("\n");
}

function formatReasoningLine(providerLabel?: string | null, model?: string | null): string | null {
  const p = providerLabel?.trim() ?? "";
  const m = model?.trim() ?? "";
  if (!p && !m) return null;
  if (p && m) {
    if (p === m || p.includes(m)) return `Reasoning: ${p}`;
    return `Reasoning: ${p} · ${m}`;
  }
  return `Reasoning: ${p || m}`;
}

function formatImageLine(label?: string | null): string | null {
  const l = label?.trim() ?? "";
  if (!l) return null;
  return `Model: ${l}`;
}

export function buildModelPickerMessage(selectedLabel?: string | null): string {
  if (selectedLabel) return `Pilih model gambar. Saat ini: ${selectedLabel} ✓`;
  return "Pilih model gambar untuk sesi ini. Tap untuk memilih, tap ★ untuk jadikan default.";
}

export function buildModelSelectedMessage(label: string, isDefault: boolean): string {
  if (isDefault) return `Model diatur ke ${label} dan disimpan sebagai default ✓`;
  return `Model diatur ke ${label} ✓`;
}

export function buildReasoningPickerMessage(selectedLabel?: string | null): string {
  if (selectedLabel) return `Pilih model reasoning (enhance/revise). Saat ini: ${selectedLabel} ✓`;
  return "Pilih model reasoning untuk enhance/revise prompt. Tap untuk memilih, tap ★ untuk jadikan default.";
}

export function buildReasoningSelectedMessage(label: string, isDefault: boolean): string {
  if (isDefault)
    return `Reasoning diatur ke ${label} dan disimpan sebagai default ✓ (dipakai untuk enhance/revise berikutnya)`;
  return `Reasoning diatur ke ${label} ✓ (dipakai untuk enhance/revise berikutnya)`;
}

// Caption for a generated image. Shows which attempt produced which revision.
export function buildResultCaption(input: {
  attemptNumber: number;
  revisionNumber: number;
  reasoningProviderLabel?: string | null;
  reasoningModel?: string | null;
  imageModelLabel?: string | null;
}): string {
  const base = `Gambar ${input.attemptNumber} dari revisi ${input.revisionNumber}.`;
  const lines = [base];
  const reasoningLine = formatReasoningLine(input.reasoningProviderLabel, input.reasoningModel);
  if (reasoningLine) lines.push(reasoningLine);
  const imageLine = formatImageLine(input.imageModelLabel);
  if (imageLine) lines.push(imageLine);
  return lines.join("\n");
}

// Single persisted status message for image generation: sent once when the
// user taps Generate/Regenerate and edited to the final outcome so the user
// always knows the job is running, done, or failed.
export type GenerationStatusKind =
  "generating" | "succeeded" | "failed" | "expired" | "succeeded_generic";

export function buildGenerationStatusMessage(
  kind: GenerationStatusKind,
  input?: {
    attemptNumber: number;
    revisionNumber: number;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
  },
): string {
  switch (kind) {
    case "generating":
      return "Sedang membuat gambar, mohon tunggu...";
    case "succeeded": {
      const base = `Gambar ${input?.attemptNumber} dari revisi ${input?.revisionNumber} berhasil dibuat.`;
      const lines = [base];
      const reasoningLine = formatReasoningLine(
        input?.reasoningProviderLabel ?? null,
        input?.reasoningModel ?? null,
      );
      if (reasoningLine) lines.push(reasoningLine);
      const imageLine = formatImageLine(input?.imageModelLabel ?? null);
      if (imageLine) lines.push(imageLine);
      if (lines.length > 1) return lines.join("\n");
      return base;
    }
    case "succeeded_generic": {
      const imageLine = formatImageLine(input?.imageModelLabel ?? null);
      if (imageLine) return `Gambar berhasil dibuat.\n${imageLine}`;
      return "Gambar berhasil dibuat.";
    }
    case "failed":
      return "Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.";
    case "expired":
      return "Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru.";
  }
}
