# Universal prompt controllability + negative-prompt coverage (2026-09-04 follow-up)

## Task

Follow-up dari sesi `lanjut` yang sama (user: "untuk semua prompt dan instruksi LLM apakah sudah configurable by table? dan untuk negative prompt apakah sudah di support juga?").

1. Jawaban user di sesi ini (kuesioner inline): **cakupan = semua user-facing text**, **negative prompt tidak perlu default global** (kosong = omit, dipertahankan).
2. Kesesuaian: seluruh prompt/instruksi LLM + teks bot & label keyboard dibuat DB-configurable via `prompt_configs`; negative prompt tetap per-adapter (tanpa default global).

## Key files changed

- `supabase/migrations/20260904120000_seed_bot_text_prompt_configs.sql` (baru, DDL-free): seed 5 keys `reasoning_revision_helper`, `reasoning_sampling`, `bot_messages`, `bot_keyboards`, `bot_templates` — semua `v1 is_active=true`, JSON ≤8000 char (`bot_messages` 3092, `bot_keyboards` 406, `bot_templates` 2158). Idempotent (`on conflict do nothing` + conditional audit). Diterapkan ke dev via MCP `apply_migration` `seed_bot_text_prompt_configs`.
- `tests/integration/schema.integration.test.ts`: `EXPECTED_MIGRATIONS` → 48 entri (+`20260904120000`).
- `src/server/repositories/bot-text.repository.ts` (baru): `BotTextRepository` (Zod-validated JSON), TTL 60s + single-flight `cache/inflight`, `getMessageOverrides/getKeyboardLabels/getTemplateOverrides` (fallback `{}` + `warn`), `getRevisionHelper/getSampling` (strict-error via `PromptConfigRepository`, `samplingSchema` `temperature 0..2` + `max_tokens 1..8192`).
- `src/server/telegram/messages.ts`: export `DEFAULT_BOT_MESSAGES` (45 keys) + `DEFAULT_BOT_TEMPLATES` (28 keys), `COMMAND_HELP_TEXT` pindah sebelum template block, `renderTemplate/pick` helper, `build*` kini terima `overrides?`, `getBotMessage/getGenerationStatusMessage/getEnhanceOnlyMessage/getEnhancedPromptMessage/getModelPickerMessage/getModelSelectedMessage/getReasoningPickerMessage/getReasoningSelectedMessage/getResultCaption/getBotTemplate` (async DB-driven wrappers via `BotTextRepository`). `FailureContext` dipertahankan.
- `src/server/telegram/keyboards.ts`: export `DEFAULT_KEYBOARD_LABELS` (15 keys) + `KeyboardLabels` + `label/renderLabel/getKeyboardLabels`, param `labels?` opsional pada `confirmationKeyboardWithModel/resultKeyboardWithModel/modelPickerKeyboard/reasoningPickerKeyboard/retryKeyboard`.
- `src/server/providers/reasoning/openai-compatible.adapter.ts`: `buildRequestBody` kini options-driven — `revision_helper` (dari DB), `temperature`/`max_tokens` (dari DB), strip `revision_helper` dari `providerOptions` agar tidak bocor ke provider.
- `src/server/application/enhance-prompt.ts`: import `BotTextRepository`, `resolveReasoningOptions()` (load `reasoning_revision_helper` + `reasoning_sampling` strict), `enhanceOnly` + `execute` teruskan `reasoningOptions` ke adapter + audit, `sendConfirmation` kini `await getEnhancedPromptMessage` + `getKeyboardLabels`.
- Call sites dialihkan dari sync `build*` ke async `get*`: `handle-telegram-update.ts` (13×), `callback-state-machine.ts` (~30× termasuk `getBotTemplate` untuk reshow fallbacks), `generate-image.ts` (`getResultCaption` + `getGenerationStatusMessage` + `getKeyboardLabels`), `revision-input.ts` (`getBotMessage`), `recovery.ts` (`getGenerationStatusMessage`/`getBotMessage`), `enhance-prompt.handler.ts`/`enhance-prompt-only.handler.ts`/`generate-image.handler.ts`.
- `tests/unit/enhance-prompt-select.test.ts`: mock `getActivePersona` key-aware (sampling + helper).
- `tests/unit/bot-text.test.ts` (baru, 11): defaults, `renderTemplate` placeholders, `BotTextRepository` fallback/validasi JSON, `getSampling` strict, adaptor `revision_helper` tidak bocor.
- `README.md`: Prompt Configs section → 6 keys, `bot_*` fallback semantics, ringkasan matriks negative prompt.
- `plans/2026-09-04-prompt-configurability-and-negative-prompt-plan.md`: plan + task checklist (12 todo) + progress log.

