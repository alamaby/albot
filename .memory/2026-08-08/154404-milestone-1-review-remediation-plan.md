# Review & Remediation Milestone 1

Created: 2026-08-08 15:44:04

## Task / Problem

Code review read-only commit `bb0f2b0` (implementasi M1) menemukan gap terhadap plan M1: gate deployment/evidence lemah, database tidak menjaga ownership lintas entity, authenticated role belum dites, schema assertions dangkal.

## Key Findings (prioritas)

- Critical: production workflow tanpa development attestation; production workflow masih bisa dijalankan selama M1.
- High: generated-type drift check menimpa tracked file dulu; hosted tests bisa skip total tapi workflow hijau; instalasi CLI global berisiko; dev workflow menerima branch/tag arbitrary; cross-entity ownership belum enforced; transition_prompt_session bisa pasang child session lain; authenticated role tidak dites; schema assertions dangkal.
- Medium: revoke `public` tidak explicit; `set_updated_at` executable API roles; constraint/index tests tidak cek definisi; claim test tidak terisolasi; fixture cleanup tidak aman; evidence artifact tidak berisi evidence; prod smoke hanya parse migration list; migration immutability tidak enforce; SQL scanner regex-based; prod confirmation pakai ref yang sama-sama bisa salah; GitHub Actions mutable tags.

## Decisions

- Remediation memakai forward-fix migrations (applied migrations immutable).
- Composite FK + composite unique keys untuk enforce ownership antar entity.
- `claim_job`: queued/retry_scheduled butuh `available_at <= now()`; processing dengan lease expired claimable terlepas dari `available_at`.
- `transition_prompt_session`: validasi active pointer milik session; terminal guard dipertahankan.
- Revoke table privileges dari `public, anon, authenticated`; revoke `set_updated_at` execute dari API roles.
- `REQUIRE_HOSTED_TESTS=true` di workflow dev: hosted tests gagal (bukan skip) jika credential hilang; vitest JSON reporter + assert script menjamin test count > 0 dan skip = 0.
- Type drift check generate ke temp lalu bandingkan dengan tracked file (tanpa overwrite).
- Supabase CLI dipin via devDependency + `npx`, bukan global npm.
- Production workflow butuh input `development_run_id` + verifikasi conclusion/head_sha via GitHub API; ref production independent (non-secret) dibandingkan.
- Pin GitHub Actions ke full commit SHA.

## Verification Performed

- ACL nyata: `claim_job`/`transition_prompt_session` hanya service_role; `set_updated_at` masih public/anon/authenticated (sebelum remediation).
- Policies: 0 permissive policy pada core tables.
- Dev migration count 4 (baseline); prod migration count 0.

## Implementation Progress (2026-08-08 16:05)

- Forward-fix migrations: `20260808160000` composite FK ownership, `20260808160100` fungsi+grants hardening. Dev count 6, prod 0.
- ACL pasca-remediation: anon/authenticated/public tanpa execute & tanpa table grants; hanya service_role. `set_updated_at` direvoke dari API roles. `prosecdef` + `search_path` benar.
- Schema assertions diperluas: type/nullable/default, constraint defs, FK actions, index def+predicate, function security, grants, exact migration versions.
- RLS suite + authenticated role (disposable user via auth.admin), write denial, provider_keys khusus.
- Contract suite + negative ownership (cross-session revision/attempt/job/provider-key), lease future-available_at recovery, retry future, deterministic ordering.
- 40 hosted tests, 0 skip, assert-hosted-tests lulus. `REQUIRE_HOSTED_TESTS` mode.
- Type-drift check generate ke temp tanpa overwrite tracked file.
- CLI dipin devDependency `supabase@2.108.0`; workflow pakai `npx --no-install supabase`.
- Workflow dev require commit_sha (40 char, ancestor main) + verifikasi HEAD; production butuh `development_run_id` attestation (conclusion+head_sha) + independent ref `pcexxtckvwmiquseznaz`; actions di-pin commit SHA.
- Migration immutability guard (PR) + db-lint diperbaiki.
- Sisa: jalankan `migrate-development.yml` pada commit remediation (approval user), capture evidence, konfirmasi dashboard-only drift.

## Evidence (2026-08-08 17:30)

- `migrate-development.yml` sukses pada commit `dba67ce` — run `31252455316`, job `93090792381`, conclusion success, workflow_id `329893700`. URL: https://github.com/alamaby/albot/actions/runs/31252455316
- Dev migration count 6 (Local==Remote, no pending); prod migration count 0.
- Sisa: konfirmasi tidak ada schema object hanya dari dashboard.

## Open Items / Blockers

- (none untuk memulai) — eksekusi remediation plan `plans/2026-08-08-milestone-1-review-remediation-plan.md`.

## Conventional Commit Proposal

`fix(db): harden milestone 1 schema security and migration gates`

## Related

- `plans/2026-08-08-milestone-1-review-remediation-plan.md`
- `plans/2026-08-08-milestone-1-database-foundation-plan.md`
- `TODO.md`
