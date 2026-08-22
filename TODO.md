# TODO

Source of truth untuk tracking progress implementasi. Detail acceptance criteria dan gate ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`.

## Current Milestone

Milestone 6: Reliability, Security, and Observability (**CLOSED 2026-08-20** — lihat Completed)

## In Progress

- (none) — Milestone 6 CLOSED 2026-08-20. Lihat bagian Completed.

## Pending

- [ ] Implement Milestone 7 dan record verification evidence
- [ ] Execute production release checklist dan operational handoff
- [ ] Implementasi Pollinations provider (DEFERRED 2026-08-22 — menunggu dispatcher stabil) — plan: `plans/2026-08-22-pollinations-provider-implementation-plan.md`

### Bot no-response recovery (2026-08-22)

Plan: `plans/2026-08-22-bot-no-response-after-new-text.md`

- [x] Diagnosa via mcp `supabase-albot-be-development` — job `033b6f11` stuck `queued` sejak 10:17 UTC, dispatcher swallow error
- [x] Fix `dispatchToProcessorUrl` return `DispatchResult` (`{ok:true,status}` | `{ok:false,status?,error}`); tidak swallow lagi
- [x] `handlePrivateTextMessage` step 7 cek return; `ok:false` → user dapat "Gagal memulai pemrosesan. Silakan coba lagi sebentar."
- [x] Update tests `tests/unit/telegram-webhook.test.ts` — return type + 2 test baru
- [x] Cron `process-jobs-development.yml` ditambahkan lalu dihapus per keputusan opsi 1 (andalkan feedback dispatcher, bukan auto-claim)

## Completed

### Pixazo PixelForge v2 + Telegram Model Selection (implemented 2026-08-21, review-fix 2026-08-22, dev migrate 23/23 aman — user konfirm 2026-08-22)

Plan: `plans/2026-08-21-pixazo-pixelforge-model-and-telegram-provider-selection.md` + fix `plans/2026-08-22-pixazo-pixelforge-review-fix-plan.md`

- [x] Adapter `src/server/providers/image/pixazo-pixelforge.adapter.ts` — `text`/`type`/`seed`/`size` → `results[0].url` https + `caption` (type Opsi 2 via `settings.type` default `tags,caption` allowlist, size default 1, drop `negativePrompt`/`aspectRatio`, timeout 120s)
- [x] Registry `pixazo_pixelforge_v2` + seed `scripts/seed-provider-config.mjs` whitelist
- [x] Migrations `20260821100000` (preferred column + `callback_events` enum) + `20260821110000` (`user_image_preferences` + RLS + trigger) + forward-fix `20260822100000` (`model_picker_back`) + `20260822110000` (FORCE RLS, `public` revoke, minimal grants, dedup FK) — dev 23/23 Local==Remote
- [x] Session repo + `UserImagePreferenceRepository` (upsert `telegram_user_id` PK), `database.types` regen (FK `preferred_image_provider_config_id_fkey`, `isOneToOne:true`, functions `recover/transition` include preferred)
- [x] Telegram: `keyboards.ts` shortCode `flux|sdxl|pf2` (`model_picked:uuid:code` ≤64), `confirmationKeyboardWithModel` + `modelPickerKeyboard` (★ default) + `resultKeyboardWithModel` (`Ganti Model`), `parser.ts` strict + length>64 guard, `messages.ts` `selectedModelLabel`, `callback-state-machine` hybrid pick (owner/expiry, eligible key, `setPreferred` + `upsert` default, `★` vs per-session, `Kembali`)
- [x] Generation hybrid `selectProvider(session)` — preferred session → user default → fallback `priority_failover`, `Date.now` → `this.now`, inactive log
- [x] Review fix: adapter guards (`first` object, JSON `provider_response_invalid`, AbortError `name`, String/Number coercion), parser strict, weighted duplication docs, `schema.integration` FK/TRIGGER/MIGRATIONS 23
- [x] Verifikasi: `db:lint` ok, `check-migrations` 23, `types:check` ok (after regen `87e23ee`), `test:unit` 247/247, `lint` 0 errors, `typecheck` ok, `build` ok, `format:check` ok, `migrate-development` `87e23ee` aman (user konfirm)

### Bot no-response recovery (2026-08-22)

Plan: `plans/2026-08-22-bot-no-response-after-new-text.md`

- [x] Diagnosa via mcp `supabase-albot-be-development` — job `033b6f11` stuck `queued` sejak 10:17 UTC, dispatcher swallow error
- [x] Fix `dispatchToProcessorUrl` return `DispatchResult` (`{ok:true,status}` | `{ok:false,status?,error}`); tidak swallow lagi
- [x] `handlePrivateTextMessage` step 7 cek return; `ok:false` → user dapat "Gagal memulai pemrosesan. Silakan coba lagi sebentar."
- [x] Update tests `tests/unit/telegram-webhook.test.ts` — return type + 2 test baru
- [x] Cron `process-jobs-development.yml` ditambahkan lalu dihapus per opsi 1 (andalkan feedback, user retry manual)
- [x] Trigger manual dispatch job stuck `033b6f11` sukses (`succeeded` 15:11:59 UTC, sesi `awaiting_confirmation`)
- [x] Verifikasi: `lint` 0 errors, `typecheck` ok, `test:unit` 243/243, `db:lint` ok, `build` ok, `format:check` ok — push `5b093fd`

## Blocked

- (none)

### Milestone 6: Reliability, Security, and Observability (closed 2026-08-20)

Plan: `plans/milestone-6-reliability-security-observability.md`; closure: `plans/2026-08-20-milestone-6-closure-plan.md` (**ACCEPTED** @alamaby)

- [x] Migration `20260819120000` (4 RPC: `expire_job_leases`, `mark_dead_jobs`, `recover_stale_sessions`, `purge_expired_metadata`) — dev 17/17, prod 0
- [x] Migration `20260819130000` (review fix: purge null-kan active pointers sebelum delete children + `telegram_updates` batch bounded; comment dokumentasi attempt double-count) — dev 17/17, prod 0
- [x] Migration `20260820100000` (advisor remediation: revoke EXECUTE `rls_auto_enable` dari anon/authenticated) — dev 17/17, prod 0
- [x] Migration `20260820110000` (development-only cleanup: hapus sisa config `mock_image_generation_contract` dari contract test M5) — dev 18/18, prod 0
- [x] Backoff full jitter (`src/server/jobs/backoff.ts`) + wire ke `EnhancementJobRetry`/`GenerationJobRetry`
- [x] Observability: `logger.ts` (structured JSON + redaction), `redact.ts`, `correlation.ts` (AsyncLocalStorage + `x-correlation-id`); console.* di src 0
- [x] Recovery: `job-event.repository.ts`, `recovery.repository.ts`, `recovery.ts` (lease → dead → session → purge), `/api/recovery/run` + cron `recovery-development.yml` (alias `albot-dev.vercel.app`, environment `recovery-development` tanpa approval)
- [x] Diagnostics `/api/admin/diagnostics` + health `?include=readiness` (non-paid) + session expiry sweep + notifikasi user
- [x] Docs: `docs/retention.md`, `docs/runbooks/milestone-6-incident-response.md`, env-variables, README; `npm audit` di validate.yml
- [x] Tests: unit 235 + hosted 106 hijau; backoff/redact/logger/recovery (unit), recovery-rpc (contract), recovery-auth (security)
- [x] Regenerasi `database.types.ts` (RPC M6 typed, `as never` dihapus)
- [x] E2E fault injection: lease recovery (event `lease_expired` via cron scheduled, correlationId `gh-32327141382`), dead job, session sweep, retention purge (FK fix), diagnostics 401, health readiness — `scripts/e2e-m6-fault-injection.mjs`
- [x] Supabase advisor: 2 WARN fixed (migration `20260820100000`), 10 INFO `rls_enabled_no_policy` accepted by design
- [x] Deploy Preview + alias stabil `albot-dev.vercel.app`; recovery cron berjalan otomatis
- [x] Closure plan accepted (2026-08-20)

### Milestone 5: Image Generation and Post-Result Actions (closed 2026-08-19)

- [x] Migration `20260818100000`: RPC `create_generation_attempt` (monotonic + anti double-click guard), `mark_generation_attempt_failed/succeeded` (guard processing), `complete_prompt_session` (tolak terminal/in-flight) — dev 13/13, prod 0
- [x] Migration `20260819100000`: session expiry 24 jam dari prompt pertama (forward-fix, ganti 30 menit)
- [x] `GenerationRepository`: attempt lifecycle (create/processing/succeed/fail) + `attachProviderToAttempt` (config + seed persist) + provider request audit
- [x] `GenerateImageUseCase`: select provider+key, sync-only Pixazo adapter, sendPhoto by URL, attempt `succeeded` hanya setelah delivery outcome, attempt selalu di-mark failed pada error path (tidak pernah stuck)
- [x] `generate-image` job handler + `generation-retry` (bounded, non-retryable auth/content/response-invalid); terminal failure → session `generation_failed`
- [x] Callback state machine: regenerate/complete/revise-after-result, retry dari `generation_failed`, dispatch processor setelah insert job, ack saat session expired
- [x] Result keyboard [Regenerate] [Revise Prompt] [Selesai] + caption attempt/revision
- [x] Selector failover: config aktif tanpa eligible key di-skip (fallback ke config berikutnya)
- [x] Seed script `--capability image_generation` (pixazo_flux_schnell / pixazo_sdxl)
- [x] 6 bug fixed selama E2E (dispatch callback, attempt lifecycle, generation_failed path, selector failover, expired ack, session expiry)
- [x] E2E dev verified: generate → gambar muncul → regenerate (attempt 2, rev 1) → revise → generate (attempt 3, rev 2) → selesai (session `completed`) — session `66e96dfa`
- [x] All verification: lint 0, typecheck clean, 306 tests (212 unit + hosted contract/integration/security), build clean, CI validate green, db checks clean
- [x] Production untouched (0 migrations)
- [x] Closure plan: `plans/2026-08-19-milestone-5-closure-plan.md`

### Milestone 4: Prompt Enhancement, Confirmation, and Revision (closed 2026-08-18)

- [x] Handler `enhance_prompt`: select provider+key dari DB config, `provider_requests` audit, invoke adapter, zod-validate structured output, persist revision, session → `awaiting_confirmation`, konfirmasi + tombol Generate/Revise Lagi/Batal
- [x] Callback state machine inline webhook: generate (job `generate_image` + `generating`), revise (`awaiting_revision_input`), cancel (`cancelled`); dedupe + owner check + expiry + CAS
- [x] Revision input: `create_revision` RPC (monotonic, immutable, `previous_prompt` audit), re-enhance
- [x] Retry bounded: classification + backoff (cap 8m), `mark_revision_failed` guard, worker-ownership updates
- [x] Migration `20260813074037` (2 RPC + partial unique index + status index) + forward-fix `20260813091942` — dev 11/11, prod 0
- [x] Seed script `seed-provider-config.mjs` (+ .env load, `--env-key`); provider dev: Cloudflare Workers AI gpt-oss-120b (OpenRouter di-deactivate)
- [x] 7 bug fixed selama E2E (registry import, base_url merge, session shape, callback wiring, prompt_session_id, revision processing, test isolation)
- [x] E2E dev verified: prompt → enhancement → konfirmasi → revise loop → generate (job queued) → batal
- [x] All verification: lint 0, typecheck clean, 179 unit + hosted contract/integration green, build clean, CI validate #25-#32 success, db checks clean
- [x] Production untouched (0 migrations)
- [x] Closure plan: `plans/2026-08-18-milestone-4-closure-plan.md`

### Milestone 3: Telegram Intake and Durable Jobs (closed 2026-08-13)

- [x] Webhook route `/api/telegram/webhook` (POST only, secret constant-time, body < 1MB, zod parse)
- [x] Parser message + callback_query, reject group/channel; allowlist via `bot_users`
- [x] Checks: prompt length ≤ 4000, active session, rate limit (derived dari `prompt_sessions`)
- [x] `telegram_updates` insert idempotent + `callback_events` dedupe
- [x] RPC `create_initial_session` (definer, fixed search_path, service_role only) — migration `20260810150719`
- [x] `/api/jobs/process` skeleton (JOB_PROCESSOR_SECRET, claim via `claim_job`, 200 no-op)
- [x] Inline dispatcher `fetch` ke processor setelah commit (best-effort, sessionOrigin)
- [x] `scripts/set-telegram-webhook.mjs` (set/get/delete, HTTPS + APP_ENV guard)
- [x] Env secrets zod (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`)
- [x] Seed allowlist admin `20260813100000` (83540732/alamaby) — applied dev 9/9
- [x] Tests: unit (webhook/parser/client/jobs/auth/bigint-helper) + contract (initial-session, callback dedupe) — 222 unit pass, hosted 79/79
- [x] CI validate green; `migrate-development.yml` sukses (run 31670269521 setelah fix `540c430`)
- [x] Vercel Preview env vars diset; Deployment Protection dimatikan utk Preview; webhook terpasang
- [x] E2E: prompt → "Prompt diterima. Sedang dalam antrian...", session `received`, revision `pending`, job `queued`, telegram_updates unik
- [x] Production untouched (0 migrations)
- [x] PR #1 committed: `db11ed1` (src) + `bfd558f` (docs/tests/runbook) + `540c430` (test fix)

