# TODO

Source of truth untuk tracking progress implementasi. Detail acceptance criteria dan gate ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`.

## Current Milestone

Milestone 4: Prompt Enhancement, Confirmation, and Revision (E2E verified 2026-08-18 — closure evidence pending)

## In Progress

- [x] Implement Milestone 4 (implementation + E2E dev verified)

## Pending

- [ ] Record M4 closure evidence (CI run, migration run, DB timeline, screenshots) dan update plan
- [ ] Implement Milestone 5 dan record verification evidence
- [ ] Implement Milestone 6 dan record verification evidence
- [ ] Implement Milestone 7 dan record verification evidence
- [ ] Execute production release checklist dan operational handoff

## Blocked

- (none)

## Completed

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

- (none)

## Enhancement Backlog

- [ ] Image-reference poster composition menggunakan foto properti (setelah plan awal selesai)
