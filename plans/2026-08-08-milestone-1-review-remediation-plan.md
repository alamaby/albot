# Milestone 1 Review Remediation Plan

Created: 2026-08-08 15:44:04

## Objective

Menutup temuan code review Milestone 1, memperkuat database invariants, security tests, generated-type verification, migration workflows, dan evidence gate tanpa menjalankan migration ke production.

M1 hanya dapat diterima setelah:
- development workflow sukses pada exact commit;
- semua hosted tests benar-benar berjalan, bukan skip;
- schema/grants/function security assertions lengkap;
- production workflow tidak dapat berjalan tanpa development attestation;
- production migration history tetap tidak berubah.

## Scope

- Perbaiki composite ownership invariants antar session, revision, attempt, job, provider config, dan provider key.
- Perketat `transition_prompt_session` dan `claim_job` lease semantics.
- Tambah authenticated-role security coverage.
- Tambah exact schema, constraints, indexes, function ACL, RLS, dan migration assertions.
- Perbaiki generated type drift check (tanpa overwrite tracked file).
- Perbaiki hosted test credential validation dan zero-skip enforcement.
- Ganti instalasi Supabase CLI workflow dengan metode pinned yang valid.
- Batasi migration workflow ke exact reviewed commit SHA.
- Tambah development attestation sebelum production workflow.
- Tambah sanitized migration evidence manifest.
- Enforce migration immutability.
- Perketat SQL safety validation.
- Pin GitHub Action dependencies ke full commit SHA.
- Update TODO, plan M1, memory, dan evidence tracking.

## Out Of Scope

- Menjalankan migration production.
- Menambah repository/application layer di luar kebutuhan test contract.
- Menambah permissive browser policies.
- Menambah provider encryption service.
- Menjalankan destructive reset terhadap shared development database.
- Menghapus atau mengedit migration yang sudah applied; remediation memakai forward-fix migration.

## Remediation Gates

1. **Schema integrity gate**
   - Cross-entity ownership constraints lulus negative tests.
   - Active pointers hanya menunjuk child session yang sama.
   - All required types, nullability, defaults, check definitions, FK actions, and indexes match expected catalog contract.

2. **Security gate**
   - `anon` dan `authenticated` gagal membaca dan menulis seluruh core tables.
   - `anon` dan `authenticated` gagal execute all internal functions.
   - `public` tidak memiliki table/function privileges.
   - `service_role` hanya memiliki privileges yang direncanakan.
   - `set_updated_at` tidak executable oleh API roles.
   - RLS enabled + forced, no permissive policies.

3. **Workflow gate**
   - Development workflow requires full exact SHA.
   - CLI installation succeeds on clean Ubuntu runner.
   - Hosted tests fail on missing required secrets.
   - Generated type check compares temp output against tracked file without overwriting it.
   - Evidence artifact includes success status, commit SHA, migration hashes, migration list, test counts, skipped counts, schema/security reports.

4. **Production safety gate**
   - Production workflow cannot run during M1.
   - Future production run requires verified successful development workflow run ID.
   - Exact commit SHA matches development attestation.
   - Production project ref is independently verified.
   - Post-migration smoke uses catalog assertions, not only migration-list formatting.

## Tasks

### Phase 1: Freeze Baseline And Review Inventory

- [x] Record review findings against commit `bb0f2b0`.
- [x] Confirm development migration versions currently applied: `20260808145500` through `20260808145800`.
- [x] Confirm production migration count remains zero.
- [x] Save non-sensitive baseline migration hashes.
- [x] Keep production workflow disabled during remediation.
- [x] Do not edit applied migrations; use forward-fix migrations.

### Phase 2: Cross-Entity Database Invariants

- [x] Add composite unique keys needed for parent identity.
- [x] Add composite foreign keys preventing revision/session mismatch.
- [x] Add composite foreign keys preventing generation attempt/session/revision mismatch.
- [x] Add composite foreign keys preventing job/session/revision/attempt mismatch.
- [x] Add composite foreign key or trigger preventing provider request/config/key mismatch.
- [x] Add forward-fix migration with named constraints.
- [x] Add negative integration tests for every mismatch combination.
- [x] Validate existing development fixtures before applying constraints.
- [x] Document nullable composite-FK behavior.

### Phase 3: Session Transition Safety

- [x] Add validation that `p_active_revision_id` belongs to `p_session_id`.
- [x] Add validation that `p_active_generation_attempt_id` belongs to `p_session_id`.
- [x] Preserve compare-and-set stale behavior.
- [x] Keep terminal-state exit rejection.
- [x] Add tests for cross-session active pointer rejection.
- [x] Add tests proving invalid pointer input does not mutate session.

### Phase 4: Job Claim Semantics

