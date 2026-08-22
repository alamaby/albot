# Project Memory

Last updated: 2026-08-22 (pollinations review fix)

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Active milestone: **Pollinations fallback REVIEW-FIX 2026-08-22 — prompt/apiKey/b64 validation, 89 contract (10 pollinations edge), 25 migrations, 250 unit green** + Pollinations fallback IMPLEMENTED 2026-08-22 + Pixazo PixelForge v2 IMPLEMENTED 2026-08-21 + REVIEW-FIX 2026-08-22 — dev migrate 23/23 aman (adapter `pixazo_pixelforge_v2` `text`/`type`/`seed`/`size`→`results[0].url`, Opsi 2 `settings.type`, hybrid `user_image_preferences`, 3 model aktif, picker confirmation+result, `migrate-development` `87e23ee` hijau, `db:types:check` ok). Plans `2026-08-21` + `2026-08-22` fix, TODO Completed Pixazo.
- Milestone 4 CLOSED 2026-08-18 (Prompt Enhancement, Confirmation, and Revision). E2E dev lengkap: enhancement → confirmation → revise loop → generate → batal, provider Cloudflare gpt-oss-120b, 7 bug fixed selama E2E, acceptance criteria 8/8, CI #25-#32 success. Next: Milestone 5 (Image Generation).
- Milestone 3 **CLOSED** 2026-08-13: platform wiring + E2E selesai (Vercel Preview env vars, webhook terpasang, seed admin applied, E2E prompt → session/revision/job rows, hosted 79/79).
- Milestone 2 (Provider Abstraction and Configuration) **CLOSED** 2026-08-10: implementasi `209847d` + remediation `35a9cab` + closure (M/L transcribed: M1/M4/M5/M6 + C-Low A fixed; M7/M8/M10/M13-M16 + L2-L14 accepted; acceptance criteria checked). Evidence: run `31311782574` (dev 7 migrations Local==Remote, hosted 67/0 skip), 143 unit tests, production 0 migrations untouched
- Supabase projects: dev `ceqcitzbosqzxpbtlpfn` (18 migrations applied), prod `pcexxtckvwmiquseznaz` (0 migrations)
- M1 + remediation MILESTONE COMPLETE:
  - Development migration workflow success (run 31252455316, commit dba67ce)
  - Production migration history unchanged (0 migrations)
  - 6 M1 migrations applied with composite FK ownership, function hardening, and least-privilege grants
  - 67 total tests pass (27 unit, 40 hosted: 15 schema, 7 security including authenticated role, 18 contract including negative ownership)
  - `database.types.ts` generated and tracked
  - `migrate-development.yml` requires exact commit SHA + ancestor-main check
  - `migrate-production.yml` requires development attestation run ID + independent ref
  - GitHub Actions pinned to full commit SHAs
- GitHub Environments `development` + `Production` created with required reviewer `@alamaby` and per-environment secrets
- Health endpoint acts as readiness probe: HTTP 200 `status:ok` when DB reachable, HTTP 503 `status:degraded` otherwise, `Cache-Control: no-store`

## Active Decisions

