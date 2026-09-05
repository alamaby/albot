# Skip Failed-Session Expiry Notification

Date: 2026-09-05 ~15:50 WIB (UTC+7)

## Task / Problem
User melaporkan bot prod membalas "Sesi telah berakhir. Kirim prompt baru untuk memulai sesi baru." Investigasi (read-only SELECT prod) membuktikan pesan itu by-design tapi menyesatkan: sweep `recover_stale_sessions` men-expire sesi lama `81844d25` (enhance gagal `provider_request_invalid`, sudah dapat retry path) pada 06:16 UTC — tepat saat sesi aktif baru `93f96f94` (`awaiting_confirmation`, `expires_at` 2026-09-06) berjalan. User memilih: skip notifikasi sweep hanya untuk sesi failed.

## Key Files Changed
- `src/server/repositories/recovery.repository.ts` — helper baru `findStaleFailedSessionIds()` (status failed + `expires_at <= now()`, limit batch)
- `src/server/jobs/recovery.ts` — pre-fetch Set id failed sebelum sweep; loop langkah 3 skip kirim + log `recovery.notify_skipped_failed`; fail-open (lookup gagal → notifikasi seperti semula); `staleSessionsExpired` tetap hitung penuh
- `tests/unit/recovery.test.ts` — 2 test baru (failed di-skip + hanging tetap dinotifikasi; lookup gagal → fail-open); 2 mock `from` lama dilengkapi chain select/in/lte/limit
- `docs/runbooks/milestone-6-incident-response.md` — langkah 2 seksi 4: notifikasi hanya untuk sesi non-failed
- `plans/2026-09-05-skip-failed-session-expiry-notification.md` — plan file (AGENTS.md §7)

## Decisions
- App-only pre-fetch, tanpa migration: `recover_stale_sessions` return row pasca-update (status awal hilang); ubah RPC butuh workflow migration penuh (EXPECTED_MIGRATIONS/FUNCTIONS, db:types) — overkill untuk notifikasi best-effort.
- Failed TIDAK dikeluarkan dari WHERE sweep: `purge_expired_metadata` hanya hapus completed/cancelled/expired — sesi failed harus tetap disapu jadi `expired`, hanya notifikasinya yang di-skip.
- 3 pemicu lain tidak diubah: callback basi (`callback-state-machine.ts:166`), revision-input expired (`handle-telegram-update.ts:356`), worker expired handlers.

## Assumptions / Risks
- TOCTOU race kecil (sesi transisi ke failed antara pre-fetch dan sweep → tetap ternotifikasi sekali). Diterima: notifikasi best-effort, tidak ada korupsi state.
- Sesi failed yang diabaikan user tidak lagi dapat pengingat kedua saat disapu 24 jam kemudian — trade-off yang disetujui.

## Blockers / Unresolved
- Tidak ada. `test:hosted`/contract tidak dijalankan (tanpa perubahan skema; CI akan menutupnya).

## Verification
- `npm run typecheck` ✓, `npm run lint` 0 errors (2 pre-existing warnings `e2e-m6-fault-injection.mjs`), `npm run test:unit` 359/359 ✓ (357 + 2 baru), `npm run format:check` ✓, `npm run build` compile+TS pass; tahap akhir symlink adapter Vercel gagal `EPERM` — pre-existing Windows issue (tercatat di runbook `manual-deploy.md:67`), sukses di CI Linux.

## Commit Proposal
`fix(recovery): skip stale-expiry notification for already-failed sessions`

## Related
- Plan: `plans/2026-09-05-skip-failed-session-expiry-notification.md`
- Investigasi prod: sesi `93f96f94` (aktif) vs sweep `81844d25` (failed, `provider_request_invalid`)
