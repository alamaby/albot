# Command Expansion — /help, /generate-image, /enhance-prompt

Date: 2026-08-26 15:50:00
Status: CLOSED — Accepted @alamaby

## Task / Problem

Persyaratan command baru: `/start` menampilkan command list, `/help` bantuan, `/generate-image` langsung generate tanpa enhance, `/enhance-prompt` hanya enhance (teks saja), plus `setMyCommands` menu Telegram.

## Key Files Changed

- `supabase/migrations/20260826100000_extend_create_initial_session_direct.sql` — overload 6-arg (`p_enhanced_prompt text default null`)
- `tests/integration/schema.integration.test.ts` — `EXPECTED_MIGRATIONS` 26 + overload union types
- `src/server/supabase/database.types.ts` — regen union (PostgREST 14.17)
- `src/server/telegram/parser.ts` — `parseSlashCommand` (hyphen/underscore/@bot, args trim)
- `src/server/telegram/messages.ts` — `COMMAND_HELP_TEXT`, `help`, revisi `welcome`, `generate_usage`/`enhance_usage`, `buildEnhanceOnlyMessage`, `dispatch_failed`
- `src/server/application/enhance-prompt.ts` — ekstrak `createAdapter`, `enhanceOnly()` (reuse provider select/audit)
- `src/server/application/handle-telegram-update.ts` — 2 handler `/generate-image` (RPC direct + status message persist) & `/enhance-prompt` (enhance_only job), `/help` handler, `helpCommand→command` rename
- `src/server/jobs/enhance-prompt-only.handler.ts` — new handler, BigInt try/catch, retry bounded
- `src/server/jobs/processor.ts` — register `enhance_only` + `extractMessageId` export shared
- `src/server/repositories/job.repository.ts` — `insertEnhanceOnlyJob`, import `bigintToDb`
- `src/server/repositories/initial-session.repository.ts` — `enhancedPrompt` param
- `src/server/application/callback-state-machine.ts` — export `extractMessageId`
- `scripts/set-my-commands.mjs` — menu Telegram (underscore, --allow-prod)
- `tests/unit/telegram-webhook.test.ts` — parsing + help + generate-image + enhance-prompt tests
- `tests/unit/enhance-prompt-only.handler.test.ts` — new handler tests (4)
- `tests/contract/initial-session.contract.test.ts` — hosted direct-mode tests (2)

## Technical / Business Decisions

- **RPC overload** (6-arg baru + 5-arg lama dipertahankan): kompatibel rolling deploy; deployment lama tetap pakai 5-arg; new code pakai 6-arg `enhancedPrompt`. `ts:types` regen union (`5-arg | 6-arg`).
- **Accepted limitation**: enhance-only tidak terhitung rate limit berbasis sesi (tanpa sesi); allowlist tetap melindungi.
- **Menu Telegram** hanya underscore (`generate_image`/`enhance_prompt`), parser menerima hyphen juga.

## Assumptions / Risks

- F8 types overload: pre-stage merged optional → regen union (pola M6 `b76cc42`), 3 run migrate-dev diulang (types union + fix test select).
- Dedupe contract flaky (seed space 9999, leftover collision): `beforeAll` cleanup di dedupe test ditambahkan.
- `/generate-image` saat `awaiting_revision_input` → guard active-session menolak (by design).

## Verification Performed

- T-8: lint 0 error (2 warning pre-existing), typecheck ok, 274 unit, build ok, format ok
- T-9: migrate-development `fc207aa` gagal types → F8 regen `b76cc42`; `fc207aa` gagal hosted (bug select + flaky) → fix `15fd84a`; `2323678`→ `32952466785` sukses; migrate-production `32953970159` 25→26 attestation match
- T-10 E2E prod `c92b4e8` build: semua command lulus di @albot_ai_bot (prod 26/26)

## Blockers / Unresolved

- (none)

## Conventional Commit Proposal

`feat: expand commands (/help, /generate-image, /enhance-prompt)`

## Related Plans

- `plans/2026-08-26-command-expansion-help-generate-enhance.md` (parent)
- `plans/2026-08-26-command-expansion-review-fix.md` (review fix F1-F6)
