# Project Memory

Last updated: 2026-08-08 14:45:00

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Active milestone: Milestone 1 (Database Foundation) — blocker platform resolved; Phase 1 partially done, implementation not started
- Supabase projects confirmed: dev `ceqcitzbosqzxpbtlpfn`, prod `pcexxtckvwmiquseznaz` (distinct, both baseline empty, distinct from BagiStruk `cxgllbkbcwnqlyjoshsb`)
- GitHub Environments `development` + `Production` created with required reviewer `@alamaby` and per-environment secrets
- Health endpoint acts as readiness probe: HTTP 200 `status:ok` when DB reachable, HTTP 503 `status:degraded` otherwise, `Cache-Control: no-store`

## Active Decisions

- Environment variables: `APP_ENV` overrides, else derived from `VERCEL_ENV` (`production` → production, otherwise development)
- Health endpoint: HTTP 503 on DB failure (readiness semantics)
- Supabase URL normalization: trailing slash stripped
- Secret management: Vercel Encrypted variables (Sensitive); Supabase CLI secrets via GitHub Environments
- Probe classification: 200 → reachable; 404 with `42P01`/`PGRST205` → reachable; 401/403 → unauthorized; other → unreachable
- CI: GitHub Actions validate (lint, typecheck, format, unit, build, gitleaks)
- Migration: Database as Code via `supabase/migrations`; M1 hanya mengeksekusi ke development

## Open Blockers

- (none) — M1 platform blocker resolved
- Vercel Preview alias not configured
- Telegram bot tokens not set
- Pixazo API documentation pending

## Recent Entries

- `2026-08-08/143241-resolve-milestone-1-platform-blocker.md` — M1 platform blocker resolved (Supabase projects verified, baseline clean, docs updated)
- `2026-08-08/130128-milestone-1-database-foundation-plan.md` — Detailed M1 schema, RLS, atomic functions, hosted workflow plan
- `2026-08-08/150000-milestone-0-review-remediation-plan.md` — Milestone 0 review, health 503 remediation, test coverage
- `2026-08-07/123000-telegram-image-bot-implementation-plan.md` — Original implementation plan

## Related Plans

- `plans/2026-08-07-telegram-image-bot-implementation-plan.md` — Active plan
- `plans/2026-08-08-milestone-0-review-remediation-plan.md` — Active plan (remediation)
- `plans/2026-08-08-milestone-1-database-foundation-plan.md` — Detailed Milestone 1 execution plan
