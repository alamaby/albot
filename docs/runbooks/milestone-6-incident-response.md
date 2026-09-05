# Milestone 6 Incident Response Runbook

Runbook penanganan insiden operasional untuk development (dan production setelah
M7). Semua diagnosa memakai endpoint internal yang tidak menghabiskan kredit
provider dan tidak membocorkan secret.

## Prasyarat

- `JOB_PROCESSOR_SECRET` (environment production).
- Endpoint internal:
  - `POST /api/recovery/run` — sweep recovery (lease, dead job, session, purge).
  - `GET /api/admin/diagnostics` — snapshot read-only status operasional.
  - `GET /api/health?include=readiness` — health + readiness.

Contoh panggilan:

```bash
curl -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  https://albot-be.alamaby.com/api/admin/diagnostics
```

## 1. Provider key invalid (401/403)

**Gejala:** attempt/job `failed` dengan `last_error_code = provider_authentication_failed`
atau `provider_authorization_failed`; `provider_keys.failure_count` naik.

**Langkah:**

1. Cek diagnostics: `provider_keys` mana yang `is_active=true` dengan
   `failure_count > 0` / `cooldown_until` di masa depan.
2. Pastikan bukan salah config: cek `provider_configs` (base_url, model) untuk
   capability terkait.
3. Rotasi key via `scripts/seed-provider-config.mjs` (insert key baru → verifikasi
   decrypt → deaktivasi key lama). **Jangan pernah** menaruh plaintext key di
   chat/log/migration.
4. Tunggu cooldown key lama atau set `cooldown_until = null` hanya setelah key
   baru terverifikasi.
5. Job yang gagal: jika masih `retry_scheduled`, recovery akan claim kembali
   dengan key eligible. Jika `failed` (`dead_job`), sesi sudah ke
   `generation_failed`/`enhancement_failed` — user bisa retry.

## 2. Telegram webhook tidak menerima update / pending count membengkak

**Gejala:** bot tidak merespons; `getWebhookInfo` menunjukkan
`pending_update_count` tinggi atau `last_error_message`.

**Langkah:**

1. `node scripts/set-telegram-webhook.mjs get <TOKEN>` — periksa URL, secret,
   `allowed_updates`, `last_error`.
2. Pastikan URL webhook adalah `https://albot-be.alamaby.com/api/telegram/webhook` (prod only, bot dev dihapus), bukan URL deployment acak.
3. Jika URL salah: `set` ulang dengan secret yang sama (secret harus cocok
   dengan `TELEGRAM_WEBHOOK_SECRET` di Vercel).
4. Cek log Vercel: `webhook.malformed_json` / `webhook.invalid_update` /
   `webhook.handler_failed` (structured JSON, ada correlationId).
5. Jika update ter-trigger retry dari Telegram (duplikat): dedupe
   `telegram_updates.update_id` & `callback_events.callback_query_id` menjamin
   idempotensi; aman di-ack.
6. `pending_update_count` turun sendiri setelah webhook sehat; jika tetap tinggi
   > 24 jam, pertimbangkan `deleteWebhook` lalu `set` ulang.

## 2a. Bot diam setelah user kirim teks (job `queued` stuck, tanpa feedback ke user)

**Gejala:** user kirim prompt → bot tidak reply apapun (bukan "Prompt diterima"
maupun "Gagal memulai pemrosesan"). DB: `prompt_sessions` baru di status
`received`, `jobs.queued` > 0 dengan `attempt_count=0`, `locked_by=null`.
Terakhir sukses job sebelum stuck biasanya diikuti error `provider_unknown_error`
atau HTTP 500 dari provider upstream.

**Penyebab umum (2026-08-22):**

- `dispatchToProcessorUrl` swallow error (pre-fix). Patch `5b093fd` membuat
  dispatcher return `DispatchResult` dan `handlePrivateTextMessage`
  mengirim "Gagal memulai pemrosesan..." saat `ok:false` — user tidak lagi
  mengalami silent black-hole, bisa retry kirim pesan.

**Langkah:**

1. Cek diagnostics: `jobs.queued` + `jobs.processing`. Jika `queued > 0` dan
   `attempt_count=0`, dispatcher gagal menarik.
2. Cek `telegram_updates` user — pastikan `update_id` tercatat dan
   `telegram_message_id` cocok dengan pesan user (sanity: webhook memang
   menerima).
