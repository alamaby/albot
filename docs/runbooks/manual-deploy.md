# Manual Deploy via Vercel CLI

Per `plans/2026-09-02-bot-dev-removal-and-auto-prod-plan.md` (Opsi C + T7a): bot development
dihapus, Preview `albot-dev.vercel.app` + workflow `deploy-development.yml` + `recovery-development.yml`
dihapus. Pipeline prod kini otomatis via CI: `push main → migrate-production (auto) → deploy-production (auto)`.
Dokumen ini dipertahankan untuk deploy manual darurat; untuk alur normal, lihat `README.md` Production Deployment.

## Topologi (production only — bot dev dihapus)

| Komponen       | Nilai                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| Vercel prod    | `https://albot-be.alamaby.com` (project prod, T7a `deploy-production.yml`)    |
| Vercel team ID | `team_7caBsxNQrtdtkzQGbPBAFYKe`                                               |
| Supabase dev   | `ceqcitzbosqzxpbtlpfn` (staging migration-only, `migrate-development` retain) |
| Supabase prod  | `pcexxtckvwmiquseznaz` (auto-migrate via CI `migrate-production` Opsi C)      |
| Bot            | `@albot_ai_bot` (production only)                                             |

> Vercel Preview / `albot-dev.vercel.app` dihapus (T7a). Vercel Git Integration dimatikan — deploy prod hanya via `deploy-production.yml` (`workflow_run` setelah `migrate-production` success) agar urutan `schema before code` terjamin.

## Prerequisites (per workstation)

- Node.js 22.x (`engines.node` di `package.json`; konsisten dengan CI)
- Vercel CLI 47+ (`npx vercel@47` di repo ini; tidak perlu global install)
- Login Vercel sekali: `npx vercel@47 login` (browser auth)

## One-time Setup

### Link project (sekali per project)

```bash
# dari root repo, branch main
npx vercel@47 link --yes
# Pilih scope: team_7caBsxNQrtdtkzQGbPBAFYKe (alamby's projects)
# Pilih project prod (bukan albot-dev — Preview dihapus)
# Hasil: .vercel/project.json (gitignored) terisi projectId + orgId
```

> Catatan: CLI 47 hanya terima `--project <NAME>`, BUKAN `--project-id`. Gunakan prompt interaktif.

### Env vars

Env vars ada di Vercel dashboard — Production only (Preview dihapus). Untuk inspeksi:

```bash
# Pull env prod ke .env.local untuk verifikasi (JANGAN commit)
npx vercel@47 env pull .env.local --environment=production
```

