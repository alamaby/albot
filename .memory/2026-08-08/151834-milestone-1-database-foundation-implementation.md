# Implementasi Milestone 1 Database Foundation

Created: 2026-08-08 15:18:34

## Task / Problem

Implementasi Milestone 1: database foundation versioned, RLS ketat, atomic job/session operations, generated types, test harness hosted, dan workflow migration dev/prod.

## Key Changes

- `supabase/migrations/` 4 migration (sudah di-apply ke development, count 4; prod tetap 0):
  - `20260808145500_create_core_schema.sql` — 11 tables, named constraints/checks, indexes, `set_updated_at()`, triggers, cyclic active-pointer FK ditambahkan setelah child tables.
  - `20260808145600_add_rls_and_grants.sql` — RLS enable+force semua core table, revoke anon/authenticated, grant service_role.
  - `20260808145700_add_atomic_functions.sql` — `claim_job(text, integer)` (SKIP LOCKED, due/max-attempt/lease-expiry, lease recovery) dan `transition_prompt_session` (compare-and-set, terminal guard, completed_at). `security definer`, fixed search_path, revoke public, grant service_role.
  - `20260808145800_revoke_function_execute_from_api_roles.sql` — Supabase auto-grant EXECUTE ke anon/authenticated; revoke explicit dari `public, anon, authenticated`.
- `src/server/supabase/database.types.ts` (generated dari dev), `admin.ts` typed `SupabaseClient<Database>`.
- Scripts: `check-migrations.mjs`, `db-lint.mjs`, `verify-generated-types.mjs`; package scripts `db:*`, `test:integration/security/contract`.
- Tests: `tests/integration/schema.integration.test.ts`, `tests/integration/service-role.integration.test.ts`, `tests/security/rls.security.test.ts`, `tests/contract/database-functions.contract.test.ts`, helpers (`hosted.ts`, `setup-env.ts`). Vitest `fileParallelism: false`.
- Workflows: `validate.yml` (+db:lint, db:check-migrations), `migrate-development.yml`, `migrate-production.yml`.

## Technical Decisions

- Lease input: `p_lease_seconds integer` bounded (1..86400, default 300), bukan `interval`.
- `claim_job` memulihkan job `processing` dengan lease kedaluwarsa (lease recovery).
- `transition_prompt_session` return `setof` (zero-row untuk stale), terminal guard di SQL; matrix penuh di application layer.
- Host DB test: `aws-0-<region>.pooler.supabase.com` port 6543 user `postgres.<ref>`; `db.<ref>.supabase.co` hanya IPv6, `<ref>.pooler.supabase.com` tidak resolve; region di-derive dari Management API via token saat runtime.
- `database.types.ts` masuk `.prettierignore` agar `db:types:check` tidak drift karena prettier.

## Verification

- Local: lint, typecheck, format:check, build, 46/46 tests (unit 27, integration 10, security 2, contract 7), db:check-migrations, db:lint, db:types idempotent.
- Dev migrations applied via CLI; `migration list` Local==Remote; prod count 0 (Management API).

## Open Items / Blockers

- `migrate-development.yml` belum dijalankan (butuh approval user via GitHub); evidence workflow URL/SHA menyusul.
- Konfirmasi tidak ada schema object hanya dari dashboard belum dicek.

## Conventional Commit Proposal

`feat(db): milestone 1 database foundation with rls and atomic functions`

## Related

- `plans/2026-08-08-milestone-1-database-foundation-plan.md` (Phase 1–8 done, Phase 9 sebagian)
- `TODO.md`, `docs/environment-variables.md`
