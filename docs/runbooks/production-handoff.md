# Production Handoff Runbook (Milestone 7)

Runbook operasional production `albot-be.alamaby.com` (Supabase prod
`pcexxtckvwmiquseznaz`, bot `@albot_ai_bot`). Development runbook terpisah:
`docs/runbooks/milestone-3-bootstrap.md`, `docs/runbooks/milestone-4-e2e.md`,
`docs/runbooks/milestone-6-incident-response.md`.

## Topologi Production

| Komponen           | Nilai                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Vercel production  | `https://albot-be.alamaby.com` (alias lama `albot-ten.vercel.app` tetap jalan)                |
| Supabase prod      | `pcexxtckvwmiquseznaz` (25 migrations, RLS FORCE, service_role only)                          |
| Bot Telegram       | `@albot_ai_bot` (token di Vercel Production env)                                              |
| Webhook            | `https://albot-be.alamaby.com/api/telegram/webhook` (secret = `TELEGRAM_WEBHOOK_SECRET` prod) |
| Allowlist awal     | `83540732` (admin)                                                                            |
| Provider reasoning | Cloudflare gpt-oss-120b (prio 0) → Pollinations gpt-oss (prio 150)                            |
| Provider image     | Pixazo Flux (prio 0) → Pixazo SDXL (prio 5) → Pollinations flux (prio 151)                    |

Endpoint internal (Bearer `JOB_PROCESSOR_SECRET` prod):

```bash
curl -s https://albot-be.alamaby.com/api/health | jq
curl -s "https://albot-be.alamaby.com/api/health?include=readiness" | jq
curl -s -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  https://albot-be.alamaby.com/api/admin/diagnostics | jq
curl -s -X POST -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  https://albot-be.alamaby.com/api/recovery/run | jq
```

## 1. Menambah reasoning provider OpenAI-compatible

1. Siapkan API key provider (plaintext, jangan pernah di-log/chat/commit).
2. Jalankan seed dengan env prod (lihat `.env.prod.check` pattern di
   `scripts/verify-env-format.mjs`):
   ```bash
   node --env-file=.env.prod.check scripts/seed-provider-config.mjs add \
     openai_compatible "<Nama>" "<base_url>/v1" "<model>" priority_failover \
     <priority> <weight> --key "<API_KEY>" --capability reasoning
   ```
3. Verifikasi: `provider_configs` row baru `is_active=true`; kirim prompt uji
   dari Telegram; cek `provider_requests` (capability `reasoning`, status
   `succeeded`).
4. Priority lebih kecil = dicoba lebih dulu (`priority_failover`).

## 2. Menambah image provider dengan adapter baru

1. Tulis adapter di `src/server/providers/image/<nama>.adapter.ts`
   (implementasi kontrak image; vendor logic HANYA di adapter).
2. Daftarkan factory di `src/server/providers/index.ts`
   (`registry.registerImage("<adapter_type>", ...)`).
3. Tambah contract test di `tests/contract/`.
4. Tambah unit test, jalankan `npm run test:unit && npm run lint &&
npm run typecheck && npm run build`.
5. Commit → push `main` → deploy Vercel → seed config+key (langkah seperti #1
   dengan `--capability image_generation`).

## 3. Menambah / merotasi / menonaktifkan / menghapus provider key

- **Tambah/rotasi:** insert key baru via seed script (`add` membuat config+key;
  untuk rotasi gunakan label berbeda), verifikasi dengan prompt uji, lalu
  `update provider_keys set is_active=false where id=<lama>;` (jangan delete
  saat masih direferensikan `provider_requests.provider_key_id`).
- **Nonaktifkan:** `update provider_keys set is_active=false ...` — selector
  langsung melewatkannya.
- **Hapus:** hanya key lama yang tidak lagi dipakai audit; FK `RESTRICT` akan
  menolak jika masih direferensikan. Rotasi = tambah baru + nonaktif lama,
  bukan delete.
- Plaintext key tidak pernah di-return API/log; hanya ciphertext+iv+tag+
  fingerprint di DB. Dekripsi sesaat sebelum outbound request saja.

