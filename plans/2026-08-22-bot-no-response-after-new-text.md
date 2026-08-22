# Validasi: Bot Tidak Respon Setelah Kirim Teks Baru

Created: 2026-08-22

## Objective
Diagnosa dan pulihkan bot yang tidak merespon teks baru user 83540732 sejak 2026-08-21 10:17 UTC, serta harden dispatcher agar tidak swallow error diam-diam (cron opsi 1: dihapus, andalkan feedback + retry manual).

## Temuan Validasi (via mcp supabase-albot-be-development)

- **Sesi terakhir user 83540732:** `2102ce5a` (created 2026-08-21 10:17:37 UTC) stuck di `received`, revision `b9c0620f` (`pending`), job `033b6f11` (`enhance_prompt`, `queued`, `attempt_count=0`, `locked_by=null`, `lease_expires_at=null`).
- **Job counts DB:** 1 queued, 0 processing, 0 retry_scheduled, 10 failed, 42 succeeded, 8 cancelled. Last job update = `2026-08-21 10:17:40 UTC` (~2.5 jam lalu).
- **User allowlist:** `is_allowed=true`, `is_admin=true`, tidak terkunci rate-limit.
- **Pattern:** job terakhir `b041b17c` gagal di Pixazo PixelForge (HTTP 500 → `provider_unknown_error`). Sejak itu dispatcher webhook tidak berhasil claim job baru apapun.
- **Bug dispatcher:** `dispatchToProcessorUrl` di `src/server/application/handle-telegram-update.ts:97-123` catch error dan log saja, tidak throw. Caller `handlePrivateTextMessage` punya try/catch yang mengirim "Gagal memulai pemrosesan", tapi karena dispatcher swallow, catch tidak pernah jalan. User tidak terima respon apapun (silent failure).
- **Missing scheduler:** tidak ada cron/scheduled workflow yang men-trigger `/api/jobs/process`. Job baru hanya diproses via dispatcher webhook. Kalau dispatcher gagal sekali, job stuck permanen sampai user kirim pesan baru.
- **Commit terbaru:** `4562fab fix(telegram): dispatch processor synchronously before sending queued message` mengubah urutan tapi tidak menambah error feedback ke user.
- **Edge log query backend error** (Supabase log service unavailable) — tidak bisa konfirmasi dispatcher error via logs.
- **Plan Pollinations** (`plans/2026-08-22-pollinations-provider-*.md`) dibuat tapi **belum diimplementasi** (0 file `pollinations*` di `src/`). Implementasi Pollinations TIDAK memperbaiki masalah ini.

## Scope

### Immediate (recovery + observability)
1. Trigger manual dispatch untuk job stuck `033b6f11` agar prompt user diproses.
2. Perbaiki `dispatchToProcessorUrl` agar return `{ ok: boolean }` (tidak swallow), dan `handlePrivateTextMessage` step 7 kirim "Gagal memulai pemrosesan" saat dispatcher gagal.

### Short-term (opsi 1 — cron dihapus)
3. Cron `process-jobs-development.yml` awalnya ditambah, lalu dihapus per keputusan user opsi 1 (bot sudah berfungsi tanpa cron; andalkan feedback dispatcher).
4. Update TODO + docs runbook.
5. Verifikasi: lint, typecheck, unit, build, format:check.

### Separate (Pollinations — DEFERRED)
6. Implementasi Pollinations di file terpisah (sudah ada plan). Deferred sampai dispatcher stabil.

## Milestones

1. **Recovery job stuck** — manual dispatch job `033b6f11`.
2. **Dispatcher observability** — fix swallow error, tambah notifikasi user.
3. **Opsional cron** — awalnya ditambah, dihapus opsi 1.
4. **Verifikasi end-to-end** — bot respon untuk prompt baru.

## Tasks

- [x] Persist plan file `plans/2026-08-22-bot-no-response-after-new-text.md`.
- [x] Edit `src/server/application/handle-telegram-update.ts`:
  - `dispatchToProcessorUrl` return `Promise<{ ok: boolean; status?: number; error?: string }>` alih-alih swallow.
  - `handlePrivateTextMessage` step 7 cek return value; jika `ok=false`, kirim "Gagal memulai pemrosesan. Silakan coba lagi sebentar." ke user.
- [x] Buat lalu hapus `.github/workflows/process-jobs-development.yml` per opsi 1 (cron `*/1` → dihapus).
- [x] Update `TODO.md` checklist + `docs/runbooks/milestone-6-incident-response.md` (catatan dispatcher swallow).
- [x] Verifikasi: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm run format:check` hijau.
- [x] Trigger manual `POST https://albot-dev.vercel.app/api/jobs/process` untuk job stuck `033b6f11` → `succeeded` `awaiting_confirmation`.
- [x] Update memory entry + `.memory/README.md`.

## Risks

- **Vercel function cold-start**: dispatcher 5s timeout mungkin terlalu pendek. Solusi: naikkan ke 15s untuk kelonggaran cold-start.
- **Cron spam**: tiap 1 menit cron trigger boros quota Vercel. Solusi: pakai `*/1` dulu (maks 1 job per invocation sudah idempotent), monitor invocation count.
- **Secret mismatch**: jika `JOB_PROCESSOR_SECRET` Vercel berubah, dispatcher 401 diam-diam. Solusi: tambah log explicit untuk status code dan decision di dispatcher.
- **Test impact**: type return `dispatchToProcessorUrl` berubah dari `Promise<void>` ke `Promise<{ok,...}>`. Mock di tests perlu di-update. Cek `tests/unit/handle-telegram-update.test.ts` atau setara.

## Progress Log

- 2026-08-22 — Validasi via mcp supabase-albot-be-development. Job stuck sejak 10:17 UTC. Dispatcher swallow error. Plan dibuat.
- 2026-08-22 — Plan disetujui user: fix dispatcher + tambah cron, tunda Pollinations. Build mode aktif, mulai eksekusi.
- 2026-08-22 — Fix `DispatchResult` + tests + cron selesai, push `5b093fd`, alias `albot-dev.vercel.app` updated, job `033b6f11` di-recover (`succeeded`).
- 2026-08-22 — User pilih opsi 1: hapus cron `process-jobs-development.yml`, andalkan feedback dispatcher + retry manual.

## Notes

- Job stuck: `033b6f11-4696-4537-8a48-1139103577ef` (session `2102ce5a-8413-41ff-ac2d-2413a3a485c6`, revision `b9c0620f-40fd-4ecd-a848-985622255c0e`).
- `last_seen_at` di `bot_users` null untuk user ini — bisa di-refresh di handler (low priority, tidak terkait fix).
- Plan Pollinations terpisah: di-defer, akan diimplementasi setelah dispatcher stabil.
- Tipe return `dispatchToProcessorUrl` perlu disinkronkan dengan `TelegramWebhookDeps.dispatchToProcessor` (juga return `Promise<unknown>`). Sesuaikan kontrak agar konsisten.