- Environment variables: `APP_ENV` overrides, else derived from `VERCEL_ENV` (`production` → production, otherwise development)
- Health endpoint: HTTP 503 on DB failure (readiness semantics)
- Supabase URL normalization: trailing slash stripped
- Secret management: Vercel Encrypted variables (Sensitive); Supabase CLI secrets via GitHub Environments
- Probe classification: 200 → reachable; 404 with `42P01`/`PGRST205` → reachable; 401/403 → unauthorized; other → unreachable
- CI: GitHub Actions validate (lint, typecheck, format, unit, build, gitleaks, db:lint, db:check-migrations)
- Migration: Database as Code via `supabase/migrations`; M1 hanya mengeksekusi ke development
- Atomic functions: `claim_job(text, integer)` (SKIP LOCKED, lease recovery) dan `transition_prompt_session` (compare-and-set, terminal guard) — service_role only, security definer fixed search_path
- `database.types.ts` di `.prettierignore`; vitest `fileParallelism: false`
- M2 decision: OpenAI-compatible reasoning + Pixazo image generation
- M2 Pixazo models: Flux Schnell + SDXL; authentication via `Ocp-Apim-Subscription-Key`
- M2 encryption: `PROVIDER_KEY_ENCRYPTION_KEY` base64, 32-byte AES-256-GCM
- M2 admin surface: server-only repository contract (no admin UI/API in M2)
- M2 review remediation (2026-08-09): C1 via `makeErrorFromHttpStatus` (retryable dari status); C2 via `responseKind` discriminator; C3 strict base64; C4 forward-fix migration `increment_provider_key_failure` (atomic + cooldown exponential, **tidak reset failure_count saat threshold**); C5 weighted cumulative-prefix + seed; C6 env validation wajib; C7 registry capability mismatch → `ProviderError`; C8 real hosted repository tests; H1-H11 sesuai plan
- M2 remediation satu-satunya schema change: forward-fix migration C4 (additive, development-only) — dev 7 migrations, prod 0
- M3 schema change: migration `20260810150719` (create_initial_session RPC) + `20260813100000` (seed allowlist admin) — dev 9 migrations, prod 0
- M4 schema change: migration `20260813074037` (mark_revision_failed + create_revision RPCs, partial unique index `prompt_sessions_one_active_idx`, `prompt_sessions_status_idx`) + forward-fix `20260813091942` (`#variable_conflict use_column` untuk ambiguous `revision_number`) — dev 11 migrations, prod 0
- M4 callbacks: inline di webhook (generate/revise/cancel), `callback_events` dedupe + owner check + CAS transition
- M4 retry: bounded (`classifyEnhancementError`, backoff 60s*2^n cap 8m), `mark_revision_failed` guard-patched, worker-ownership updates
- Pixazo PixelForge v2 (plan 2026-08-21): endpoint `pixelforge-image-v2/v1/text-to-image` auth `Ocp-Apim-Subscription-Key`, body `text`/`type`/`seed`/`size` → `results[].url` https + `caption`; `type` Opsi 2 via `settings.type` default `tags,caption` allowlist `tags`/`caption`/`tags,caption`; `size` default `1`; drop `negativePrompt`/`aspectRatio` untuk PF; hybrid selection per-session FK + per-user `user_image_preferences` tabel terpisah; 3 model tetap aktif; shortCode `flux|sdxl|pf2` `mp:<code>:<uuid>` ≤64
- Dispatcher observability (2026-08-22): `dispatchToProcessorUrl` return `DispatchResult` (`{ok:true,status}` | `{ok:false,status?,error}`); `handlePrivateTextMessage` kirim "Gagal memulai pemrosesan. Silakan coba lagi sebentar." saat `ok:false` — tidak ada lagi silent failure
- Process-jobs cron (2026-08-22): ditambahkan lalu dihapus per opsi 1 — andalkan feedback dispatcher + retry manual user, bukan cron auto-claim
- Pollinations provider (review-fix 2026-08-22): **REVIEW-FIX — hardening** prompt/apiKey/b64/log + errors 402 order + openai-compatible parity + 10 pollinations edge tests (89 contract)
- Pollinations provider (implemented 2026-08-22): **IMPLEMENTED — fallback** reasoning `gpt-oss` priority 150 + image `flux` priority 151 via `https://gen.pollinations.ai/v1`, `PollinationsImageAdapter` POST `/v1/images/generations` size mapping, inject `negativePrompt` via `Avoid:`, 2 adapter types (`pollinations`/`pollinations_image`), 402 -> provider_rate_limited, `.env.example` POLLINATIONS_API_KEY, migration 20260823100000

## Open Blockers

- Pollinations fallback done: PollinationsImageAdapter + pollinations/pollinations_image registry + migration 20260823100000 + EXPECTED_MIGRATIONS + contract tests (8 tests) + .env.example, verifikasi hijau (db:lint ok, 25 migrations, db:types ok, 250 unit, 79 contract, lint 2 warnings, typecheck ok, build ok, format ok)
- Pollinations review-fix done: prompt/apiKey/b64 strict + providerRequestId log + errors 402 order + openai-compatible trim/timeout parity + 6 edge tests (89 contract), all green
- Seed Pixazo PixelForge v2 di dev + E2E Telegram picker → Generate → Ganti Model → Regenerate (await hybrid `Jadikan Default` verification); prod migrate menunggu dev E2E hijau.
- Deploy commit dispatcher fix `5b093fd` ke Vercel preview done (`albot-bn8omcoar`, alias `albot-dev.vercel.app` updated); job stuck `033b6f11` sudah di-recover manual (`succeeded` 15:11:59 UTC).

## Recent Entries

