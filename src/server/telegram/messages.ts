// User-facing Telegram message builders (Indonesian).
// Failure messages may name the provider + model + error code + HTTP status +
// a redacted safeMessage snippet (see FailureContext). They must never embed
// secrets, raw upstream bodies, or raw DB errors — safeMessage is passed
// through redactSensitive and truncated before display.
// Dynamic content is escaped for MarkdownV2 when sent as Markdown; the bot
// currently sends plain text so no escaping is required, but builders are the
// single place to change that later.
//
// DB-driven text: every literal below is also exported as a DEFAULT_* map.
// The async get* wrappers merge DB overrides from prompt_configs
// (bot_messages / bot_templates) over these defaults and fall back silently
// to the defaults when the DB is unreachable, so the bot never goes silent.
// The sync build* functions stay pure (defaults + explicit overrides) and are
// what unit tests assert against.

import type { EnhancedPromptStructured } from "@/server/providers/prompt-structure";
import { redactSensitive } from "@/server/observability/redact";
import type { ProviderErrorShape } from "@/server/providers/errors";

// Display-safe failure attribution for user-facing error messages. Every field
// is optional: builders render only what is present, so callers without
// provider info (recovery sweeps, dispatch failures) keep the generic text.
export type FailureContext = {
  providerLabel?: string | null;
  model?: string | null;
  errorCode?: string | null;
  httpStatus?: number | null;
  safeMessage?: string | null;
};

// Max safeMessage characters embedded in a user-facing message. Upstream
// messages can echo user content; truncate so failures stay a short caption.
const FAILURE_MESSAGE_MAX = 200;