## Decisions

- Satu migrasi DDL-free (INSERT only): `database.types.ts` tidak perlu regenerasi (`db:types:check` tetap OK), tidak ada perubahan fungsi/RLS.
- `bot_*` fallback-ke-default (deviasi dari strict-error persona): dibenarkan — bot bisu lebih buruk daripada teks basi. Setiap fallback di-log `bot_text.fallback_default/invalid_json_fallback`.
- Revision helper dipindah dari kode adapter ke `prompt_configs` (`reasoning_revision_helper`) — caller (`enhance-prompt.ts`) yang menyediakan, adapter tetap aman dengan default historis bila `options.revision_helper` tidak ada.
- Negative prompt tetap tanpa default global: `PromptConfigRepository` plumbing `revision.negativePrompt` → adapter sudah benar; menambah key default akan mengaburkan sinyal LLM yang sengaja kosong.
- Call sites besar (~30 titik): sync `build*` dipertahankan (pure, teruji) + async `get*` sebagai wrapper — test unit tetap terhadap `build*`.

## Assumptions / risks

- Nilai seed migrasi == `DEFAULT_*` pada commit ini: sinkronisasi dialihkan eksplisit per audit `tmp-check-seed` (removed).
- 5 keys baru = 5 failure modes baru; mitigasi via TTL 60s + single-flight + fallback `{}`.
- Jumlah body JSON aman di bawah 8000 (terbesar `bot_messages` 3092). Penambahan teks panjang di masa depan harus tetap di-check terhadap constraint `prompt_configs_body_check`.
- Batas Vercel tidak tersentuh.

## Blockers / unresolved

- `migrate-production` untuk `20260904120000` belum dijalankan (prod masih 47 setelah manual seeds sebelumnya); perlu `migrate-production` manual sebelum deploy kode baru berisi `reasoning_*` strict (tanpa baris, enhancement akan gagal `provider_configuration_invalid`).
- Blocker lama tetap berlaku: `VERCEL_TOKEN` environment `production` kosong (`deploy-production` gagal) — deploy manual `vercel --prod` sudah terbukti 2026-09-04.
- `npm run build` lokal: compile + TS OK, tahap symlink Vercel gagal `EPERM` (Windows). Verifikasi build final di CI Linux.
- `lint` menyisakan 2 warning pre-existing (`randomUUID`, `SKIP_TELEGRAM` — bukan dari change ini).

## Verification

- `db:lint` OK, `db:check-migrations` 48/48, `db:types:check` OK (tanpa regen).
- `test:unit` 357/357 (was 346 pre-feature; +11 `bot-text.test.ts`).
- `test:contract` 107/107 (was fail 1/107 pre-seed dev; hijau setelah dev `apply_migration`).
- `lint` 2 warning (pre-existing), `typecheck` OK (`next typegen && tsc --noEmit`), `format:check` OK.
- Prod DB verified (run earlier today): nemotron `is_active=false`, 5 Bynara active.

## Commit proposal

`feat(prompts): make all LLM instructions and bot text DB-configurable via prompt_configs`

## Related

- Plan: `plans/2026-09-04-prompt-configurability-and-negative-prompt-plan.md`
- Prev entry: `2026-09-04/103800-bynara-reasoning-rotation-and-failure-context.md`
- Migration: `supabase/migrations/20260904120000_seed_bot_text_prompt_configs.sql`