- `2026-08-22/214000-pollinations-review-fix.md` — Review-fix: prompt/apiKey/b64 validation, log providerRequestId, errors 402 order, openai parity, 6 edge tests → 89 contract.
- `2026-08-22/213000-pollinations-provider-implemented.md` — Pollinations fallback IMPLEMENTED: PollinationsImageAdapter (flux, inject Avoid:, size map, b64_json fallback), pollinations/pollinations_image registry, 402 handling, migration 20260823100000 WHERE NOT EXISTS, .env.example POLLINATIONS_API_KEY, 8 contract tests, verifikasi hijau.
- `2026-08-22/210000-pollinations-provider-final-plan.md` — Pollinations fallback final plan konsolidasi: flux/gpt-oss priority 150/151 fallback, 2 type bukan 20, inject negativePrompt, fix private->protected + 402 + WHERE NOT EXISTS, .env.example POLLINATIONS_API_KEY, plan `plans/2026-08-22-pollinations-provider-final-plan.md`.
- `2026-08-22/150920-bot-no-response-dispatcher-swallow.md` — Fix: bot diam setelah user kirim teks (job `033b6f11` stuck `queued` 2.5 jam). Dispatcher swallow → `DispatchResult` + user feedback "Gagal memulai..."; cron ditambahkan lalu dihapus opsi 1. Verifikasi hijau (243 tests, build ok, deployed).
- `2026-08-22/000000-pixazo-pixelforge-dev-migrate.md` — Dev migrate 23/23 aman (`87e23ee` types regen, `prompt_sessions_preferred_image_provider_config_id_fkey` + `isOneToOne:true`), user konfirm migrate aman — siap seed PF2 + E2E.
- `2026-08-21/083000-pixazo-pixelforge-plan.md` — Pixazo PixelForge v2 plan (sample `text`/`type`/`seed`/`size`→`results[].url`, Opsi 2 `settings.type` default `tags,caption`, drop `negativePrompt`/`aspectRatio`, hybrid per-session + `user_image_preferences` tabel terpisah, 3 model aktif, picker confirmation+result).
- `2026-08-20/163000-migration-cleanup-and-status-message.md` — M5/M6 follow-up: migration dev-only `20260820110000` hapus sisa config `mock_image_generation_contract` (dev 18/18, prod 0); feat status message persisted (`telegram_status_message_id`, edit ke outcome); guardrail `check-migrations` mencegah `EXPECTED_MIGRATIONS` stale (regresi berulang M3/M6/2026-08-20); instruction di AGENTS.md.
- `2026-08-13/140000-milestone-4-implementation.md` — M4: implementation + E2E VERIFIED + CLOSED 2026-08-18. Bugs fixed: registry import, base_url merge (akar semua 401), session shape, callback wiring (stub "not wired"), prompt_session_id link, revision processing, test isolation. Provider dev: Cloudflare gpt-oss-120b. E2E: prompt → konfirmasi → revise → generate (job queued M5) → batal. Closure plan `plans/2026-08-18-milestone-4-closure-plan.md`, CI #25-#32 success.
- `2026-08-11/100000-milestone-3-pr1-code-cleanup.md` — PR #1: plan synchronization, code cleanup (bigint helper, parser simplification, messages, dispatcher body), test coverage enhancements for idle/claim-error paths, update_id validation, unknown callback ack, dispatcher body, runbook creation for manual admin bootstrap and platform wiring.
- `2026-08-10/161500-milestone-3-implementation.md` — M3 webhook intake + durable jobs: RPC create_initial_session, telegram auth/parser/client/messages, 5 repositories, webhook + processor routes, inline dispatcher, 218 tests pass, 8 migrations applied dev
- `2026-08-10/141000-milestone-2-review-followup.md` — post-closure review follow-up: http.ts helper, Pixazo https-only + request_id fallback + metadata, vault injectable, markSuccess fail-fast, 150 unit + hosted 74/0
- `2026-08-10/111200-milestone-2-closure.md` — M2 closure: M/L transcribed, M1/M4/M5/M6 + C-Low A fixed, acceptance criteria checked, 143 unit + hosted 67/0
- `2026-08-09/180000-milestone-2-review-remediation-evidence.md` — M2 remediation evidence (run 31311782574 success, 7 migrations, hosted 67/0)
- `2026-08-09/175000-milestone-2-review-remediation-implementation.md` — M2 remediation implementation (C1-C8 + H1-H11 done, migration C4 applied, 142 tests)
- `2026-08-09/171800-milestone-2-review-remediation.md` — M2 review remediation start (plan, C1-C8/H1-H11, forward-fix migration C4)
- `2026-08-08/175000-milestone-2-start.md` — M2 start, provider decisions, Pixazo contract confirmed, plan created
- `2026-08-08/154404-milestone-1-review-remediation-plan.md` — M1 review findings + remediation plan (composite FK, auth tests, gates)
- `2026-08-08/151834-milestone-1-database-foundation-implementation.md` — M1 implementation (schema, RLS, atomic functions, types, tests, workflows)
- `2026-08-08/143241-resolve-milestone-1-platform-blocker.md` — M1 platform blocker resolved (Supabase projects verified, baseline clean, docs updated)
- `2026-08-08/130128-milestone-1-database-foundation-plan.md` — Detailed M1 schema, RLS, atomic functions, hosted workflow plan
- `2026-08-08/150000-milestone-0-review-remediation-plan.md` — Milestone 0 review, health 503 remediation, test coverage
- `2026-08-07/123000-telegram-image-bot-implementation-plan.md` — Original implementation plan

## Related Plans

- `plans/2026-08-22-pollinations-provider-final-plan.md` — Pollinations fallback final (gpt-oss + flux)
- `plans/2026-08-21-pixazo-pixelforge-model-and-telegram-provider-selection.md` — Pixazo PixelForge v2 + hybrid model selection (plan)
- `plans/2026-08-07-telegram-image-bot-implementation-plan.md` — Active plan
- `plans/2026-08-08-milestone-0-review-remediation-plan.md` — Active plan (remediation)
- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md` — Detailed M2 execution plan (closed)
- `plans/2026-08-09-milestone-2-review-remediation-plan.md` — M2 review remediation plan (closed)
- `plans/2026-08-10-milestone-2-closure-plan.md` — M2 closure plan (closed)
