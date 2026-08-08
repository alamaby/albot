# Project Memory

Last updated: 2026-08-08 17:30:07

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Active milestone: Milestone 1 (Database Foundation) — implementasi + remediation committed (`bb0f2b0`, `dba67ce`); dev migration workflow sukses (run 31252455316)
- Supabase projects: dev `ceqcitzbosqzxpbtlpfn` (6 migrations applied), prod `pcexxtckvwmiquseznaz` (0 migrations)
- Remediation M1 (plan `2026-08-08-milestone-1-review-remediation-plan.md`): composite FK ownership, authenticated security, exact schema assertions, REQUIRE_HOSTED_TESTS, type-drift tanpa overwrite, dev attestation prod, pinned CLI via npx — inti selesai, 40 hosted tests hijau, workflow dev sukses
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
- Remediation M1: composite FK ownership, authenticated security tests, exact schema assertions, REQUIRE_HOSTED_TESTS, type-drift tanpa overwrite, dev attestation untuk prod, pinned CLI via npx
- `database.types.ts` di `.prettierignore`; vitest `fileParallelism: false`

## Open Blockers

- (none) — M1 + remediation selesai dengan evidence (dev workflow sukses, dashboard drift bersih)
- Vercel Preview alias not configured
- Telegram bot tokens not set
- Pixazo API documentation pending

## Recent Entries

- `2026-08-08/154404-milestone-1-review-remediation-plan.md` — M1 review findings + remediation plan (composite FK, auth tests, gates)
- `2026-08-08/151834-milestone-1-database-foundation-implementation.md` — M1 implementation (schema, RLS, atomic functions, types, tests, workflows)
- `2026-08-08/143241-resolve-milestone-1-platform-blocker.md` — M1 platform blocker resolved (Supabase projects verified, baseline clean, docs updated)
- `2026-08-08/130128-milestone-1-database-foundation-plan.md` — Detailed M1 schema, RLS, atomic functions, hosted workflow plan
- `2026-08-08/150000-milestone-0-review-remediation-plan.md` — Milestone 0 review, health 503 remediation, test coverage
- `2026-08-07/123000-telegram-image-bot-implementation-plan.md` — Original implementation plan

## Related Plans

- `plans/2026-08-07-telegram-image-bot-implementation-plan.md` — Active plan
- `plans/2026-08-08-milestone-0-review-remediation-plan.md` — Active plan (remediation)
- `plans/2026-08-08-milestone-1-database-foundation-plan.md` — Detailed Milestone 1 execution plan
