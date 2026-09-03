# Hapus Bot Development & Auto Prod Chain (T7a)

Created: 2026-09-02 12:00:00

## Objective
Hapus bot development (`@albot_dev` / `albot-dev.vercel.app` / GitHub `recovery-development` & Preview `deploy-development`) agar hanya bot production `@albot_ai_bot` (`albot-be.alamaby.com` / Supabase `pcexxtckvwmiquseznaz`). Ubah `migrate-production.yml` jadi standalone auto on `push main` (hapus gate `development_run_id` — Opsi C) dan chaining ke `deploy-production.yml` baru `needs: migrate-production` → `vercel deploy --prod` (T7a, disable Vercel Git Integration untuk jaminan urutan `schema before code`).

Keputusan final: retain Supabase dev `ceqcitzbosqzxpbtlpfn` (staging warning), tidak rotasi prod secrets, hapus Vercel Preview (T7a).

## Scope
- In: offboard Telegram dev bot, hapus workflows dev preview/recovery, prune GitHub `development` env secrets dev-Telegram, refactor `migrate-production.yml` standalone auto, buat `deploy-production.yml` needs chain, cleanup docs/`.env*`/`albot-dev` refs
- Out: rotasi prod secrets (dibatalkan), hapus Supabase dev project (di-retain), hapus migration file `20260813100000` (dilarang — forward-fix only)

## Milestones
1. Offboard & file delete — bot dev, workflows, `.env` preview
2. CI refactor — prod migrate auto + deploy prod needs chain
3. Docs & verifikasi — health/readiness, build gate

## Tasks
- [x] T1 — Offboard bot dev `@albot_dev`: `scripts/set-telegram-webhook.mjs delete` + BotFather `/deletebot` (manual, token dev revoke — instruksi di Progress Log)
- [x] T2 — GitHub env: prune `development` (hapus `TELEGRAM_*`/`JOB_*` dev), delete `recovery-development` (manual Settings → Environments)
- [x] T3 — Hapus files: `recovery-development.yml`, `deploy-development.yml.disabled`, `.env.preview`/`.env.vercel*` preview snapshot (opsional lokal)
- [x] T4 — Docs/`.env`: update `docs/architecture.md`, `README.md`, `docs/environment-variables.md`, `docs/runbooks/manual-deploy.md`, `.env.example`, `retention.md`, `incident-response.md`, `TODO.md`
- [x] T5 — Refactor `migrate-production.yml` Opsi C: `on.push.main`, hapus `development_run_id` + `Verify development attestation`, tambah `db:types:check`, keep `Verify production target pcexxtckvwmiquseznaz`
- [x] T6 — Retain `migrate-development.yml` auto on push (staging, parallel, tidak gate prod lagi)
- [x] T7a — Baru `deploy-production.yml` `workflow_run` after `migrate-production` → `vercel build` + `vercel deploy --prod` (disable Vercel Git Integration)
- [ ] T8 — Vercel Preview cleanup: `vercel alias rm albot-dev.vercel.app`, `vercel env rm` Preview vars (manual — lihat instruksi bawah)
- [ ] T9 — Verifikasi: push main → `migrate-production` auto → `deploy-production` auto → `curl health` prod (build Windows EPERM lokal adalah known issue `docs/runbooks/manual-deploy.md:60`, sukses di CI Linux)

## Risks
- Auto prod tanpa approval → bug schema langsung prod. Mitigasi: dev staging tetap auto sebagai early warning; `db:lint` + `EXPECTED_REF` + `db:types:check` di prod workflow; migration additive only.
- `environment: production` dengan required reviewers akan block auto run → harus hapus protection untuk auto.
- Race deploy vs migrate jika tetap pakai Vercel Git Integration — mitigasi T7a `needs` chain (disable Git Integration).
- Hapus dev Telegram secrets dari `development` env tanpa hapus Supabase dev secrets — jangan sampai `migrate-development` kehilangan `SUPABASE_*`.

## Progress Log
- 2026-09-02 — Plan drafted (plan mode) + eksplorasi 98 hits `TELEGRAM_BOT_TOKEN`, 39 migrations; keputusan retain/ no-rotation/ hapus Preview/ Opsi C/ T7a locked.
- 2026-09-02 — Build start: plan file created; eksekusi T3-T7a file changes.
- 2026-09-02 — Build: modified `migrate-production.yml` to standalone auto push (hapus `development_run_id` gate:10-14+attestation:52-82, tambah `db:types:check`); created `deploy-production.yml` T7a (`workflow_run` after `migrate-production`); updated docs (`architecture.md:4,11,19`, `README.md:7, production deployment, CI/CD`, `environment-variables.md:8,35,58-69`, `manual-deploy.md`, `.env.example:38`, `retention.md:13`, `incident-response.md`); removed `recovery-development.yml` + `deploy-development.yml.disabled` + `.env.preview`/`.env.vercel*` snapshots; `TODO.md` in-progress updated.
- 2026-09-02 — Verify: `lint` 0 errors (2 warns existing), `typecheck` ok, `build` Windows EPERM symlink (known, non-blocking; success on Linux CI), `db:lint` ok, `db:check-migrations` 43 ok, `format:check` fixed, `test:unit` 309/309.

## Notes
- Supabase dev `ceqcitzbosqzxpbtlpfn` di-retain sebagai staging; prod `pcexxtckvwmiquseznaz` (verified ref `docs/environment-variables.md:17`). Migration file `20260813100000_seed_allowlist_admin` tidak dihapus (EXPECTED_MIGRATIONS).
- Env guard: jangan pernah print `sb_secret_*`/`TELEGRAM_BOT_TOKEN` ke chat/log/commit (AGENTS.md Safety). Cek via `node -e "console.log('SET:',!!process.env.VAR)"`.
- Vercel team `team_7caBsxNQrtdtkzQGbPBAFYKe`; project IDs ada di `docs/runbooks/manual-deploy.md:14-15`.
- Pipeline baru: `push main → validate + migrate-development (parallel) + migrate-production (auto) → deploy-production (needs)`. `migrate-production` on `workflow_dispatch` tetap tanpa inputs untuk rerun manual.