- [x] Decide and document lease/retry interaction.
- [x] Update `claim_job` forward-fix function migration.
- [x] Add test for expired processing job with future `available_at`.
- [x] Add test for retry-scheduled future job.
- [x] Add deterministic multi-job ordering test.
- [x] Add preflight assertion that no unrelated claimable jobs exist in test target. (cleanup leftover tagged jobs di beforeAll)
- [ ] Move hosted tests to dedicated development integration target or isolated test database. (accepted risk: shared dev + preflight cleanup)
- [x] Make cleanup remove all tagged fixtures, including partial setup remnants. (track id segera, cleanup afterEach)
- [x] Assert cleanup failures explicitly. (RLS suite throws jika cleanup gagal)

### Phase 5: Security Grants And Authenticated Coverage

- [x] Add forward-fix migration revoking table privileges from `public, anon, authenticated`.
- [x] Revoke function execute on `set_updated_at` from `public, anon, authenticated`.
- [x] Grant only intended function/table privileges to `service_role`.
- [x] Add catalog grant assertions using `has_table_privilege`, `has_function_privilege`, `pg_proc.proacl`.
- [x] Create disposable authenticated test user in development.
- [x] Generate authenticated JWT/session for test client.
- [x] Test authenticated reads for all core tables.
- [x] Test authenticated insert/update/delete denial for all core tables.
- [x] Test authenticated execution denial for both atomic functions.
- [x] Verify provider key table has no API-role privilege.
- [x] Verify no permissive policy exists on core tables.
- [x] Cleanup disposable auth user and fixtures in `finally`.

### Phase 6: Exact Schema Contract Assertions

- [x] Expand column assertions to exact data type, udt, nullable, default, identity state.
- [x] Assert every required named constraint definition with `pg_get_constraintdef`.
- [x] Assert all FK targets and `ON DELETE` actions.
- [x] Assert all unique constraints and composite key columns.
- [x] Assert all JSON object checks, status allowlists, timestamp and lock consistency checks.
- [x] Assert exact index columns/order/predicate using `pg_get_indexdef`.
- [x] Assert `prosecdef = true` dan function `search_path` untuk atomic functions.
- [x] Assert function return types and argument defaults.
- [x] Assert exact migration versions, not only `arrayContaining`.
- [x] Add schema assertion output as JSON/Markdown artifact. (lewat vitest json report di evidence artifact)

### Phase 7: Generated Types And Test Mode

- [x] Change type generation verification to write temp output only (no overwrite).
- [x] Compare temp output against tracked `database.types.ts`.
- [x] Add `REQUIRE_HOSTED_TESTS` mode dan fail workflow jika credential hilang.
- [x] Split credential validation by suite requirements.
- [x] Assert expected test count > 0 dan skipped count = 0 di hosted workflow.
- [x] Keep offline PR workflow deterministic dengan explicit skip mode.

### Phase 8: Migration Immutability And SQL Safety

- [x] Add base-vs-head migration immutability check.
- [x] Reject modification/deletion/rename of applied migration files.
- [x] Allow only new timestamped forward-fix migration files.
- [x] Improve SQL scanner (comment stripping, ALTER TYPE, SET NOT NULL, RENAME, broad DML, EXECUTE, dynamic SQL, allowlist).
- [ ] Add tests for scanner false-positive and false-negative cases.
- [x] Add migration SHA-256 manifest generation.

### Phase 9: Workflow Reliability

- [x] Replace global npm Supabase CLI install with pinned local dependency.
- [x] Require full 40-character commit SHA untuk development workflow.
- [x] Verify checked-out SHA equals requested SHA.
- [x] Verify SHA is an ancestor of `main`.
- [x] Pin GitHub Actions ke full commit SHA.
- [x] Development workflow menghasilkan run ID, commit SHA, project ref, migration versions/hashes, before/after list, test counts, skipped counts, generated-type digest, schema report.
- [x] Tambah failed/success status ke evidence manifest.

### Phase 10: Production Safety Attestation

- [x] Keep production apply effectively gated (attestation) selama M1 remediation.
- [x] Add independent expected production project ref.
- [x] Validate production URL/ref/project metadata.
- [x] Require development workflow run ID sebagai production input.
- [x] Query GitHub API untuk development run conclusion + head_sha match.
- [x] Verify required test suites passed with zero skips.
- [x] Add read-only production catalog smoke test.
- [x] Do not execute production workflow during M1.

### Phase 11: Verification And Evidence

- [x] Run offline lint, typecheck, format, build, unit tests.
- [x] Run migration static checks.
- [x] Run schema/security/contract tests dengan required secrets. (40 hosted tests, 0 skip)
- [ ] Run development workflow pada exact remediation commit.
- [ ] Re-run development migration dan verify no pending.
- [ ] Capture workflow URL, run ID, exact commit SHA, migration versions/hashes.
- [x] Capture schema assertion report, RLS/grant report, authenticated-role report, concurrency report, generated-type clean-diff.
- [x] Verify production migration count tetap nol.
- [ ] Verify no dashboard-only schema objects.
- [ ] Update M1 plan acceptance criteria, `TODO.md`, `.memory/README.md`, remediation entry.

