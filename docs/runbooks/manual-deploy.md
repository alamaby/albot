# Manual Deploy via Vercel CLI

Per keputusan 2026-08-31: workflow `deploy-development.yml` di-disable
(rename ke `.yml.disabled`, GitHub Actions abaikan non-`.yml`). Deploy ke
Vercel dilakukan **manual** via Vercel CLI dari workstation. Skema DB tetap
otomatis via `migrate-development` CI setiap push ke main.

## Topologi

| Komponen       | Nilai                                                              |
| -------------- | ------------------------------------------------------------------ |
| Vercel dev     | `https://albot-dev.vercel.app` (alias stabil, project dev)         |
| Vercel prod    | `https://albot-be.alamaby.com` (project prod)                      |
| Vercel dev ID  | `prj_joLciwdA37o6er3DKRSkiWlOhgJs`                                 |
| Vercel team ID | `team_7caBsxNQrtdtkzQGbPBAFYKe`                                    |
| Supabase dev   | `ceqcitzbosqzxpbtlpfn` (auto-migrate via CI `migrate-development`) |
| Supabase prod  | `pcexxtckvwmiquseznaz` (manual migrate via `migrate-production`)   |
| Bot            | `@albot_ai_bot`                                                    |

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
# Pilih project: prj_joLciwdA37o6er3DKRSkiWlOhgJs (albot-dev) untuk dev
#                 atau project prod untuk prod
# Hasil: .vercel/project.json (gitignored) terisi projectId + orgId
```

> Catatan: CLI 47 hanya terima `--project <NAME>`, BUKAN `--project-id`. Gunakan prompt interaktif.

### Env vars

Env vars **sudah di Vercel dashboard** (per environment: Development / Preview / Production). Untuk inspeksi:

```bash
# Pull env ke .env.local untuk verifikasi (JANGAN commit)
npx vercel@47 env pull .env.local --environment=development
# atau production
npx vercel@47 env pull .env.local --environment=production
```

Env utama yang harus ada (lihat `docs/environment-variables.md` untuk lengkap):

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (rename dari SERVICE_ROLE 28 Ags `e54550f`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`
- `APP_ENV` (development / preview / production)
- `PROVIDER_APP_URL`, `PROVIDER_APP_NAME` (28 Ags; untuk attribution OpenRouter)
- `PROVIDER_KEY_ENCRYPTION_KEY` (untuk decrypt `provider_keys` di runtime)

## Pre-deploy Checklist

1. **Schema sinkron**: pastikan workflow `migrate-development` di GitHub Actions
   hijau untuk HEAD terbaru. Cek:
   `https://github.com/alamaby/albot/actions/workflows/migrate-development.yml`
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

### Preview (alias `albot-dev.vercel.app`)

```bash
npx vercel@47 deploy --yes
# atau shorthand:
npx vercel@47 --yes
# Output: URL preview baru + auto-set alias albot-dev (jika dikonfigurasi di project)
```

Vercel akan auto-generate URL preview acak (`<branch>-<hash>-<team>.vercel.app`).
Untuk point `albot-dev.vercel.app` ke deployment ini:

```bash
npx vercel@47 alias set <deployment-url> albot-dev.vercel.app
```

### Production (`albot-be.alamaby.com`)

```bash
npx vercel@47 deploy --prod --yes
# atau:
npx vercel@47 --prod --yes
```

## Verify

```bash
# Health dev
curl -s https://albot-dev.vercel.app/api/health | jq
# {"status":"ok","environment":"production","database":"reachable"}

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

Untuk production, schema migration **tidak otomatis** (CI `migrate-production`
perlu attestation-gated). Cara manual:

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

- **Vercel Git integration (prod)** masih auto-deploy dari main (di luar workflow
  `deploy-development.yml` ini). Jadi prod sebenernya deploy via Git integration
  - manual via CLI; dua jalur. Gunakan CLI untuk kontrol lebih (rollout
    selektif, alias manual, dst).
- **Vercel CLI 47 + Next.js 16** kadang tidak auto-inject adapter (auto-inject
  hanya di Vercel platform Git integration build). Konfigurasi `adapterPath`
  di `next.config.ts` (commit `f150b01`) memastikan build bekerja baik di CLI
  maupun platform.
- **Vercel platform mungkin override `adapterPath`** untuk prod Git-integration
  builds (Vercel pakai adapter versinya sendiri). Observasi build log prod
  setelah push berikutnya; jika divergen, pindah ke `NEXT_ADAPTER_PATH` env
  var.