Env utama yang harus ada (lihat `docs/environment-variables.md` untuk lengkap):

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (rename dari SERVICE_ROLE 28 Ags `e54550f`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET` (prod only)
- `APP_ENV` (production)
- `PROVIDER_APP_URL`, `PROVIDER_APP_NAME` (28 Ags; untuk attribution OpenRouter)
- `PROVIDER_KEY_ENCRYPTION_KEY` (untuk decrypt `provider_keys` di runtime)

## Pre-deploy Checklist

1. **Schema sinkron**: pastikan workflow `migrate-production` di GitHub Actions
   hijau untuk HEAD terbaru. Cek:
   `https://github.com/alamaby/albot/actions/workflows/migrate-production.yml`
2. **Local gate** (opsional, kalau ada perubahan kode):
   ```bash
   npm ci
   npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run format:check
   ```
   Catatan Windows: `next build` lokal bisa gagal `EPERM symlink` (kebutuhan
   Developer Mode / WSL). Di Linux/Mac, build lokal OK; di Windows pakai WSL
   atau skip dan percaya CI `validate` saja.
3. **On main branch**:
   ```bash
   git checkout main && git pull origin main
   git status  # clean working tree
   ```

## Deploy

### Production (`albot-be.alamaby.com`) — otomatis via CI (normal)

Push ke `main` otomatis: `migrate-production` → `deploy-production`. Tidak perlu manual.

### Production manual darurat

```bash
npx vercel@47 deploy --prod --yes
# atau:
npx vercel@47 --prod --yes
```

## Verify

```bash
# Health prod
curl -s https://albot-be.alamaby.com/api/health | jq

# Readiness (DB)
curl -s "https://albot-be.alamaby.com/api/health?include=readiness" | jq
```

Smoke test E2E cepat: kirim `/help` ke `@albot_ai_bot` di Telegram, harus
dapat balasan daftar command. Lalu `/generate-image kucing oren di atap`
untuk test full pipeline (enhance → confirmation → image).

## Rollback

Jika deploy baru bermasalah, rollback ke deployment sebelumnya:

```bash
# List deployment terbaru
npx vercel@47 ls
# Rollback interaktif (pilih deployment)
npx vercel@47 rollback
# atau direct:
npx vercel@47 rollback <deployment-url>
```

Atau via dashboard: Project → Deployments → klik deployment sebelumnya →
"Promote to Production".

## Schema migration manual (prod)

Untuk production, schema migration **otomatis** via `migrate-production` (Opsi C, hapus gate `development_run_id`). Cara manual darurat:

```bash
# Link Supabase prod (sekali)
npx supabase link --project-ref pcexxtckvwmiquseznaz

# Push pending migrations
npx supabase db push
```

Atau via dashboard: Supabase → SQL Editor → paste isi migration file.

## Troubleshooting

### `Cannot find module '@next-community/adapter-vercel'`

`node_modules` out-of-sync. Fix:

```bash
npm ci
```

Adapter harus ada di `node_modules/@next-community/adapter-vercel/`. Versi
pin: `0.0.1-beta.29` (lihat `package.json`).

### `Invalid Node.js Version`

`vercel build` baca Node version dari package.json `engines` atau project
settings. Pastikan:

- `package.json` punya `"engines": { "node": "22.x" }` (pin `08ad863`)
- Vercel dashboard → Project Settings → General → Node.js Version = 22.x

### `Project not linked`

Jalankan `npx vercel@47 link` (lihat One-time Setup).

### `Build failed: ENOENT @vercel/next/dist/server-launcher.js`

Versi Next.js lama atau adapter config hilang. Pastikan:

- `next.config.ts` punya `adapterPath: require.resolve("@next-community/adapter-vercel")`
- Next.js version = 16.3.0 (lihat `node_modules/next/dist/docs/01-app/03-api-reference/07-adapters/`
  untuk API baru)
- Hapus `.next/` dan rebuild: `rm -rf .next && npx vercel@47 build`

### `Function timeout` di runtime

Vercel function `maxDuration` per route di `vercel.json`:

- `/api/jobs/process` = 60s
- `/api/telegram/webhook` = 30s
- `/api/recovery/run` = 60s

Adapter timeout per provider ada di `src/server/providers/index.ts` (clamp
55s per remediation 30 Ags).

### Adapter breaking changes

Next.js 16 masih 0.0.1-beta untuk adapter. Cek changelog:

- Adapter: https://github.com/nextjs/adapter-vercel/releases
- Next.js adapter API: `node_modules/next/dist/docs/01-app/03-api-reference/07-adapters/`

## Catatan

- **Deploy prod kini via `deploy-production.yml` (T7a, `workflow_run` setelah `migrate-production`)** — Vercel Git Integration dimatikan agar tidak race; manual `vercel --prod` tetap tersedia darurat.
- **Vercel CLI 47 + Next.js 16** kadang tidak auto-inject adapter (auto-inject
  hanya di Vercel platform Git integration build). Konfigurasi `adapterPath`
  di `next.config.ts` (commit `f150b01`) memastikan build bekerja baik di CLI
  maupun platform.
- **Vercel platform mungkin override `adapterPath`** untuk prod Git-integration
  builds (Vercel pakai adapter versinya sendiri). Observasi build log prod
  setelah push berikutnya; jika divergen, pindah ke `NEXT_ADAPTER_PATH` env
  var.
