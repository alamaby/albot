# albot

Telegram image bot. Spesifikasi lengkap ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`. Tracking progress ada di `TODO.md`.

Status: **Post-M7 iterasi** (M0–M7 closed; tracking fitur lanjutan di `TODO.md`).

- Production: `https://albot-be.alamaby.com` (bot `@albot_ai_bot` — production only, Supabase prod `pcexxtckvwmiquseznaz`; jumlah migration live lihat `supabase migration list` — file migration repo di `supabase/migrations/`)
- Staging (migration-only): Supabase dev `ceqcitzbosqzxpbtlpfn` (bot dev dihapus `plans/2026-09-02-bot-dev-removal-and-auto-prod-plan.md`; tidak ada alias `albot-dev.vercel.app`)
- Runbook produksi: `docs/runbooks/production-handoff.md`

## Stack

- Next.js App Router (server actions dan route handlers, Node.js runtime)
- TypeScript strict
- Supabase (Postgres) sebagai durable job store
- Vercel sebagai deployment platform

## Development

```bash
npm ci
cp .env.example .env.local  # isi SUPABASE_URL dan SUPABASE_SECRET_KEY
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Production Deployment (auto, schema before code)

```bash
# 1. Lokal green (wajib sebelum push, lihat AGENTS.md)
npm run db:lint && npm run db:check-migrations && npm run db:types:check \
 && npm run test:unit && npm run lint && npm run typecheck && npm run build && npm run format:check

# 2. Push main → trigger otomatis:
#    validate.yml → migrate-development (staging, parallel) → migrate-production (prod pcexxtckvwmiquseznaz, auto) → deploy-production (vercel --prod, needs migrate-production)
git push origin main
# tunggu Actions → migrate-production → deploy-production → success

# 3. Seed provider keys ke prod (bila ada provider baru)
node scripts/seed-prod-bynara.mjs  # baca .env (BYNARA_*_API_KEY) → upsert 6 rows prod (hanya fingerprint di log)

# 4. Verifikasi
curl -s https://albot-be.alamaby.com/api/health | jq
curl -s "https://albot-be.alamaby.com/api/health?include=readiness" -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" | jq
# test bot @albot_ai_bot
```

> Bot development dihapus (plan `plans/2026-09-02-bot-dev-removal-and-auto-prod-plan.md`): alias `albot-dev.vercel.app`, workflow `recovery-development` & `deploy-development` dihapus; `migrate-development` tetap sebagai staging warning; Vercel Preview env dihapus; Vercel Git Integration dimatikan — deploy prod hanya via `deploy-production.yml`.

## CI/CD Otomatis (push main)

Setiap push ke `main` memicu pipeline otomatis (Opsi C + T7a):

1. **`validate`** — lint/typecheck/test/build + `db:lint`/`db:check-migrations` + secret scan
2. **`migrate-development`** (`.github/workflows/migrate-development.yml`) — apply migration ke Supabase dev `ceqcitzbosqzxpbtlpfn` + hosted tests (staging, parallel, tidak gate prod)
3. **`migrate-production`** (`.github/workflows/migrate-production.yml`) — apply migration ke Supabase prod `pcexxtckvwmiquseznaz` (auto on push, standalone `EXPECTED_REF` check)
4. **`deploy-production`** (`.github/workflows/deploy-production.yml`) — `vercel build` + `vercel deploy --prod` ke `albot-be.alamaby.com`, `needs` via `workflow_run` setelah `migrate-production` success (T7a, `schema before code` terjamin)

**Secrets GitHub yang dibutuhkan** (Environment `production`):

- `VERCEL_TOKEN` — personal token Vercel (Vercel → Settings → Tokens).
- `SUPABASE_*` prod — `SUPABASE_PROJECT_REF=pcexxtckvwmiquseznaz`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`/`SECRET_KEY` prod

Bot development dihapus — tidak ada lagi Preview alias. Vercel Git Integration dimatikan (deploy hanya via `deploy-production.yml`).

## Routes

