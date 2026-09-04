# Prompt Configurability + Negative Prompt Plan

Created: 2026-09-04 12:00:00

## Objective

Jawab dua pertanyaan user dan implementasikan: (1) jadikan seluruh prompt/instruksi LLM dan user-facing text configurable via tabel `prompt_configs`; (2) pastikan negative prompt didukung untuk semua model image yang mendukungnya (tanpa default global — kosong = omit).

## Scope

- Seed 5 key baru di `prompt_configs`: `reasoning_revision_helper`, `reasoning_sampling`, `bot_messages`, `bot_keyboards`, `bot_templates`.
- Repository baru `bot-text.repository.ts` (fallback-ke-default untuk teks bot agar bot tidak bisu saat DB down).
- Adapter reasoning options-driven (revision helper + temperature/max_tokens via `input.options`).
- `enhance-prompt.ts` load reasoning keys strict-error (konsisten dengan persona).
- Call sites bot text/keyboard beralih ke async getters dengan fallback.
- Negative prompt: tidak ada perubahan perilaku (matriks adapter sudah benar); hanya dokumentasi.
- Update `EXPECTED_MIGRATIONS`, README, unit tests baru, memory entry.

## Milestones

1. Migrasi + seeds (DDL-free, INSERT idempotent)
2. Repository + adapter + use-case wiring
3. Call-site migration (messages/keyboards)
4. Verifikasi lokal penuh + docs + memory

## Tasks

- [x] Migrasi `20260904120000_seed_bot_text_prompt_configs.sql` (5 keys, idempotent, ≤8000 char/body)
- [x] `EXPECTED_MIGRATIONS` += `20260904120000`
- [x] `src/server/repositories/bot-text.repository.ts` (zod-validated JSON, TTL 60s, fallback defaults)
- [x] `messages.ts`: export DEFAULT_* + async getters (`getBotMessage`, dst.)
- [x] `keyboards.ts`: param `labels` opsional + async label loader usage di call sites
- [x] `openai-compatible.adapter.ts`: `options.revision_helper`/`temperature`/`max_tokens`
- [x] `enhance-prompt.ts`: load `reasoning_revision_helper` + `reasoning_sampling`, teruskan ke adapter
- [x] Update call sites (~30): handle-telegram-update, jobs handlers, callback-state-machine, generate-image
- [x] Unit tests: bot-text fallback/override, adapter options, message defaults
- [x] Verifikasi: `db:lint`, `db:check-migrations`, `db:types:check`, `test:unit`, `lint`, `typecheck`, `build`, `format:check`
- [ ] README update (key baru) + memory entry

## Risks

- Shape tail JSON + refusal markers tetap di code (disengaja): menjadikannya editable berisiko merusak parsing/retry. Counter: hanya persona/sampling/bot-text yang DB-driven.
- Bot teks fallback-ke-default (deviasi dari strict-error persona): dibenarkan karena bot bisu lebih buruk daripada teks basi; setiap fallback di-log `warn`.
- 5 keys = 5 failure modes baru; mitigasi via single-flight cache + fallback.
- Blas radius call-site besar (~30 titik): mitigasi via sync builders tetap ada (pure, teruji), async getters hanya merge overrides.

## Progress Log

- 2026-09-04 12:00:00 — Plan dibuat (jawaban: baru 1 key DB-driven; negative prompt sudah didukung per matriks adapter). User memilih cakupan semua user-facing text, tanpa default negative prompt global.
- 2026-09-04 14:10:00 — Implementasi selesai: migrasi seed 5 keys DDL-free + dev seeded, BotTextRepository + DEFAULT_* + get* wrappers (bot fallback), adapter options-driven (revision_helper/temperature/max_tokens), enhance-prompt wiring strict-error untuk reasoning, seluruh call sites dialihkan ke get* (jobs/callback/generate/revision/webhook). db:lint + check-migrations OK, db:types:check OK (no DDL), unit 357/357, contract 107/107, lint 2 warn sisa pre-existing, typecheck OK, format OK. Build EPERM symlink Windows (pre-existing, bukan dari perubahan code).

## Notes

- Standar domain: tidak ada perubahan skema C2M/TM Forum; ini operasional prompt-management internal. Satu-satunya DDL-free migration (INSERT only) sehingga `database.types.ts` tidak berubah.
- Negative prompt matrix (verified): Pixazo native; Aichixia difusi native, gemini omit; Pollinations/Bynara inject `Avoid:`; kosong omit semua adapter.