3. Trigger manual: `curl -X POST -H "Authorization: Bearer $JOB_PROCESSOR_SECRET"
-H "Content-Type: application/json" -d '{}'
https://albot-be.alamaby.com/api/jobs/process`. Processor claim 1 job per
   call; backlog habis dalam ±N invocation.
4. Jika dispatcher masih swallow (versi lama ter-deploy), deploy ulang commit
   terbaru dan tunggu sampai ada log `webhook.dispatcher_returned_error` di
   Vercel function logs — itu tanda dispatcher sudah propagate error ke user.

## 3. Job queued / retry_scheduled tidak pernah diproses

**Gejala:** diagnostics menunjukkan `jobs.queued` atau `jobs.retryScheduled`
tinggi dan tidak turun.

**Langkah:**

1. Cek `available_at`: job `retry_scheduled` dengan `available_at` di masa depan
   adalah normal (backoff + jitter). Diagnostics `leaseExpired` > 0 berarti ada
   worker crash.
2. Jalankan recovery manual: `POST /api/recovery/run` (atau tunggu cron 20 menit — `recovery-production.yml` prod-only, `recovery-development.yml` dihapus).
3. Jika job `failed` dengan `last_error_code = dead_job`:
   - `attempt_count >= max_attempts` → ekspektasi; sesi sudah terminal
     (`generation_failed`/`enhancement_failed`).
   - **Catatan attempt_count:** lease recovery menghabiskan 2 attempt (sweep +1,
     re-claim +1) — job yang worker-nya crash berulang mencapai `max_attempts`
     lebih cepat. Ini disengaja agar job tidak hot-loop selamanya.
   - Investigasi error asli dari `provider_requests`/`job_events` sesi terkait.
4. Jika masih `queued` dengan `available_at` lewat: cek apakah processor
   `POST /api/jobs/process` merespons (dispatcher inline gagal?). Job akan
   ter-claim oleh recovery/processor berikutnya — tidak hilang.

## 4. Sesi tidak pernah selesai / status menggantung

**Gejala:** session `processing`-like (mis. `enhancing`/`generating`) berhari-hari;
user tidak bisa mulai sesi baru (karena index one-active).

**Langkah:**

1. Diagnostics `expiringSessions` > 0 → sesi lewat `expires_at` belum di-sweep.
2. Jalankan recovery → `recover_stale_sessions` mark `expired`, user dapat mulai
   sesi baru. Notifikasi "Sesi telah berakhir..." hanya dikirim untuk sesi yang
   belum failed; sesi `enhancement_failed`/`generation_failed` di-expire
   diam-diam (sudah menerima tombol retry/prompt-baru saat gagal).
3. Jika sesi `generating` (bukan expired) dengan attempt `queued`/`processing`
   macet: cek job terkait; lease-expired sweep akan me-recover job.

## 5. Semua key dalam cooldown

**Gejala:** selector gagal `provider_key_unavailable`; semua key cooldown.

**Langkah:**

1. Cek diagnostics `cooldownKeys` dan query `provider_keys` (safe projection)
   untuk `cooldown_until`.
2. Tunggu cooldown berlalu (cooldown otomatis exponensial, max 60 menit) atau
   tambah key baru yang sehat.
3. Job yang gagal karena ini: `provider_key_unavailable` non-retryable per key —
   retry job memakai selector failover ke key/config lain bila ada.

## 6. Recovery cron gagal (workflow GitHub Actions)

**Gejala:** workflow `recovery-production` merah; job summary menampilkan
HTTP non-200 atau curl error.

**Langkah:**

1. Cek URL target: `https://albot-be.alamaby.com/api/recovery/run`; pastikan deployment terbaru sudah ter-deploy.
2. Pastikan `JOB_PROCESSOR_SECRET` di GitHub Environment `recovery-production` sama dengan yang di Vercel Production.
3. Cek Vercel function logs: `recovery.failed` berisi detail.
4. Run manual: `workflow_dispatch` dengan URL yang sama.

## Logging tanpa membocorkan secret

- Semua log adalah single-line JSON dari `logStructured` dengan field:
  `ts, level, event, correlationId, ...`.
- Redaction otomatis (`src/server/observability/redact.ts`) menghapus
  bearer/API key/token/JWT dari setiap nilai string.
- Jangan pernah menaruh: bot token, service role key, encryption key, plaintext
  provider key, header Authorization, raw payload.
- Correlation ID: ikuti `X-Correlation-Id` pada request (webhook/dispatcher
  meneruskan header; job_events merekam `correlationId`).
