# albot

Telegram image bot. Spesifikasi lengkap ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md`. Tracking progress ada di `TODO.md`.

Status: **Milestone 7 — Production Release and Handoff** (smoke E2E prod lulus; closure pending approval).

- Production: `https://albot-be.alamaby.com` (bot `@albot_ai_bot`, Supabase prod `pcexxtckvwmiquseznaz`, 25 migrations)
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

## Docs

- `docs/environment-variables.md` — inventory dan syarat environment per milestone.
- `docs/runbooks/production-handoff.md` — runbook operasional production (provider, key, allowlist, webhook, migration, insiden).
- `docs/runbooks/milestone-6-incident-response.md` — diagnosa insiden via endpoint internal.
- `docs/retention.md` — kebijakan retention metadata.