### Milestone 2: Provider Abstraction and Configuration (completed 2026-08-10)

- [x] M2 implementation + review remediation (commit `209847d` + `35a9cab`, run `31311782574`, hosted 67/0)
- [x] M2 closure: M/L transcribed (M1/M4/M5/M6 + C-Low A fixed, M7/M8/M10/M13-M16 + L2-L14 accepted), acceptance criteria checked, 143 tests + hosted 67/0
- [x] Production untouched (0 migrations)

### Milestone 0: Repository Foundation

- [x] Initialize Next.js app (16.3.0, src/ layout, TypeScript strict, ESLint)
- [x] Add lint, typecheck, test, build scripts
- [x] Add validated server environment module (`src/env.ts`, zod)
- [x] Add `/api/health` route (Node.js runtime, DB reachability sanitized)
- [x] Add Supabase server client wrapper (`src/server/supabase/admin.ts`)
- [x] Add vitest + baseline unit test (6 passing)
- [x] Add vercel.json + Node.js runtime defaults
- [x] Add GitHub Actions validate.yml + gitleaks secret scan
- [x] Add prettier formatter + `.env.example` + docs/environment-variables.md

### Verification (Milestone 0)

- [x] `npm ci`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run format:check`
- [x] Health endpoint smoke test: HTTP 200 `{"status":"ok","environment":"production","database":"unconfigured"}` (tanpa env Supabase, tidak membocorkan detail)

### Remediation (Milestone 0)

- [x] Fix typecheck by generating route types before tsc (commit `b38f410`)
- [x] Normalize trailing slash on SUPABASE_URL (src/env.ts)
- [x] Health endpoint returns HTTP 503 on DB failure (`status: "degraded"`), HTTP 200 only when reachable (src/app/api/health/route.ts)
- [x] Health endpoint sends `Cache-Control: no-store`
- [x] Add health endpoint unit tests covering all states (reachable, unreachable, unauthorized, unconfigured, 404 codes, 401/403, 500, network failure) — tests/unit/health.test.ts
- [ ] Verify Vercel Preview deployment succeeds
- [ ] Verify Preview health returns `environment: "development"` and `database: "reachable"`
- [ ] Verify Production health returns `environment: "production"` and `database: "reachable"`
- [ ] Update evidence in plan Progress Log

### Belum terverifikasi (butuh platform)

- [x] CI passes from clean checkout (commit `b38f410`, validate green)
- [x] Vercel Preview/Production deployment succeeds
- [x] Health endpoint reaches hosted Supabase (production reachable on https://albot-ten.vercel.app/api/health)

### Evidence M0

- [x] Commit SHA: `bd9d67a` (foundation), `b38f410` (CI fix), `13c0a55` (probe fix) — committed
- [x] CI run URL: https://github.com/alamaby/albot/actions/runs/31156751229 (validate green)
- [x] Vercel URL: https://albot-ten.vercel.app/
- [x] Health response (`GET /api/health`): `{"status":"ok","environment":"production","database":"reachable"}` (terverifikasi live)
- [x] Secret scan result: gitleaks ada di workflow validate (terverifikasi via run CI di atas)

### Supabase projects + GitHub Environments (provisioned & verified 2026-08-08)

- [x] Development project ada dan distinct: ref `ceqcitzbosqzxpbtlpfn` (bukan BagiStruk), migration history kosong
- [x] Production project ada dan distinct: ref `pcexxtckvwmiquseznaz`, migration history kosong
- [x] `supabase init` (config.toml) + `supabase link` ke dev; `supabase migration list` dev kosong
- [x] Ref non-secret direkam di `docs/environment-variables.md`; `.env` lokal (gitignored) berisi secret
- [x] GitHub Environments `development` dan `Production` dibuat dengan required reviewer `@alamaby` (verified via API) + secrets per environment

### Milestone 1: Database Foundation (implemented & locally verified 2026-08-08)

- [x] Migration core schema (11 tables, named constraints, indexes, triggers, cyclic FK aman) — `20260808145500`
- [x] Migration RLS + grants (RLS enable+force, revoke anon/authenticated, grant service_role) — `20260808145600`
- [x] Migration atomic functions (`claim_job` SKIP LOCKED + `transition_prompt_session` compare-and-set) — `20260808145700`
- [x] Migration hardening (revoke EXECUTE API roles dari functions) — `20260808145800`
- [x] Migration cross-entity ownership + function hardening (composite FK + least-privilege) — `20260808160000` / `20260808160100`
- [x] Applied ke development via CLI + workflow: dev migration count 6, prod count 0
- [x] Generated `database.types.ts` dari dev; `getSupabaseAdmin()` typed `SupabaseClient<Database>`; regen idempotent
- [x] Test harness hosted (skip tanpa kredensial): schema integration 15, service-role 2, RLS security 7, contract 18
- [x] Workflows: `validate.yml` + db:lint/db:check-migrations; `migrate-development.yml`; `migrate-production.yml` (belum dijalankan)
- [x] Verifikasi lokal: lint, typecheck, build, format:check, 67/67 tests, db:check-migrations, db:lint, db:types:check
- [x] M1 + remediation workflow development sukses (run 31252455316)

## Decisions Needed

- [x] Pixazo PixelForge `type` Opsi 2 (configurable via `settings.type` default `tags,caption`, allowlist `tags`/`caption`/`tags,caption`) — confirmed 2026-08-21 (user). Adapter baca `settings.type`/`settings.size` default `1`, validasi strict; tidak expose ke Telegram MVP.
- [x] Drop `negativePrompt`/`aspectRatio` untuk PixelForge — confirmed 2026-08-21. Flux/SDXL tetap pakai mapping.
- [x] Tabel terpisah untuk default per-user (`user_image_preferences`) — confirmed 2026-08-21, bukan kolom `bot_users`.
- [x] 3 model tetap aktif (Flux+SADXL+PixelForge) — confirmed 2026-08-21.
- [x] Hybrid selection + picker di result `Regenerate` — confirmed 2026-08-21.

## Enhancement Backlog

- [ ] Image-reference poster composition menggunakan foto properti (setelah plan awal selesai)