// Renders the provider + error detail lines appended below a generic failure
// sentence, or null when there is nothing safe to show. Pure logic, no I/O.
export function formatFailureDetail(ctx?: FailureContext | null): string | null {
  if (!ctx) return null;
  const lines: string[] = [];
  const p = ctx.providerLabel?.trim() ?? "";
  const m = ctx.model?.trim() ?? "";
  if (p || m) {
    lines.push(p && m && p !== m && !p.includes(m) ? `${p} · ${m}` : p || m);
  }
  const code = ctx.errorCode?.trim() ?? "";
  const status = ctx.httpStatus ?? null;
  const msg =
    ctx.safeMessage != null
      ? redactSensitive(ctx.safeMessage).trim().slice(0, FAILURE_MESSAGE_MAX)
      : "";
  const head = [code, status !== null ? `HTTP ${status}` : ""].filter(Boolean).join(" ");
  if (head || msg) {
    lines.push(msg ? (head ? `${head} — ${msg}` : msg) : head);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function withFailure(base: string, failure?: FailureContext | null): string {
  const detail = formatFailureDetail(failure);
  return detail ? `${base}\n${detail}` : base;
}

// Builds a FailureContext from a normalized provider error. Providers without
// attribution (unknown fallbacks) yield a code-only context.
export function failureContextFromError(error: ProviderErrorShape): FailureContext {
  return {
    providerLabel: error.providerLabel ?? null,
    model: error.providerModel ?? null,
    errorCode: error.code,
    httpStatus: error.httpStatus ?? null,
    safeMessage: error.safeMessage,
  };
}

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
  | "dispatch_failed"
  | "cancel_in_progress"
  | "cancel_failed"
  | "revision_processing"
  | "revision_reprocessing"
  | "callback_send_failed"
  | "callback_regenerate_failed"
  | "callback_complete_failed"
  | "callback_model_failed"
  | "callback_reasoning_failed"
  | "retrying"
  | "session_busy"
  | "model_invalid"
  | "model_unavailable"
  | "model_cooldown"
  | "ack_pick_model"
  | "ack_pick_reasoning"
  | "ack_back"
  | "session_expired_short"
  | "no_active_revision"
  | "generate_starting"
  | "generate_restarting"
  | "revise_hint"
  | "revise_instructions"
  | "session_cancelled_new"
  | "session_done"
  | "session_done_thanks"
  | "active_session_exists_new";

// Simple (single-sentence) templates. Placeholders: {maxPromptLength},
// {rateLimitMax}, {rateLimitWindowMinutes}. Composite messages (welcome/help)
// live in DEFAULT_BOT_TEMPLATES.
export const DEFAULT_BOT_MESSAGES: Record<string, string> = {
  access_denied: "Akses ditolak. Akun Telegram Anda belum terdaftar.",
  prompt_too_long: "Prompt terlalu panjang. Maksimal {maxPromptLength} karakter.",
  active_session_exists:
    "Masih ada sesi aktif. Selesaikan atau batalkan sesi sebelumnya terlebih dahulu.",
  rate_limited:
    "Terlalu banyak permintaan. Maksimal {rateLimitMax} prompt per {rateLimitWindowMinutes} menit.",
  prompt_received: "Prompt diterima. Sedang dalam antrian...",
  callback_acknowledged: "Diterima.",
  revision_instruction_too_long:
    "Instruksi revisi terlalu panjang. Maksimal {maxPromptLength} karakter.",
  session_expired: "Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru.",
  enhancement_failed: "Gagal memproses prompt. Silakan coba lagi.",
  generation_failed: "Gagal membuat gambar. Silakan coba Regenerate atau kirim prompt baru.",
  content_policy_declined:
    "Prompt ditolak karena kebijakan konten provider. Ubah prompt dan coba lagi.",
  session_cancelled: "Sesi dibatalkan.",
  no_active_session: "Tidak ada sesi aktif untuk dibatalkan.",
  generate_usage:
    "Kirim /generate-image <prompt> untuk langsung membuat gambar tanpa penyempurnaan. Contoh: /generate-image kucing oren duduk di atap saat senja",
  enhance_usage:
    "Kirim /enhance-prompt <prompt> untuk menyempurnakan prompt. Contoh: /enhance-prompt kucing oren duduk di atap saat senja",
  enhance_only_received: "Sedang menyempurnakan prompt, mohon tunggu...",
  enhance_only_failed: "Gagal menyempurnakan prompt. Silakan coba lagi.",
  dispatch_failed: "Gagal memulai pemrosesan. Silakan coba lagi sebentar.",
  cancel_in_progress: "Sesi sedang diproses. Coba lagi sebentar.",
  cancel_failed: "Gagal membatalkan sesi. Coba lagi.",
  revision_processing: "Sedang memproses revisi...",
  revision_reprocessing: "Sedang memproses ulang prompt, mohon tunggu...",
  callback_send_failed: "Gagal mengirim permintaan. Coba lagi.",
  callback_regenerate_failed: "Gagal memulai ulang dengan model baru. Coba lagi.",
  callback_complete_failed: "Gagal menyelesaikan sesi. Coba lagi.",
  callback_model_failed: "Gagal mengatur model. Coba lagi.",
  callback_reasoning_failed: "Gagal mengatur model reasoning. Coba lagi.",
  retrying: "Mencoba lagi...",
  session_busy: "Sesi sedang diproses.",
  model_invalid: "Model tidak valid.",
  model_unavailable: "Model tidak tersedia. Pilih lain.",
  model_cooldown: "Model sedang cooldown, pilih lain.",
  ack_pick_model: "Pilih model",
  ack_pick_reasoning: "Pilih model reasoning",
  ack_back: "Kembali",
  session_expired_short: "Sesi telah berakhir. Kirim prompt baru.",
  no_active_revision: "Belum ada revisi aktif.",
  generate_starting: "Mulai membuat gambar...",
  generate_restarting: "Mulai membuat gambar lagi...",
  revise_hint: "Silakan kirim instruksi revisi.",
  revise_instructions:
    "Kirim instruksi revisi Anda. Contoh: buat lebih terang, tambah awan, ubah warna.",
  session_cancelled_new: "Sesi dibatalkan. Kirim prompt baru untuk membuat gambar.",
  session_done: "Sesi selesai.",
  session_done_thanks: "Sesi selesai. Terima kasih sudah menggunakan bot ini!",
  active_session_exists_new:
    "Masih ada sesi aktif. Selesaikan atau batalkan sesi baru terlebih dahulu.",
};

// Shared command list used by /start (welcome) and /help.
export const COMMAND_HELP_TEXT = [
  "/generate-image <prompt> — langsung buat gambar tanpa penyempurnaan",
  "/enhance-prompt <prompt> — sempurnakan prompt (hasil teks saja)",
  "/cancel atau /batal — batalkan sesi aktif",
  "/help — bantuan",
].join("\n");

// Composite templates. Placeholders: {revisionNumber}, {attempt}, {revision},
// {label}, {value}.
export const DEFAULT_BOT_TEMPLATES: Record<string, string> = {
  command_help: COMMAND_HELP_TEXT,
  welcome_1: "Selamat datang! Saya membuat gambar dari prompt Anda.",
  welcome_2:
    'Atau kirim teks biasa — prompt otomatis disempurnakan dulu, mis. "kucing oren duduk di atap saat senja".',
  help_1: "Command yang tersedia:",
  help_2:
    "Tanpa command: kirim teks biasa untuk flow lengkap dengan penyempurnaan prompt dan konfirmasi.",
  enhance_only_header: "✨ Prompt hasil penyempurnaan:",
  enhance_only_negative: "Negative prompt: {value}",
  enhance_only_aspect: "Aspect ratio: {value}",
  enhance_only_footer:
    "Salin prompt di atas, lalu kirim /generate-image <prompt> untuk membuat gambar.",
  confirmation_header: "Prompt yang akan digunakan (revisi {revisionNumber}):",
  confirmation_reasoning: "Reasoning: {label}",
  confirmation_image: "Model gambar: {label} ✓",
  confirmation_footer: "Pilih aksi di bawah untuk melanjutkan.",
  picker_model:
    "Pilih model gambar untuk sesi ini. Tap untuk memilih, tap ★ untuk jadikan default.",
  picker_model_selected: "Pilih model gambar. Saat ini: {label} ✓",
  picker_model_set: "Model diatur ke {label} ✓",
  picker_model_set_default: "Model diatur ke {label} dan disimpan sebagai default ✓",
  picker_reasoning:
    "Pilih model reasoning untuk enhance/revise prompt. Tap untuk memilih, tap ★ untuk jadikan default.",
  picker_reasoning_selected: "Pilih model reasoning (enhance/revise). Saat ini: {label} ✓",
  picker_reasoning_set: "Reasoning diatur ke {label} ✓ (dipakai untuk enhance/revise berikutnya)",
  picker_reasoning_set_default:
    "Reasoning diatur ke {label} dan disimpan sebagai default ✓ (dipakai untuk enhance/revise berikutnya)",
  result_caption: "Gambar {attempt} dari revisi {revision}.",
  result_image_line: "Model: {label}",
  status_generating: "Sedang membuat gambar, mohon tunggu...",
  status_succeeded: "Gambar {attempt} dari revisi {revision} berhasil dibuat.",
  status_succeeded_generic: "Gambar berhasil dibuat.",
  reshow_model_selected: "Model terpilih: {label} ✓",
  reshow_fallback: "Pilih aksi untuk melanjutkan.",
};

export type BotTextOverrides = {
  messages?: Record<string, string>;
  templates?: Record<string, string>;
};

function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : match,
  );
}

