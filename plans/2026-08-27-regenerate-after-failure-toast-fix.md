# Regenerate After Failure — Toast & Stuck Session Fix

Created: 2026-08-27 09:15:00

## Objective
Pulihkan retry dari `generation_failed` tanpa toast “Sesi sedang diproses”, perbaiki `generation_attempts` stuck `processing`, dan diagnosa `provider_unknown_error` yang membuat sesi `7f5645b9-89ec-4a9e-ac12-f8f0c0296266` mati 10 jam.

## Scope
- Fix `src/server/application/callback-state-machine.ts:364` (`handleRegenerate`) dan `:470` (`handleComplete`) agar terima `generation_failed` (keputusan user #1: Selesai boleh dari gagal)
- Fix `src/server/jobs/generate-image.handler.ts:60` + `src/server/application/generate-image.ts:283` agar failure terminal selalu `mark_generation_attempt_failed`
- Diagnosa prod via `supabase-albot-be-production` READ ONLY (jobs `42ec7df3` failed 3/3, attempt `559f8439` processing, session `generation_failed`)
- Tunggu fix code (keputusan #2), tanpa recovery manual Dashboard

## Milestones
1. Diagnosis prod (done READ ONLY — bukti di Objective)
2. Code fix callback + attempt lifecycle
3. Tests & verifikasi lokal
4. E2E Telegram prod: Regenerate/Selesai dari gagal tanpa toast

## Tasks
- [ ] T-2 Fix callback-state-machine: Regenerate & Complete expectedStatus `result_ready|generation_failed`
- [ ] T-3 Fix attempt lifecycle terminal: `mark_generation_attempt_failed` sebelum transition `generation_failed`
- [ ] T-4 Tests: Regenerate/Selesai dari `generation_failed` accepted; attempt failed ter-mark; `provider_unknown_error` path
- [ ] T-6 Verifikasi: `npm run typecheck && lint && test:unit && build` + E2E prod

## Risks
- Selesai dari `generation_failed` menutup sesi tanpa gambar — diterima per keputusan #1, dicatat di Notes; alternatif (hanya Regenerate) ditolak user
- Direct UPDATE `generation_attempts` melanggar RLS FORCE — wajib via RPC `mark_generation_attempt_failed`; MCP UPDATE akan ditolak `Operation denied. This database connection only allows read access.`
- `provider_unknown_error` sebelum HTTP (selektor/key/encryption) — perlu audit `provider_configs.is_active`, `provider_keys.cooldown_until`, `PROVIDER_KEY_ENCRYPTION_KEY`

## Progress Log
- 2026-08-27 09:15:00 — Plan dibuat (RCA via prod READ ONLY: job 42ec7df3 failed 3/3 provider_unknown_error, attempt 559f8439 processing stuck, session 7f5645b9 generation_failed; callback reject karena handleRegenerate hanya result_ready)
- 2026-08-27 09:15:00 — Keputusan user: #1 Selesai boleh dari gagal, #2 tunggu fix code
- 2026-08-27 09:20:00 — Fix callback-state-machine: handleRegenerate & handleComplete terima generation_failed (src/server/application/callback-state-machine.ts:364,470); typecheck/lint/unit 274 passed
- 2026-08-27 09:25:00 — Fix stuck processing: cleanupStuckProcessingAttempt (mark_generation_attempt_failed) sebelum retry dari generation_failed (handleRegenerate + handleGenerate); cegah create_generation_attempt guard “generation already in progress” pada retry

## Notes
- DB MCP READ ONLY (`SELECT/WITH` saja); perubahan via code + Dashboard, bukan `supabase-albot-be-production_execute_sql` UPDATE
- Standar: TOGAF proporsional; deviasi master plan (Regenerate pasca-gagal semula hanya `result_ready`) dicatat di sini
- Keputusan #2: tidak melakukan recovery manual via `transition_prompt_session` di Dashboard; biarkan fix code yang mengembalikan retry path
