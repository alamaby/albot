# Milestone 4 E2E Runbook (Development)

Menjalankan enhancement → confirmation → revision loop secara end-to-end di environment development (Vercel Preview + Supabase dev + bot Telegram dev).

## Prerequisites

- Milestone 3 sudah closed: webhook terpasang, admin allowlisted (`83540732`/`alamaby`), Vercel Preview env vars lengkap (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`, `SUPABASE_URL` dev, `SUPABASE_SECRET_KEY` dev, `PROVIDER_KEY_ENCRYPTION_KEY` dev).
- Migration M4 sudah diapply ke dev (`migrate-development.yml`, 11/11).
- `.env` lokal berisi kredensial Supabase dev (`SUPABASE_URL_DEV`, `SUPABASE_SECRET_KEY_DEV`), `PROVIDER_KEY_ENCRYPTION_KEY` **identik dengan nilai di Vercel Preview** (script seed mengenkripsi key provider memakai key ini; runtime di Vercel mendekripsi memakai key yang sama — beda nilai = gagal decrypt saat E2E), dan key provider reasoning.

## 1. Seed Provider Reasoning (dev)

Provider dipilih dari DB `provider_configs` (bukan env). Script membaca `.env` lokal otomatis (fallback `_DEV` vars + `PROVIDER_KEY_ENCRYPTION_KEY`), jadi cukup jalankan dari repo root:

```bash
# OpenRouter (recommended: gratis, OpenAI-compatible)
node scripts/seed-provider-config.mjs add \
  openai_compatible "OpenRouter Nemotron Free" "https://openrouter.ai/api/v1" "nvidia/nemotron-3.5-lightning:free" \
  priority_failover 0 1 \
  --env-key OPENROUTER_API_KEY --label "openrouter-nemotron"

# OpenRouter Laguna XS (failover kedua, priority 1)
node scripts/seed-provider-config.mjs add \
  openai_compatible "OpenRouter Laguna Free" "https://openrouter.ai/api/v1" "poolside/laguna-xs-2.1:free" \
  priority_failover 1 1 \
  --env-key OPENROUTER_API_KEY --label "openrouter-laguna"
```

`.env` lokal yang dibutuhkan:

```dotenv
# Supabase dev (sudah ada)
SUPABASE_URL_DEV=https://ceqcitzbosqzxpbtlpfn.supabase.co
SUPABASE_SECRET_KEY_DEV=<dev-sb_secret-key>
# WAJIB SAMA dengan nilai di Vercel Preview
PROVIDER_KEY_ENCRYPTION_KEY=<base64-32-bytes>
# API key provider (bebas; di-baca script via --env-key)
OPENROUTER_API_KEY=<openrouter-key>
```

Catatan:

- Secret (`SUPABASE_SECRET_KEY`, `PROVIDER_KEY_ENCRYPTION_KEY`, key plaintext) tidak boleh ditulis ke chat/commit. Cukup simpan di `.env` lokal (gitignored).
- Untuk failover test: `add` config kedua dengan `priority 1` + key kedua; key yang invalid menghasilkan 401 → `markFailure` → cooldown → selector fallback ke key berikutnya.
- `--env-key NAMA_VAR` membaca key dari environment (termasuk `.env` lokal); alternatif `--key <key>` untuk satu kali atau `PROVIDER_KEY` env.

## 2. Sanitize Sesi Aktif Dev

Partial unique index `prompt_sessions_one_active_idx` menolak dua sesi non-terminal per user. Sebelum migration M4, bersihkan sesi aktif lama dari E2E M3:

```sql
-- di Supabase dev (SQL editor atau psql)
update public.prompt_sessions
   set status = 'cancelled', completed_at = now()
 where status not in ('completed','cancelled','expired')
   and telegram_user_id = 83540732;
```

## 3. E2E Happy Path

1. Kirim prompt via bot dev, mis. "desain poster kafe cozy di malam hari".
2. Verifikasi balasan "Prompt diterima. Sedang dalam antrian...".
3. Setelah enhancement selesai, verifikasi muncul pesan konfirmasi berisi enhanced prompt + tombol `Generate` / `Revise Lagi` / `Batal`.
4. Tekan `Revise Lagi` → bot meminta instruksi revisi.
5. Kirim instruksi, mis. "buat lebih terang dan tambah awan".
6. Verifikasi muncul "Sedang memproses revisi..." lalu konfirmasi revisi 2.
7. Tekan `Generate` → verifikasi session `generating` + job `generate_image` `queued` (M5 belum punya handler; job menunggu).
8. Sesi kedua dimulai dengan prompt baru setelah `Batal` → session `cancelled`.

## 4. Verifikasi DB (sanitized)

Query dev (SQL editor):

```sql
select s.id, s.status, s.active_revision_id,
       r.revision_number, r.source_prompt, r.enhanced_prompt,
       r.previous_prompt, r.reasoning_provider_config_id, r.status as rev_status,
       j.job_type, j.status as job_status, j.attempt_count
  from prompt_sessions s
  join prompt_revisions r on r.session_id = s.id
  join jobs j on j.prompt_session_id = s.id
 where s.telegram_user_id = 83540732
 order by s.created_at desc, r.revision_number;
```

Checklist:

- Session pertama: `awaiting_confirmation` (sebelum Generate), revisi 1 `completed` + `enhanced_prompt` terisi, job `enhance_prompt` `succeeded`, `provider_requests` punya baris `succeeded` + `provider_request_id`.
- Revisi 2: `revision_number=2`, `previous_prompt` = enhanced prompt revisi 1, revisi 1 **tidak berubah**.
- Setelah Generate: session `generating`, job `generate_image` `queued`.
- Setelah Batal: session `cancelled`.

## 5. Failure & Concurrency Checks

- **Double-click `Revise Lagi`**: satu `callback_events` (dedupe `callback_query_id`); hanya satu revisi dibuat.
- **Callback replay**: kirim ulang payload callback yang sama → `callback_events.insertIfAbsent` null → ack only, tanpa transisi ganda.
- **Owner mismatch**: callback dari user lain dengan `sessionId` valid → ditolak, tidak ada transisi, log.
- **Session expired**: set `expires_at` masa lalu pada session aktif → callback berikutnya → session `expired`, tidak ada transisi.
- **Reasoning 401 failover**: config kedua dengan key invalid → `provider_keys.failure_count` naik, `cooldown_until` terisi; retry berikutnya memakai key lain (selector skip cooldown). Semua gagal → session `enhancement_failed` + pesan "Gagal memproses prompt. Silakan coba lagi nanti."
- **Prompt > 4000 saat revision input**: balasan "Instruksi revisi terlalu panjang...", tidak ada revisi baru.

## 6. Evidence Recording

Rekam untuk closure M4:

- CI validate run URL + `migrate-development.yml` run URL (10/10, hosted tests).
- Screenshot Telegram: konfirmasi enhancement, alur revisi, batal.
- Output query DB di atas (sanitized: tanpa secret, tanpa token).
- Hasil failover test (failure_count/cooldown + retry).

## Troubleshooting

- **Confirmation tidak muncul** → cek log Vercel function `/api/jobs/process`; job mungkin `retry_scheduled` (timeout/429) atau `failed` (401/invalid output). Query `jobs.last_error_code`.
- **"Sesi aktif" saat kirim prompt baru** → selesaikan sesi lama (Batal) atau cleanup manual di atas.
- **provider_configs kosong** → jalankan ulang seed script; verifikasi `is_active=true`.
- **Webhook 401** → pastikan Deployment Protection Preview dimatikan dan secret cocok (M3 runbook).