function pick(
  overrides: BotTextOverrides | undefined,
  map: "messages" | "templates",
  key: string,
  fallback: string,
): string {
  const o = overrides?.[map]?.[key];
  return typeof o === "string" && o.length > 0 ? o : fallback;
}

export function buildBotMessage(
  kind: BotMessage,
  options?: {
    maxPromptLength?: number;
    rateLimitWindowMinutes?: number;
    rateLimitMax?: number;
    failure?: FailureContext | null;
    overrides?: BotTextOverrides;
  },
): string {
  const maxPromptLength = options?.maxPromptLength ?? 4000;
  const rateLimitWindowMinutes = options?.rateLimitWindowMinutes ?? 10;
  const rateLimitMax = options?.rateLimitMax ?? 5;
  const overrides = options?.overrides;

  const msg = (key: string): string =>
    renderTemplate(pick(overrides, "messages", key, DEFAULT_BOT_MESSAGES[key]), {
      maxPromptLength,
      rateLimitMax,
      rateLimitWindowMinutes,
    });
  const tpl = (key: string, vars: Record<string, string | number> = {}): string =>
    renderTemplate(pick(overrides, "templates", key, DEFAULT_BOT_TEMPLATES[key]), vars);
  const commandHelp = pick(overrides, "templates", "command_help", COMMAND_HELP_TEXT);

  switch (kind) {
    case "access_denied":
    case "prompt_too_long":
    case "active_session_exists":
    case "rate_limited":
    case "prompt_received":
    case "callback_acknowledged":
    case "revision_instruction_too_long":
    case "session_expired":
    case "session_cancelled":
    case "no_active_session":
    case "generate_usage":
    case "enhance_usage":
    case "enhance_only_received":
    case "cancel_in_progress":
    case "cancel_failed":
    case "revision_processing":
    case "revision_reprocessing":
    case "callback_send_failed":
    case "callback_regenerate_failed":
    case "callback_complete_failed":
    case "callback_model_failed":
    case "callback_reasoning_failed":
    case "retrying":
    case "session_busy":
    case "model_invalid":
    case "model_unavailable":
    case "model_cooldown":
    case "ack_pick_model":
    case "ack_pick_reasoning":
    case "ack_back":
    case "session_expired_short":
    case "no_active_revision":
    case "generate_starting":
    case "generate_restarting":
    case "revise_hint":
    case "revise_instructions":
    case "session_cancelled_new":
    case "session_done":
    case "session_done_thanks":
    case "active_session_exists_new":
      return msg(kind);
    case "enhancement_failed":
      return withFailure(msg(kind), options?.failure);
    case "generation_failed":
      return withFailure(msg(kind), options?.failure);
    case "content_policy_declined":
      return withFailure(msg(kind), options?.failure);
    case "enhance_only_failed":
      return withFailure(msg(kind), options?.failure);
    case "dispatch_failed":
      return msg(kind);
    case "welcome":
      return [tpl("welcome_1"), "", commandHelp, "", tpl("welcome_2")].join("\n");
    case "help":
      return [tpl("help_1"), "", commandHelp, "", tpl("help_2")].join("\n");
  }
}

