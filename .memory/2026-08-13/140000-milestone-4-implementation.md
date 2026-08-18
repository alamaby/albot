# Milestone 4 — Prompt Enhancement, Confirmation, and Revision

Date: 2026-08-13 (updated 2026-08-18 E2E)

## Status

**IMPLEMENTED + E2E VERIFIED 2026-08-18** — local + hosted tests green, migration 11/11 applied ke dev, production untouched. E2E happy path lengkap di dev (enhancement → confirmation → revise loop → generate → batal). Closure evidence recording pending.

## E2E Results (dev, 2026-08-18)

- Prompt "desain poster kafe cozy di malam hari" → enhancement (Cloudflare gpt-oss-120b, HTTP 200) → session `awaiting_confirmation`, revision `completed`, pesan konfirmasi + tombol Generate/Revise Lagi/Batal muncul.
- `Revise Lagi` → instruksi "buat lebih terang" → revision 2 `completed` (previous_prompt audit), revision 1 immutable.
- `Generate` → session `generating` + job `generate_image` `queued` (handler M5 belum ada — expected).
- `Batal` → session `cancelled`.
- Callback dedupe: callback_events unique per callback_query_id; `prompt_session_id` ter-link.

## Platform/Provider

- **Provider reasoning dev: Cloudflare Workers AI** (`@cf/openai/gpt-oss-120b`) via openai_compatible adapter, base_url `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`. OpenRouter free (`nvidia/nemotron-3.5-lightning:free`, `poolside/laguna-xs-2.1:free`) di-deactivate karena 401 (key dikirim ke base_url salah — bug, sudah fixed).
- Seed via `scripts/seed-provider-config.mjs` (membaca .env, `--env-key`). Config `bd1c7875` + key Cloudflare di dev.
- **Vercel Preview deploy manual** via `vercel` CLI (bukan auto-deploy): setiap push → `npx vercel` → update webhook ke URL baru via script (TELEGRAM_BOT_TOKEN/SECRET di .env lokal, sama dengan Vercel Preview).

## Bugs Fixed Selama E2E (semua di-commit ke main)

1. `provider_adapter_unknown` — registry adapter tidak ter-registrasi: tambah `import "@/server/providers/index"` side-effect di enhance-prompt.ts.
2. Semua 401 (`provider_authentication_failed`) — adapter factory membaca `base_url` dari `config.settings`, tapi use case hanya meneruskan settings; base_url/model dari kolom DB tidak diteruskan → request ke `api.openai.com` default. Fix: merge `base_url` + `model` dari ProviderConfigSafe ke payload factory.
3. `confirmation send failed (toString undefined)` — `transitionSessionOrThrow` mengembalikan raw RPC row (snake_case); `telegramChatId` undefined. Fix: reload via `sessionRepository.getById` setelah transisi.
4. Callback "berkilau" tidak merespons — `createDefaultWebhookDeps` meng-construct `RevisionInputUseCase`/`CallbackStateMachine` tanpa Telegram client (stub "not wired"). Fix: wire `sendTelegramMessage`/`answerCallbackQuery`/`dispatchToProcessor` ke use cases.
5. `callback_events.prompt_session_id` null — parse sessionId dari callback data sebelum insert.
6. `mark_revision_failed` guard gagal — revision tidak pernah `processing`. Fix: `markRevisionProcessing` sebelum provider call.
7. Contract test enhancement-flow flaky — deactivate config lain di beforeAll (isolate), cleanup FK-safe.

## Verification

- `npm test` — 266+ unit/hosted green (final: 180 unit + hosted).
- lint 0 warning, typecheck clean, format clean, build clean.
- `db:lint`, `db:check-migrations` (11), `db:types:check` — clean.
- Dev migration 11/11. Production 0 untouched.

## Notes / Gotchas

- **Claim_job global FIFO + test isolation**: contract test `claim_job` concurrency gagal bila ada job claimable asing. Job `ct_*`/`worker-contract` leftover harus cleanup manual (delete provider_requests dulu — FK RESTRICT).
- **`vercel env pull` menghasilkan `[SENSITIVE]` untuk Sensitive vars** — token bot/secret harus disalin manual ke .env lokal.
- **Vercel Preview tidak auto-deploy dari push** — tiap deploy manual `npx vercel`, webhook di-update ke URL baru.
- **Session aktif dev** — sebelum tiap E2E, cancel session non-terminal (partial unique index).

## Next

- M5: Image Generation and Post-Result Actions (handler `generate_image` — job sudah `queued` di dev).
