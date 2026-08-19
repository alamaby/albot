# Metadata Retention Policy

Milestone 6 memperkenalkan purging otomatis metadata sesi yang sudah terminal.
Bot tidak menyimpan gambar (tidak ada Supabase Storage); semua yang di-purge
adalah metadata teks (prompt, job, event, audit).

## Kebijakan

- **Retention window:** 30 hari (`RETENTION_DAYS = 30` di
  `src/server/jobs/recovery.ts`; bisa diubah lewat argumen RPC).
- **Sasaran:** hanya metadata milik sesi terminal (`completed`, `cancelled`,
  `expired`) yang `created_at`-nya lebih tua dari window.
- **Kapan:** setiap run recovery (`/api/recovery/run`, dijadwalkan tiap 5 menit
  oleh workflow `recovery-development.yml`), batch maksimal 1000 baris per tabel
  per run — ringan dan idempotent.
- **Tidak pernah dihapus:**
  - `bot_users` (allowlist permanen) — hanya `last_seen_at` yang boleh di-reset.
  - Sesi non-terminal (aktif).
  - Data lebih muda dari 30 hari.

## Retention per tabel

| Tabel                 | Dipurge | Basis cutoff                     |
| --------------------- | ------- | -------------------------------- |
| `job_events`          | Ya      | milik sesi/purge atau job lama   |
| `provider_requests`   | Ya      | milik job sesi yang di-purge     |
| `jobs`                | Ya      | `prompt_session_id` di-purge     |
| `generation_attempts` | Ya      | `session_id` di-purge            |
| `prompt_revisions`    | Ya      | `session_id` di-purge            |
| `callback_events`     | Ya      | `prompt_session_id` di-purge     |
| `telegram_updates`    | Ya      | `received_at` < cutoff           |
| `prompt_sessions`     | Ya      | terminal + `created_at` < cutoff |
| `bot_users`           | Tidak   | —                                |

Urutan penghapusan child-first (FK semuanya `on delete restrict`):
`job_events` → `provider_requests` → `jobs` → `generation_attempts` →
`prompt_revisions` → `callback_events` → `telegram_updates` →
`prompt_sessions`.

Sebelum children dihapus, `prompt_sessions` yang di-purge di-null-kan dulu
`active_revision_id` dan `active_generation_attempt_id`-nya (FK `on delete
restrict` ke children; sesi terminal yang pernah generate menyimpan pointer ini
sampai purge).

## Cara mengubah

1. Ubah konstanta `RETENTION_DAYS` di `src/server/jobs/recovery.ts`, atau
2. Panggil RPC langsung: `select * from purge_expired_metadata(60, 1000);`
   (service_role only).

## Catatan

- Prompt teks adalah metadata; di-purge setelah 30 hari.
- `telegram_updates` di-purge berdasarkan umur saja (tidak ada FK sesi);
  dedupe update hanya butuh row di sekitar window delivery Telegram. Per run
  dibatasi `p_max_rows` (bounded, tidak menghapus semua row lama sekaligus).
- **Lease recovery dan attempt_count:** setiap `expire_job_leases` menambah
  `attempt_count` +1 (sweep), dan `claim_job` berikutnya menambah +1 lagi —
  satu worker crash menghabiskan 2 attempt. Ini disengaja agar job yang
  worker-nya sering crash mencapai `max_attempts` lebih cepat dan tidak
  hot-loop selamanya; job `processing` dengan `attempt_count >= max_attempts`
  dan lease expired akan di-`failed` (`dead_job`) oleh `mark_dead_jobs`.
- Log Vercel tidak termasuk kebijakan ini (diatur oleh Vercel sendiri).