// Enhance-only result: the enhanced prompt as plain copyable text. The
// optional `reasoningLine` (e.g. "Reasoning: Cloudflare gpt-oss-120b ✓") shows
// which enhance/revise provider produced the result — the session-less
// /enhance-prompt flow has no picker, so this is the only provider info shown.
export function buildEnhanceOnlyMessage(
  prompt: EnhancedPromptStructured,
  reasoningLine?: string | null,
  overrides?: BotTextOverrides,
): string {
  const tpl = (key: string, vars: Record<string, string | number> = {}): string =>
    renderTemplate(pick(overrides, "templates", key, DEFAULT_BOT_TEMPLATES[key]), vars);
  const lines = [tpl("enhance_only_header"), "", prompt.prompt];
  if (prompt.negative_prompt) {
    lines.push("", tpl("enhance_only_negative", { value: prompt.negative_prompt }));
  }
  if (prompt.aspect_ratio) {
    lines.push("", tpl("enhance_only_aspect", { value: prompt.aspect_ratio }));
  }
  if (reasoningLine) {
    lines.push("", reasoningLine);
  }
  lines.push("", "—", "", tpl("enhance_only_footer"));
  return lines.join("\n");
}

// Enhanced prompt confirmation message. Shows the (user-editable) enhanced
// prompt with the confirmation actions. The prompt text is plain text so no
// markdown escaping is needed; the inline keyboard carries the session id.
export function buildEnhancedPromptMessage(
  input: {
    enhancedPrompt: string;
    revisionNumber: number;
    sourcePrompt: string;
    selectedModelLabel?: string | null;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
  },
  overrides?: BotTextOverrides,
): string {
  const tpl = (key: string, vars: Record<string, string | number> = {}): string =>
    renderTemplate(pick(overrides, "templates", key, DEFAULT_BOT_TEMPLATES[key]), vars);
  const lines = [
    tpl("confirmation_header", { revisionNumber: input.revisionNumber }),
    "",
    input.enhancedPrompt,
    "",
    "—",
  ];
  const reasoningLine = formatReasoningLine(
    input.reasoningProviderLabel,
    input.reasoningModel,
    overrides,
  );
  if (reasoningLine) {
    lines.push("", reasoningLine);
  }
  const imageLabel = input.imageModelLabel ?? input.selectedModelLabel ?? null;
  if (imageLabel) {
    lines.push("", tpl("confirmation_image", { label: imageLabel }));
  }
  lines.push("", tpl("confirmation_footer"));
  return lines.join("\n");
}

function formatReasoningLine(
  providerLabel?: string | null,
  model?: string | null,
  overrides?: BotTextOverrides,
): string | null {
  const p = providerLabel?.trim() ?? "";
  const m = model?.trim() ?? "";
  if (!p && !m) return null;
  const tpl = pick(
    overrides,
    "templates",
    "confirmation_reasoning",
    DEFAULT_BOT_TEMPLATES["confirmation_reasoning"],
  );
  if (p && m) {
    if (p === m || p.includes(m)) return renderTemplate(tpl, { label: p });
    return renderTemplate(tpl, { label: `${p} · ${m}` });
  }
  return renderTemplate(tpl, { label: p || m });
}

