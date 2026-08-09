# TODO

Source of truth untuk tracking progress implementasi. Detail acceptance criteria dan gate ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`.

## Current Milestone

Milestone 2: Provider Abstraction and Configuration

## In Progress

- M2 remediation **selesai**: commit `35a9cab`, migrate-development run `31311782574` success (7 migrations dev Local==Remote, hosted 67/0 skip). Tinggal: transcribe sisa M/L findings bila daftar review tersedia, lalu M2 acceptance + evidence final.

## Pending

- [ ] M2 remediation: transcribe & resolve sisa M/L findings (M1/M4-M8/M10/M13-M16, L2-L14) dari daftar review session bila tersedia
- [ ] Complete M2: acceptance criteria + evidence final (M2 plan)
- [ ] Implement Milestone 3 dan record verification evidence
- [ ] Implement Milestone 4 dan record verification evidence
- [ ] Implement Milestone 5 dan record verification evidence
- [ ] Implement Milestone 6 dan record verification evidence
- [ ] Implement Milestone 7 dan record verification evidence
- [ ] Execute production release checklist dan operational handoff

## Blocked

- (none)

## Completed

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
