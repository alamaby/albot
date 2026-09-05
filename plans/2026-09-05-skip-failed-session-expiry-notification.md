# Skip Notifikasi Sweep untuk Sesi Failed

Created: 2026-09-05 00:00:00

## Objective
Notifikasi `recover_stale_sessions` (`src/server/jobs/recovery.ts:185`) saat ini mengirim `session_expired` untuk semua sesi yang disapu — termasuk sesi yang sudah terminal-failed dan sudah menerima tombol retry/baru. Akibatnya user dengan sesi aktif baru mendapat pesan "Sesi telah berakhir..." yang menyesatkan (kasus prod: sweep `81844d25` jam 06:16 saat sesi aktif `93f96f94` berjalan). Plan ini menghentikan notifikasi redundan tersebut tanpa mengubah logika expiry.

## Scope
- item 1: `src/server/jobs/recovery.ts` langkah 3 (notifikasi stale-session)
- item 2: `src/server/repositories/recovery.repository.ts` (helper pre-fetch)
- item 3: `tests/unit/recovery.test.ts`
- item 4: runbook `docs/runbooks/milestone-6-incident-response.md:122`
- Out: tidak ada migration DB, tidak ada perubahan `recover_stale_sessions` SQL, tidak ada perubahan teks bot (`messages.ts:139`), tidak ada perubahan 3 pemicu lain (`callback-state-machine.ts:166`, `handle-telegram-update.ts:356`, worker handlers)

## Milestones
1. Filter skip notifikasi diimplementasi (app-only pre-fetch, tanpa migration)
2. Unit test menutup kedua sisi (failed di-skip, menggantung tetap dinotifikasi)
3. Runbook diperbarui + verifikasi hijau

## Tasks
- [x] Investigasi prod: sesi terakhir `93f96f94` aktif vs sweep `81844d25` (by-design tapi menyesatkan)
- [x] Tambah helper `findStaleFailedSessionIds` (atau inline query) di repository recovery — filter status failed + `expires_at <= now()`, limit batch
- [x] Filter loop notifikasi di `runRecovery` + log skip per sesi (`recovery.notify_skipped_failed`)
- [x] Update `tests/unit/recovery.test.ts`: (a) sesi failed tidak memicu `sendMessage`; (b) sesi menggantung tetap ternotifikasi; (c) `staleSessionsExpired` tetap hitung semua
- [x] Update runbook `milestone-6-incident-response.md:122` — notifikasi hanya untuk sesi non-failed
- [x] Verifikasi: `npm run test:unit`, `npm run lint`, `npm run typecheck`, `npm run build` (tanpa migration → `db:types:check`/`test:hosted` tidak terdampak, tapi jalankan `test:hosted` bila sempat sebagai sanity)

## Risks
- TOCTOU race kecil: sesi bisa transisi ke failed di antara pre-fetch dan sweep → tetap ternotifikasi sekali. Diterima karena notifikasi best-effort; tidak ada korupsi state.
- Sesi failed yang benar-benar basi tidak lagi dapat pesan penutup — memang tujuannya; user sudah dapat retry/baru saat transisi failed. Jika user mengabaikan tombol retry lalu sesi disapu diam-diam 24 jam kemudian, tidak ada pengingat kedua. Trade-off yang disetujui pilihan "skip hanya sesi failed".
- Observabilitas: tanpa log skip, sulit membedakan "tidak ada stale" vs "stale di-skip" — diatasi dengan log `notify_skipped_failed` + `staleSessionsExpired` tetap dihitung penuh.

## Progress Log
- 2026-09-05 — plan disusun dari investigasi prod; cakupan "skip hanya sesi failed" dikonfirmasi user via pilihan.
- 2026-09-05 — switch ke build mode; eksekusi dimulai.
- 2026-09-05 — implementasi selesai: helper `findStaleFailedSessionIds` + filter loop + 2 unit test baru + runbook. Verifikasi: typecheck ✓, lint 0 errors, test:unit 359/359, format:check ✓, build compile+TS pass (symlink EPERM pre-existing Windows). Memory entry `2026-09-05/155000` ditulis. Uncommitted.

## Notes
- Pendekatan app-only pre-fetch dipilih atas alternatif ubah-RPC-return-prev_status (memicu workflow migration penuh: EXPECTED_MIGRATIONS, EXPECTED_FUNCTIONS, db:types regen — overkill untuk notifikasi best-effort).
- Alternatif keluarkan-failed-dari-WHERE-sweep ditolak: sesi failed menumpuk selamanya karena `purge_expired_metadata` hanya menghapus completed/cancelled/expired.
- Tidak ada perubahan skema → tidak ada update EXPECTED_MIGRATIONS/EXPECTED_FUNCTIONS, tidak ada regen database.types.ts.
- count `staleSessionsExpired` tetap hitung penuh (sweep tetap jalan — hanya notifikasi yang di-skip).
