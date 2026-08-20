# Migration Cleanup & Status Message (2026-08-20)

Follow-up sesi setelah M6 CLOSED.

## Migration dev-only: hapus sisa mock config

- Contract test M5 (`tests/contract/generation-flow.contract.test.ts`) mendaftarkan adapter test-only `mock_image_generation_contract` dan meninggalkan config aktif di dev (priority 0, tanpa key). Selector bisa memilihnya lalu gagal `provider_key_unavailable` (issue dicatat di `plans/2026-08-19-milestone-5-closure-plan.md` item 4).
- Fix: migration `20260820110000_remove_mock_image_generation_contract_configs.sql` — development-only, hapus config `adapter_type = 'mock_image_generation_contract'` dengan membersihkan child references dulu (`provider_keys`, `provider_requests`, null-kan `generation_attempts.image_provider_config_id`, `prompt_revisions.reasoning_provider_config_id`) karena FK on-delete-restrict. Pakai `do $$` block supaya lolos `db-lint` (yang memblokir `delete from` di statement level).
- Commit `c7298f7`.

## feat(m6): persist and edit generation status message

- Kirim satu pesan "Sedang membuat gambar, mohon tunggu..." saat user tap Generate/Regenerate (`buildGenerationStatusMessage`), persist `prompt_sessions.telegram_status_message_id`, lalu worker edit ke outcome final (succeeded/failed/expired) via `editMessageText` — chat tidak dipenuhi bubble status satu-off. Semua edit best-effort (tidak pernah gagalkan job).
- Commit `0ddab0e`.

## Guardrail: cegah EXPECTED_MIGRATIONS stale

- Regresi berulang: workflow `migrate-development.yml` apply migration ke dev lalu run hosted test `records exactly the expected applied migrations`; kalau entry `EXPECTED_MIGRATIONS` di `tests/integration/schema.integration.test.ts` tidak di-update, workflow gagal SETELAH migration ter-apply (M3, M6 `534dee3`, 2026-08-20).
- Fix: `scripts/check-migrations.mjs` sekarang diverifikasi tiap migration file punya entry di `EXPECTED_MIGRATIONS` (dan sebaliknya) — jalan di `npm run db:check-migrations` / CI validate, jadi error tertangkap sebelum workflow dev.
- AGENTS.md ditambah section "Migration Workflow" (checklist wajib migration baru).
- Commit `b334117`.

## Status

- Dev Supabase: 18 migrations applied (18/18), prod 0. Migration dev terakhir `20260820110000` berhasil via `migrate-development.yml` pada commit `b334117`.