function formatImageLine(label?: string | null, overrides?: BotTextOverrides): string | null {
  const l = label?.trim() ?? "";
  if (!l) return null;
  return renderTemplate(
    pick(overrides, "templates", "result_image_line", DEFAULT_BOT_TEMPLATES["result_image_line"]),
    { label: l },
  );
}

export function buildModelPickerMessage(
  selectedLabel?: string | null,
  overrides?: BotTextOverrides,
): string {
  if (selectedLabel)
    return renderTemplate(
      pick(
        overrides,
        "templates",
        "picker_model_selected",
        DEFAULT_BOT_TEMPLATES["picker_model_selected"],
      ),
      { label: selectedLabel },
    );
  return pick(overrides, "templates", "picker_model", DEFAULT_BOT_TEMPLATES["picker_model"]);
}

export function buildModelSelectedMessage(
  label: string,
  isDefault: boolean,
  overrides?: BotTextOverrides,
): string {
  if (isDefault)
    return renderTemplate(
      pick(
        overrides,
        "templates",
        "picker_model_set_default",
        DEFAULT_BOT_TEMPLATES["picker_model_set_default"],
      ),
      { label },
    );
  return renderTemplate(
    pick(overrides, "templates", "picker_model_set", DEFAULT_BOT_TEMPLATES["picker_model_set"]),
    { label },
  );
}

export function buildReasoningPickerMessage(
  selectedLabel?: string | null,
  overrides?: BotTextOverrides,
): string {
  if (selectedLabel)
    return renderTemplate(
      pick(
        overrides,
        "templates",
        "picker_reasoning_selected",
        DEFAULT_BOT_TEMPLATES["picker_reasoning_selected"],
      ),
      { label: selectedLabel },
    );
  return pick(
    overrides,
    "templates",
    "picker_reasoning",
    DEFAULT_BOT_TEMPLATES["picker_reasoning"],
  );
}

export function buildReasoningSelectedMessage(
  label: string,
  isDefault: boolean,
  overrides?: BotTextOverrides,
): string {
  if (isDefault)
    return renderTemplate(
      pick(
        overrides,
        "templates",
        "picker_reasoning_set_default",
        DEFAULT_BOT_TEMPLATES["picker_reasoning_set_default"],
      ),
      { label },
    );
  return renderTemplate(
    pick(
      overrides,
      "templates",
      "picker_reasoning_set",
      DEFAULT_BOT_TEMPLATES["picker_reasoning_set"],
    ),
    { label },
  );
}

// Caption for a generated image. Shows which attempt produced which revision.
export function buildResultCaption(
  input: {
    attemptNumber: number;
    revisionNumber: number;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
  },
  overrides?: BotTextOverrides,
): string {
  const base = renderTemplate(
    pick(overrides, "templates", "result_caption", DEFAULT_BOT_TEMPLATES["result_caption"]),
    { attempt: input.attemptNumber, revision: input.revisionNumber },
  );
  const lines = [base];
  const reasoningLine = formatReasoningLine(
    input.reasoningProviderLabel,
    input.reasoningModel,
    overrides,
  );
  if (reasoningLine) lines.push(reasoningLine);
  const imageLine = formatImageLine(input.imageModelLabel, overrides);
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
    attemptNumber?: number;
    revisionNumber?: number;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
    failure?: FailureContext | null;
    overrides?: BotTextOverrides;
  },
): string {
  const overrides = input?.overrides;
  const tpl = (key: string, vars: Record<string, string | number> = {}): string =>
    renderTemplate(pick(overrides, "templates", key, DEFAULT_BOT_TEMPLATES[key]), vars);
  switch (kind) {
    case "generating":
      return tpl("status_generating");
    case "succeeded": {
      const base = tpl("status_succeeded", {
        attempt: input?.attemptNumber ?? 0,
        revision: input?.revisionNumber ?? 0,
      });
      const lines = [base];
      const reasoningLine = formatReasoningLine(
        input?.reasoningProviderLabel ?? null,
        input?.reasoningModel ?? null,
        overrides,
      );
      if (reasoningLine) lines.push(reasoningLine);
      const imageLine = formatImageLine(input?.imageModelLabel ?? null, overrides);
      if (imageLine) lines.push(imageLine);
      if (lines.length > 1) return lines.join("\n");
      return base;
    }
    case "succeeded_generic": {
      const imageLine = formatImageLine(input?.imageModelLabel ?? null, overrides);
      if (imageLine) return `${tpl("status_succeeded_generic")}\n${imageLine}`;
      return tpl("status_succeeded_generic");
    }
    case "failed":
      return withFailure(
        renderTemplate(
          pick(
            overrides,
            "messages",
            "generation_failed",
            DEFAULT_BOT_MESSAGES["generation_failed"],
          ),
          {},
        ),
        input?.failure,
      );
    case "expired":
      return renderTemplate(
        pick(overrides, "messages", "session_expired", DEFAULT_BOT_MESSAGES["session_expired"]),
        {},
      );
  }
}

