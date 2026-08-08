# Project Memory

Last updated: 2026-08-08 18:50:00

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Active milestone: Milestone 2 (Provider Abstraction and Configuration) — implementation in progress (encryption, providers, adapters, tests complete; migration + workflow pending)
- Supabase projects: dev `ceqcitzbosqzxpbtlpfn` (6 migrations applied), prod `pcexxtckvwmiquseznaz` (0 migrations)
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

## Open Blockers

- (none) — M2 implementation in progress
- Vercel Preview alias not configured
- Telegram bot tokens not set

## Recent Entries

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
- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md` — Detailed M2 execution plan
