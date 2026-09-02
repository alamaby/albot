# albot

Telegram image bot. Spesifikasi lengkap ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`. Tracking progress ada di `TODO.md`.

Status: **Post-M7 iterasi** (M0–M7 closed; tracking fitur lanjutan di `TODO.md`).

- Production: `https://albot-be.alamaby.com` (bot `@albot_ai_bot`, Supabase prod `pcexxtckvwmiquseznaz`; jumlah migration live lihat `supabase migration list` — file migration repo di `supabase/migrations/`)
- Development: `https://albot-dev.vercel.app` (Supabase dev `ceqcitzbosqzxpbtlpfn`)
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

## Production Deployment

```bash
# 1. Lokal green (wajib sebelum push, lihat AGENTS.md)
npm run db:lint && npm run db:check-migrations && npm run db:types:check \
 && npm run test:unit && npm run lint && npm run typecheck && npm run build && npm run format:check

# 2. Push main → trigger migrate-development (auto)
git push origin main
# tunggu Actions → migrate-development → success (hosted tests)

# 3. Trigger migrate-production (manual, butuh approval production environment)
# GitHub → Actions → migrate-production → Run workflow
#   confirm_project_ref: pcexxtckvwmiquseznaz
#   development_run_id: <run ID dari migrate-development untuk commit yang sama>

# 4. Seed provider keys ke prod (bila ada provider baru)
node scripts/seed-prod-bynara.mjs  # baca .env (BYNARA_*_API_KEY) → upsert 6 rows prod (hanya fingerprint di log)

# 5. Deploy Vercel production (auto via push main, atau manual)
vercel deploy --prod
# verifikasi
curl -s https://albot-be.alamaby.com/api/health | jq
curl -s "https://albot-be.alamaby.com/api/health?include=readiness" -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" | jq
# test bot @albot_ai_bot
```

## CI/CD Otomatis (push main)

Setiap push ke `main` memicu 2 workflow otomatis:

1. **`migrate-development`** (`.github/workflows/migrate-development.yml`) — apply
   migration ke Supabase dev + hosted tests (dulu manual `workflow_dispatch`,
   sekarang otomatis; dispatch tetap tersedia untuk pin commit tertentu).
2. **`deploy-development`** (`.github/workflows/deploy-development.yml`) —
   deploy Vercel Preview + re-point alias `albot-dev.vercel.app`, menunggu
   `migrate-development` sukses dulu (schema sebelum code).

**Secrets GitHub yang dibutuhkan** (Environment `development`):

- `VERCEL_TOKEN` — personal token Vercel (Vercel → Settings → Tokens).
- `VERCEL_ORG_ID` — team id Vercel (`.vercel/repo.json` → `orgId`).
- `VERCEL_PROJECT_ID` — project id (`.vercel/repo.json` → `projects[0].id`).

Tanpa ketiganya, `deploy-development` gagal di step `vercel pull`; migration
tetap jalan. Bot production tidak terpengaruh (workflow ini hanya Preview).

## Routes

- `GET /api/health` — health check dengan DB reachability yang sanitized. Tambahkan `?include=readiness` untuk snapshot operasional (job counts, dead jobs, session expiry, key cooldown) tanpa biaya provider.
- `POST /api/jobs/process` — internal job processor (Bearer `JOB_PROCESSOR_SECRET`).
- `POST /api/recovery/run` — internal recovery sweep: lease-expiry recovery, queued claim (batch 3), dead-job marking, session expiry, retention purge. Cron GitHub Actions tiap 20 menit: `recovery-development.yml` (dev, alias `albot-dev.vercel.app`) dan `recovery-production.yml` (prod, `albot-be.alamaby.com`).
- `GET /api/admin/diagnostics` — internal read-only status operasional (Bearer `JOB_PROCESSOR_SECRET`).

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

## Telegram Webhook

Dev bot (`Albot Dev`) harus menunjuk ke `https://albot-dev.vercel.app/api/telegram/webhook`. Setelah `vercel` (preview) yang menggeser deployment, alias bisa tertinggal di deployment lama — update manual:

```bash
# cek webhook saat ini (jangan paste nilai token, pakai env)
node scripts/set-telegram-webhook.mjs get "$TELEGRAM_BOT_TOKEN"

# set ulang ke alias dev (development, tanpa --allow-prod)
node scripts/set-telegram-webhook.mjs set "$TELEGRAM_BOT_TOKEN" https://albot-dev.vercel.app/api/telegram/webhook "$TELEGRAM_WEBHOOK_SECRET"

# jika albot-dev.vercel.app masih menunjuk deployment lama, pindahkan alias ke preview terbaru
vercel alias set https://<preview-deployment>.vercel.app albot-dev.vercel.app
vercel alias ls | grep albot-dev
curl -s https://albot-dev.vercel.app/api/health | jq  # harus {"environment":"development"}
```

Production (`@albot_ai_bot` → `https://albot-be.alamaby.com`):

```bash
APP_ENV=production node scripts/set-telegram-webhook.mjs set "$TELEGRAM_BOT_TOKEN" https://albot-be.alamaby.com/api/telegram/webhook "$TELEGRAM_WEBHOOK_SECRET" --allow-prod
```

**Penanganan secret (Anti-Exfiltration):**

- JANGAN pernah `echo`, `cat`, atau paste `TELEGRAM_BOT_TOKEN` / `SUPABASE_SECRET_KEY` / `sb_secret_*` ke chat, log, atau issue. Script `set-telegram-webhook.mjs` sengaja tidak pernah mencetak token.
- Cek env yang ada tanpa nilai: `node -e "console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'set' : 'unset')"`
- Jika token terlanjur bocor, segera rotasi: @BotFather → `/revoke` → update `.env` + Vercel env (Preview & Production) `TELEGRAM_BOT_TOKEN` + GitHub Secrets + set ulang webhook seperti di atas, lalu `vercel --yes && vercel alias set ...` + `vercel --prod`.

## Docs

- `docs/architecture.md` — alur prompt → generate + tech stack (diagram mermaid).
- `docs/environment-variables.md` — inventory dan syarat environment per milestone.
- `docs/runbooks/production-handoff.md` — runbook operasional production (provider, key, allowlist, webhook, migration, insiden).
- `docs/runbooks/milestone-6-incident-response.md` — diagnosa insiden via endpoint internal.
- `docs/retention.md` — kebijakan retention metadata.