- `GET /api/health` — health check dengan DB reachability yang sanitized. Tambahkan `?include=readiness` untuk snapshot operasional (job counts, dead jobs, session expiry, key cooldown) tanpa biaya provider.
- `POST /api/jobs/process` — internal job processor (Bearer `JOB_PROCESSOR_SECRET`).
- `POST /api/recovery/run` — internal recovery sweep: lease-expiry recovery, queued claim (batch 3), dead-job marking, session expiry, retention purge. Cron GitHub Actions tiap 20 menit: `recovery-production.yml` (prod `albot-be.alamaby.com`; dev recovery dihapus bersama bot dev).
- `GET /api/admin/diagnostics` — internal read-only status operasional (Bearer `JOB_PROCESSOR_SECRET`).
- `GET /api/admin/prompts` — audit prompt per user/session (`?user_id=&session_id=&since=&until=`).
- `GET /api/admin/prompt-configs` / `POST /api/admin/prompt-configs` — prompt persona DB-driven: `GET ?key=&audit=1&limit=` list versi/audit; `POST {key,body,actor}` upsert; `POST {key,version,actor}` rollback (Bearer `JOB_PROCESSOR_SECRET`).

## Provider Keys & Key Selection Strategy

Setiap `provider_configs` row bisa punya **lebih dari satu** `provider_keys` row.
Kolom `provider_configs.key_selection_strategy` mengatur cara selector memilih
key antar multiple keys untuk config tersebut:

| `key_selection_strategy` | Perilaku key selection                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NULL` (default)         | Inherit: config `weighted` → weighted key draw by `weight`; lainnya → first eligible by `last_used_at`. Backward compat untuk semua config existing.                             |
| `'priority'`             | Fallback: keys diurutkan by `priority ASC, last_used_at ASC`. Primary key dipakai duluan; setelah 3 failure (threshold dipertahankan) key cooldown → retry pakai key berikutnya. |
| `'round_robin'`          | Rotasi LRU: keys diurutkan by `last_used_at ASC`. Setiap `markSuccess` update `last_used_at`, jadi request berikutnya otomatis pilih key lain.                                   |

Kolom `provider_keys.priority` (integer, default 100, lower = higher precedence)
hanya relevan untuk strategi `'priority'`. Untuk `'round_robin'` dan `NULL`
diabaikan (tie-break by `last_used_at`).

### Menambah key kedua untuk provider existing (multi-key)

Script `add-provider-key.mjs` insert key **tanpa** hapus key existing
(kontras `upsert-provider-key.mjs` yang replace-all):

```bash
# Pixazo Flux: primary (priority 1) + backup (priority 200), strategy 'priority'
psql ... -c "UPDATE provider_configs SET key_selection_strategy = 'priority'
             WHERE adapter_type = 'pixazo_flux_schnell' AND capability = 'image_generation';"

node scripts/add-provider-key.mjs pixazo_flux_schnell flux-1-schnell \
  --capability image_generation --priority 200 \
  --env-key PIXAZO_BACKUP_API_KEY --label "backup"
```

```bash
# OpenRouter free: 2 key round-robin per request
psql ... -c "UPDATE provider_configs SET key_selection_strategy = 'round_robin'
             WHERE adapter_type LIKE 'openrouter_%' AND capability = 'reasoning';"

node scripts/add-provider-key.mjs openrouter_free openrouter/free \
  --capability reasoning --priority 100 \
  --env-key OPENROUTER_BACKUP_API_KEY --label "secondary"
```

### Seed config baru dengan key strategy + priority

```bash
node scripts/seed-provider-config.mjs add <adapter_type> <name> <base_url> <model> \
  <selection_strategy> <priority> <weight> \
  --key <plaintext_key> --capability <reasoning|image_generation> \
  --key-strategy <priority|round_robin> --key-priority <n>