## Acceptance Criteria

- [ ] All Critical findings resolved.
- [ ] All High findings resolved.
- [ ] Medium findings resolved atau explicitly accepted dengan documented risk.
- [ ] Development workflow succeeds on exact reviewed commit.
- [ ] Hosted tests run, with expected counts and zero skipped tests.
- [ ] Schema catalog assertions match plan exactly.
- [ ] Authenticated dan anon security tests pass.
- [ ] Function dan table ACLs match least-privilege matrix.
- [ ] Generated types compare cleanly without workflow overwrite.
- [ ] Migration immutability guard passes.
- [ ] Evidence manifest complete dan sanitized.
- [ ] Production workflow blocked without development attestation.
- [ ] Production migration history unchanged during M1 remediation.

## Risks

- **Composite FK migration can fail jika development berisi fixtures inconsistent.** Mitigation: read-only inconsistency query dulu; hanya clean tagged test fixtures; forward-fix constraints setelah validasi.
- **Authenticated test user lifecycle dapat memengaruhi development auth.** Mitigation: unique disposable email, explicit cleanup, fail on cleanup error, dedicated development project.
- **Production attestation workflow menambah GitHub API dependency.** Mitigation: fail closed; require run conclusion, SHA, hash match.
- **Pooler host derivation bergantung pada Supabase Management API.** Mitigation: support explicit `SUPABASE_DB_HOST`; validate region-derived host.
- **Stricter migration immutability blocks legitimate corrections.** Mitigation: gunakan new forward-fix migration; jangan edit applied migration.
- **Shared hosted development masih rawan external worker interference.** Mitigation: dedicated test project atau isolated CI database; preflight claimable-job check.

## Progress Log

- 2026-08-08 15:44:04 — Review read-only terhadap commit `bb0f2b0` dan kesesuaian plan M1 selesai. Findings utama: production workflow tidak punya development attestation, generated-type check menimpa tracked target, hosted tests bisa skip, CLI installation workflow berisiko gagal, cross-entity ownership belum enforced, authenticated role belum dites, schema assertions dangkal, evidence artifact tidak lengkap.
- 2026-08-08 16:05 — Implementasi remediation inti selesai dan terverifikasi lokal (prod migration history tetap 0; dev 6 migrations). Migration forward-fix: `20260808160000` (composite FK ownership), `20260808160100` (harden fungsi + grants). ACL terverifikasi: hanya service_role yang execute/read; `set_updated_at` tidak executable API roles; `prosecdef` + `search_path` benar. Test hosted: integration 15, security 7 (termasuk authenticated role), contract 18 (termasuk negative ownership, lease semantics, deterministic ordering) = 40 tests, 0 skip, assert script lulus. Schema assertions diperluas (type/nullable/default, constraint def, FK actions, index def+predicate, function security, grants, exact migration versions). Type-drift check tanpa overwrite. `REQUIRE_HOSTED_TESTS` + `test:hosted` + `assert-hosted-tests.mjs`. CLI dipin devDependency (`supabase@2.108.0`, `npx --no-install`). Workflow dev require exact commit SHA + ancestor-main; workflow production butuh `development_run_id` attestation (conclusion + head_sha) + independent ref; actions di-pin ke commit SHA. Migration immutability guard (PR) + db-lint diperbaiki (comment stripper + pola lebih luas). Migration hashes baseline:
  - `20260808145500` cccc038a5aca92a7e95b127ff9aa832af19c87e525abe06726de869c4e00b495
  - `20260808145600` b1e4e70a86ca197d0ddea581d4d0421a9f1a8438a1140b3b0e302b4185def9ab
  - `20260808145700` 46f2ee93f42e7b23abd455d3ea4185c6c4c174203be25154994860c197131c9d
  - `20260808145800` 984a32679bd6702eeeeeb5051cae3e9d567382e143883a620efab8cb53c362c1
  - `20260808160000` 2828d6b0d0f64a1649086c5d67b651e44d1157a72ca899d4b886736acdae34a5
  - `20260808160100` 5b4acf60a48cb54a0024dfef924bd2bc3fd7bfca75c2eae28aabb42824f0451e
- Sisa Phase 11: jalankan `migrate-development.yml` pada commit remediation (approval user), capture workflow URL/run ID, konfirmasi dashboard-only drift, update acceptance M1.

## Notes

- Production migration dilarang selama M1.
- Semua migration yang sudah applied immutable; remediation memakai forward-fix migration.
- Review tidak mengubah file, database, commit, atau remote.
- Proposed remediation commit: `fix(db): harden milestone 1 schema security and migration gates`
