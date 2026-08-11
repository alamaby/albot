# Project Memory

Last updated: 2026-08-10 16:15:00

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Active milestone: **Milestone 3 (Telegram Intake and Durable Jobs)** — implementasi selesai (218 tests, 8 migrations applied to dev), menunggu Vercel Preview wiring + Telegram bot provisioning
- Milestone 2 (Provider Abstraction and Configuration) **CLOSED** 2026-08-10: implementasi `209847d` + remediation `35a9cab` + closure (M/L transcribed: M1/M4/M5/M6 + C-Low A fixed; M7/M8/M10/M13-M16 + L2-L14 accepted; acceptance criteria checked). Evidence: run `31311782574` (dev 7 migrations Local==Remote, hosted 67/0 skip), 143 unit tests, production 0 migrations untouched
- Supabase projects: dev `ceqcitzbosqzxpbtlpfn` (8 migrations applied), prod `pcexxtckvwmiquseznaz` (0 migrations)
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
- M3 schema change: migration `20260810150719` (create_initial_session RPC) — dev 8 migrations, prod 0

## Open Blockers

- (none) — M2 closed; M3 belum dimulai
- Vercel Preview alias not configured
- Telegram bot tokens not set

## Recent Entries

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

- `plans/2026-08-07-telegram-image-bot-implementation-plan.md` — Active plan
- `plans/2026-08-08-milestone-0-review-remediation-plan.md` — Active plan (remediation)
- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md` — Detailed M2 execution plan (closed)
- `plans/2026-08-09-milestone-2-review-remediation-plan.md` — M2 review remediation plan (closed)
- `plans/2026-08-10-milestone-2-closure-plan.md` — M2 closure plan (closed)