```

CPU script tidak mencetak plaintext key (hanya fingerprint prefix). Lihat
`scripts/add-provider-key.mjs`, `scripts/upsert-provider-key.mjs`, dan
`scripts/seed-provider-config.mjs` untuk arg lengkap.

## Prompt Configs (DB-driven)

System prompt enhancement di-split: persona (editable via DB) + shape JSON immutable di code (`ENHANCEMENT_SYSTEM_PROMPT_SHAPE`). Update persona **tidak perlu deploy**, cukup update tabel `prompt_configs`.

- **Tabel:** `prompt_configs(key, body, version, is_active, created_by, ...)` — satu `is_active` per `key` (`prompt_configs_one_active_idx`). `prompt_configs_audit` menyimpan `create/activate/deactivate/rollback` dengan `actor`.
- **Key saat ini (6):** `enhancement_system_persona` (seed `20260902120000`) + `reasoning_revision_helper`, `reasoning_sampling`, `bot_messages`, `bot_keyboards`, `bot_templates` (seed `20260904120000`). `get_active_prompt_config(p_key)` dengan cache TTL 60s per instance (single-flight).
- **Strict-error:** `enhancement_system_persona` + `reasoning_*` gagal loud `provider_configuration_invalid` / `provider_unknown_error` — tidak fallback. `bot_*` fallback ke hardcoded `DEFAULT_*` dengan `warn` log agar bot tidak bisu saat DB down.
- **Negative prompt:** tidak ada default global (per user choice). LLM field `negative_prompt` di-plumb `revision.negativePrompt` → setiap image adapter. Pixazo native `negative_prompt`; Aichixia difusi native, `gemini-3-pro-image` omit; Pollinations/Bynara inject `"Avoid: {negative}"`; kosong = omit semua adapter.

### Update via Admin API (tanpa deploy)

Auth: `Bearer $JOB_PROCESSOR_SECRET` (sama seperti `/api/admin/*`).

```bash
# lihat versi aktif + history (prod host)
curl -s -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  "https://albot-be.alamaby.com/api/admin/prompt-configs?key=enhancement_system_persona" | jq
curl -s -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  "https://albot-be.alamaby.com/api/admin/prompt-configs?key=enhancement_system_persona&audit=true&limit=20" | jq

# buat versi baru (auto-activate, body 1..8000 char)
curl -s -X POST -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" -H "Content-Type: application/json" \
  -d '{"key":"enhancement_system_persona","body":"You are a professional prompt engineer...\nRewrite the user'\''s prompt into a detailed, high-quality image generation prompt. (edit di sini)","actor":"admin@example.com"}' \
  https://albot-be.alamaby.com/api/admin/prompt-configs | jq

# rollback ke versi lama
curl -s -X POST -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" -H "Content-Type: application/json" \
  -d '{"key":"enhancement_system_persona","version":1,"actor":"admin@example.com"}' \
  https://albot-be.alamaby.com/api/admin/prompt-configs | jq
```

Efek live ≤60s (cache).

### Update via SQL langsung (alternatif)

```sql
-- buat versi baru (via RPC, audit otomatis)
select upsert_prompt_config('enhancement_system_persona', 'persona baru ...', 'admin@example.com');
-- rollback
select activate_prompt_config('enhancement_system_persona', 1, 'admin@example.com');
-- cek aktif
select get_active_prompt_config('enhancement_system_persona');
```

### Menambah key prompt baru

Cukup `upsert_prompt_config('nama_key_baru', 'body...')` — code yang memakai `PromptConfigRepository.getActivePersona('nama_key_baru')` akan otomatis strict-load key tersebut.

## Telegram Webhook (production only — bot dev dihapus)

Production (`@albot_ai_bot` → `https://albot-be.alamaby.com`):

```bash
APP_ENV=production node scripts/set-telegram-webhook.mjs set "$TELEGRAM_BOT_TOKEN" https://albot-be.alamaby.com/api/telegram/webhook "$TELEGRAM_WEBHOOK_SECRET" --allow-prod
```

**Penanganan secret (Anti-Exfiltration):**

- JANGAN pernah `echo`, `cat`, atau paste `TELEGRAM_BOT_TOKEN` / `SUPABASE_SECRET_KEY` / `sb_secret_*` ke chat, log, atau issue. Script `set-telegram-webhook.mjs` sengaja tidak pernah mencetak token.
- Cek env yang ada tanpa nilai: `node -e "console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'set' : 'unset')"`
- Jika token terlanjur bocor, segera rotasi: @BotFather → `/revoke` → update `.env` + Vercel Production env `TELEGRAM_BOT_TOKEN` + GitHub Environment `production` + set ulang webhook prod seperti di atas, lalu redeploy prod.

## Docs

- `docs/architecture.md` — alur prompt → generate + tech stack (diagram mermaid).
- `docs/environment-variables.md` — inventory dan syarat environment per milestone.
- `docs/runbooks/production-handoff.md` — runbook operasional production (provider, key, allowlist, webhook, migration, insiden).
- `docs/runbooks/milestone-6-incident-response.md` — diagnosa insiden via endpoint internal.
- `docs/retention.md` — kebijakan retention metadata.