// --- Async DB-driven wrappers -------------------------------------------
// Each loads prompt_configs overrides (bot_messages/bot_keyboards/bot_templates)
// and falls back to the hardcoded defaults above when the DB is unreachable.
// Pass `overrides` explicitly in tests to avoid DB access.

async function loadBotTextOverrides(
  explicit?: BotTextOverrides,
): Promise<BotTextOverrides | undefined> {
  if (explicit) return explicit;
  const { BotTextRepository } = await import("@/server/repositories/bot-text.repository");
  const repo = new BotTextRepository();
  const [messages, templates] = await Promise.all([
    repo.getMessageOverrides(),
    repo.getTemplateOverrides(),
  ]);
  if (Object.keys(messages).length === 0 && Object.keys(templates).length === 0) {
    return undefined;
  }
  return { messages, templates };
}

export async function getBotMessage(
  kind: BotMessage,
  options?: {
    maxPromptLength?: number;
    rateLimitWindowMinutes?: number;
    rateLimitMax?: number;
    failure?: FailureContext | null;
    overrides?: BotTextOverrides;
  },
): Promise<string> {
  const overrides = await loadBotTextOverrides(options?.overrides);
  return buildBotMessage(kind, { ...options, ...(overrides ? { overrides } : {}) });
}

export async function getGenerationStatusMessage(
  kind: GenerationStatusKind,
  input?: {
    attemptNumber?: number;
    revisionNumber?: number;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
    failure?: FailureContext | null;
    overrides?: BotTextOverrides;
  },
): Promise<string> {
  const overrides = await loadBotTextOverrides(input?.overrides);
  return buildGenerationStatusMessage(kind, {
    ...input,
    ...(overrides ? { overrides } : {}),
  });
}

export async function getEnhanceOnlyMessage(
  prompt: EnhancedPromptStructured,
  reasoningLine?: string | null,
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildEnhanceOnlyMessage(prompt, reasoningLine, resolved);
}

export async function getEnhancedPromptMessage(
  input: {
    enhancedPrompt: string;
    revisionNumber: number;
    sourcePrompt: string;
    selectedModelLabel?: string | null;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
  },
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildEnhancedPromptMessage(input, resolved);
}

export async function getModelPickerMessage(
  selectedLabel?: string | null,
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildModelPickerMessage(selectedLabel, resolved);
}

export async function getModelSelectedMessage(
  label: string,
  isDefault: boolean,
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildModelSelectedMessage(label, isDefault, resolved);
}

export async function getReasoningPickerMessage(
  selectedLabel?: string | null,
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildReasoningPickerMessage(selectedLabel, resolved);
}

export async function getReasoningSelectedMessage(
  label: string,
  isDefault: boolean,
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildReasoningSelectedMessage(label, isDefault, resolved);
}

// Ad-hoc template renderer for one-off DB-driven strings (e.g. reshow
// fallbacks). Falls back to the hardcoded default when the DB is unreachable.
export async function getBotTemplate(
  key: string,
  vars: Record<string, string | number> = {},
  fallback?: string,
): Promise<string> {
  const resolved = await loadBotTextOverrides(undefined);
  const tpl =
    resolved?.templates?.[key] && resolved.templates[key].length > 0
      ? resolved.templates[key]
      : (fallback ?? DEFAULT_BOT_TEMPLATES[key] ?? key);
  return renderTemplate(tpl, vars);
}

export async function getResultCaption(
  input: {
    attemptNumber: number;
    revisionNumber: number;
    reasoningProviderLabel?: string | null;
    reasoningModel?: string | null;
    imageModelLabel?: string | null;
  },
  overrides?: BotTextOverrides,
): Promise<string> {
  const resolved = await loadBotTextOverrides(overrides);
  return buildResultCaption(input, resolved);
}
