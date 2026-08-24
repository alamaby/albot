# Queue Claim via Recovery — Opsi A (20 menit)

Created: 2026-08-24 01:45:00

## Objective
Hilangkan stuck `"Prompt diterima. Sedang dalam antrian..."` dengan membuat `queued`/`retry_scheduled` yang due pasti ter-claim dalam sweep `recovery-development` tanpa menambah workflow `process-jobs` baru. Cron diringankan ke 20 menit sesuai permintaan.

## Scope
- Tambah step `claimAndProcessDueJobs` di `src/server/jobs/recovery.ts` setelah `expireStaleLeases`, reuse `src/server/jobs/processor.ts:claimNextJob` + `processNextJob` (lease 300s, handlers `enhance_prompt`/`generate_image`).
- Ubah `/.github/workflows/recovery-development.yml:5` dari `*/5 * * * *` ke `*/20 * * * *`.
- Perluas `RecoveryRunResult` dengan `claimedJobs`; log `recovery.claim` dan `recovery.run`.
- Tidak ubah `prompt_sessions_one_active_idx` (`supabase/migrations/20260821090000:18`) dan dispatcher best-effort `src/server/application/handle-telegram-update.ts:370`.

## Milestones
1. Verifikasi stuck (done)
2. Implement claim via recovery
3. Verifikasi hosted + unblock job `be654b96`

## Tasks
- [x] T-1 Validasi stuck: `jobs be654b96 queued` due 2 jam, `prompt_sessions f2d5f0da received` (MCP dev)
- [x] T-2 Implement `RECOVERY_BATCH_CLAIM=3` di `recovery.ts` + inject `processNextJob` untuk testability
- [x] T-3 Update cron `recovery-development.yml` ke `*/20`
- [x] T-4 Unit test `tests/unit/recovery.test.ts` — claimed path + idle (250/250)
- [x] T-5 Verifikasi `npm run db:lint; db:check-migrations; db:types:check; lint; typecheck; test:unit; build` hijau
- [ ] T-6 Manual sweep `POST /api/recovery/run` claim `be654b96` → `succeeded`/`retry_scheduled` dan sesi pindah `enhancing→awaiting_confirmation`
- [ ] T-7 Deploy ke Vercel + verifikasi next cron 20m

## Risks
- **Latency 20m**: worst-case job due menunggu 20m. Mitigasi: batch 3 memastikan tiap tick <5s; alternatif 10m jika UX perlu lebih cepat.
- **Timeout handler**: `pixazo.adapter.ts:43` 120s > `LEASE_SECONDS 300`, aman. Loop claim serial, tidak parallel.
- **Double-spend**: tidak — `claim_job` atomic SKIP LOCKED.
- **Log bloat**: hanya info `recovery.claim`, tidak tulis `job_events` claimed.

## Progress Log
- 2026-08-24 01:45:00 — Plan created, opsi A 20m + batch 3 disetujui, lanjut build.
- 2026-08-24 01:48:00 — Implementasi `recovery.ts` claimedJobs + `recovery-development.yml` `*/20`.
- 2026-08-24 02:43:00 — Verifikasi hijau: typecheck ok, lint 0 error (2 warnings pre-existing), test:unit 250/250, build ok, db:lint ok, db:check-migrations 25, db:types:check ok.
- 2026-08-24 02:44:00 — Job `be654b96` masih `queued` (menunggu sweep 20m berikutnya atau manual trigger).

## Notes
- TOGAF ADM G: reuse `processor.ts` building block.
- Cron ringan: 72 invokasi/hari vs 288 sebelumnya (-75%). Trade-off dibahas dan disetujui user.
- Batch 3 dipilih agar tick 20m tetap ringan; bisa naik ke 5 tanpa migrasi.