## 4. Mengubah provider priority/weight

```sql
update provider_configs set priority = <baru> where id = '<id>';
update provider_configs set weight = <baru> where id = '<id>';  -- weight utk weighted selection
```

Tidak perlu deploy; selector membaca DB per request. Priority kecil = prioritas
tinggi. Verifikasi lewat prompt uji + `provider_requests.provider_config_id`.

## 5. Menangani seluruh key dalam cooldown

**Gejala:** readiness/diagnostics `cooldownKeys > 0`, job gagal
`provider_key_unavailable`, atau semua attempt `failed`.

1. Cek penyebab: `provider_keys.failure_count`, `cooldown_until`, dan
   `provider_requests.error_code` terakhir (401/403 = key invalid; 429 = quota).
2. 401/403 → rotasi key (bagian #3).
3. 429/quota → tunggu cooldown lewat (eksponensial), atau kurangi beban.
4. Darurat: `update provider_keys set cooldown_until = null, failure_count = 0
where id = '<id>';` HANYA setelah yakin key valid — salah key akan
   cooldown lagi otomatis.
5. Job `retry_scheduled` akan di-claim recovery; job `failed` perlu user retry
   (Regenerate / kirim prompt baru).

## 6. Menambah dan mencabut user allowlist

```sql
-- tambah (ganti <TELEGRAM_USER_ID> numeric id user)
insert into bot_users (telegram_user_id, is_allowed, is_admin)
values (<TELEGRAM_USER_ID>, true, false)
on conflict (telegram_user_id) do update set is_allowed = true, updated_at = now();

-- cabut akses
update bot_users set is_allowed = false where telegram_user_id = <TELEGRAM_USER_ID>;
```

User yang dicabut tetap bisa menyelesaikan flow pada sesi aktifnya sampai
expired (24 jam dari prompt pertama) — tidak ada pembatalan paksa sesi.

## 7. Mengganti Telegram bot token dan webhook secret

1. BotFather → `/revoke` (token lama mati) → `/token` (token baru), atau buat
   secret baru: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. Update **dua tempat**: Vercel Production env (`TELEGRAM_BOT_TOKEN` dan/atau
   `TELEGRAM_WEBHOOK_SECRET`) + catatan lokal aman.
3. Redeploy Production (env baru tidak berlaku tanpa redeploy).
4. Set ulang webhook dengan secret baru (bagian #8).
5. Update `JOB_PROCESSOR_SECRET` juga bila kebocoran menyentuhnya (dipakai
   processor/recovery/diagnostics).

## 8. Menyetel ulang Telegram webhook

```bash
node scripts/set-telegram-webhook.mjs get "<BOT_TOKEN>"
APP_ENV=production node scripts/set-telegram-webhook.mjs set "<BOT_TOKEN>" \
  https://albot-be.alamaby.com/api/telegram/webhook "<PROD_WEBHOOK_SECRET>" --allow-prod
node scripts/set-telegram-webhook.mjs get "<BOT_TOKEN>"
```

Verifikasi: `url` benar, `pending_update_count` turun ke 0, `allowed_updates`
`[message, callback_query]`, `last_error_message` null. `--allow-prod` wajib
untuk produksi (pengaman salah target).

## 9. Menangani queued/dead job

**Diagnosa:** readiness `jobs.queued/processing/failed` + diagnostics.

- `queued` menumpuk: dispatch gagal massal atau processor down. Cek Vercel
  status; trigger manual `POST /api/recovery/run` (sweep meng-claim job due).
- `leaseExpired > 0`: worker crash — sweep `expire_job_leases` mengembalikan ke
  `queued` (attempt +1). Normal sesekali.
- `failed` (`dead_job`, max attempts): sesi user sudah di
  `enhancement_failed`/`generation_failed`; user retry via UI. Job dead tidak
  perlu aksi kecuali investigasi akar masalah (`last_error_code`).

## 10. Menangani provider outage

1. Identifikasi provider bermasalah dari `provider_requests` (status/http).
2. Nonaktifkan config-nya: `update provider_configs set is_active=false where
id='<id>';` — failover otomatis pindah ke provider berikutnya.
3. Setelah pulih, aktifkan kembali. Pollinations fallback (prio 150/151)
   seharusnya menutup outage Pixazo/Cloudflare otomatis tanpa aksi.

## 11. Menangani Telegram delivery failure

**Gejala:** attempt `succeeded` tapi user tidak menerima foto, atau
`last_error_message` di `getWebhookInfo`.

1. Cek `getWebhookInfo` (bagian #8) — error URL/secret perbaiki webhook.
2. Foto URL provider expired → user tekan `Regenerate` (biaya generation baru;
   risiko diterima V1, tidak ada Storage).
3. `sendPhoto` gagal → attempt `failed` + session `generation_failed`; user
   retry dari keyboard.

## 12. Menjalankan migration development dan production

1. Commit migration baru (`supabase/migrations/<timestamp>_*.sql`, additive).
2. Update `EXPECTED_MIGRATIONS` di `tests/integration/schema.integration.test.ts`.
3. Local green: `npm run db:lint && db:check-migrations && db:types:check &&
test:unit && lint && typecheck && build && format:check`.
4. Push `main` → Actions `migrate-development` (`commit_sha=<HEAD>`) → success.
5. Actions `migrate-production` (`confirm_project_ref=pcexxtckvwmiquseznaz`,
   `development_run_id=<run dev untuk SHA yang sama>`) → approve → success.
6. Redeploy Vercel Production bila migration menyertakan perubahan kode.
   Destructive statement dilarang; rollback selalu forward-fix.

## 13. Memulihkan application deployment tanpa destructive DB rollback

- Rollback aplikasi = redeploy commit lama di Vercel (Deployments → Redeploy).
  Schema TIDAK ikut ter-rollback — kode lama harus kompatibel schema baru
  (karena semua migration additive, ini berlaku).
- Jika kode baru butuh kolom baru dan schema belum di-migrate: jangan deploy;
  migrate dulu (urutan di #12).
- Bencana data: restore dari Supabase backup (dashboard → Database → Backups)
  oleh pemilik project; dokumentasikan timeline insiden.

## 14. Memeriksa log tanpa membuka secret

- Vercel Logs: structured JSON (`logStructured`) dengan redaction otomatis
  (`src/server/observability/redact.ts`). Field: correlationId, sessionId,
  jobId, status, latency — tanpa token/key/prompt mentah.
- DB audit: `provider_requests.error_message_redacted`,
  `job_events.payload` (tanpa secret — dijamin test redaction).
- Dilarang menempel secret ke chat/ticket; verifikasi kebocoran env via
  `scripts/verify-env-format.mjs` (nilai tidak di-print).
- Prompt user tersimpan di `prompt_revisions` (fungsional, retention 30 hari —
  `docs/retention.md`); jangan diekspor tanpa kebutuhan.

## 15. Monitoring & retentions

- Health harian: `/api/health?include=readiness` (queued/failed/dead/cooldown).
- **Recovery cron production**: GitHub Actions `recovery-production.yml` tiap 20 menit → `POST /api/recovery/run` (environment `recovery-production`, secret `JOB_PROCESSOR_SECRET` prod). Menutup lease expired, claim queued (batch 3), dead job, session expiry, retention purge. Manual dispatch tersedia di tab workflow. Jika schedule di-disable GitHub (repo idle 60 hari), aktifkan ulang di tab Actions.
- Retention metadata 30 hari via `purge_expired_metadata` (sweep recovery).
- Session expiry 24 jam otomatis + notifikasi user.
- `npm audit --omit=dev --audit-level=high` berjalan di CI `validate.yml`.

## Kontak & Eskalasi

- Owner: `@alamaby` (approver GitHub Environment `production`).
- Platform: Vercel (Hobby), Supabase (free tier) — waspadai pause/quota;
  health `degraded` + Supabase dashboard untuk status project.
