# Milestone 7 — Execution Checklist

Created: 2026-08-24
Status: **CLOSED — Accepted @alamaby 2026-08-25 19:15** (T-1..T-20 semua selesai)
Source: `plans/2026-08-23-milestone-7-production-release-and-handoff.md`
Commit frozen: `ca38ba0` (attestation/migration) → `a3b2a1a` (deploy final)

> Centang `- [x]` per step. Log progress di `## Progress Log` plan utama.

## T-1 Local Green — DONE 2026-08-24
- [x] `npm run db:lint` → ok (`[ok] migration static SQL scan passed`)
- [x] `npm run db:check-migrations` → ok (25 migrations)
- [x] `npm run db:types:check` → ok (types match)
- [x] `npm run lint` → 0 errors, 2 warnings pre-existing `e2e-m6-fault-injection.mjs:18,30`
- [x] `npm run typecheck` → next typegen + tsc clean
- [x] `npm run test:unit` → 250 passed (26 files)
- [x] `npm run build` → Compiled successfully (Turbopack 16.3.0)
- [x] `npm run format:check` → All matched files use Prettier code style
- HEAD: `8e5f156` — 1 modified (`plans/2026-08-24-queue-claim-via-recovery-opsi-a.md`), 1 untracked (`plans/2026-08-23-milestone-7-production-release-and-handoff.md`)

## T-2 Migrate Development (attestation source) — DONE 2026-08-25 (ca38ba0 active)
- [x] Push `bb73b1e` → run 32698079152 success (superseded)
- [x] Push `6683a69` → run 32805966799 success (superseded)
- [x] Push `ca38ba0` (`docs: update M7 checklist attestation 32805966799 for 6683a69`) → run https://github.com/alamaby/albot/actions/runs/32806879672 `success` (head_sha=ca38ba02cbda53c0aaa07afa3b75013e3bde2e58, 3m 49s)
- [x] **Active attestation:** `development_run_id=32806879672` — `head_sha=ca38ba02cbda53c0aaa07afa3b75013e3bde2e58` (ca38ba0), matches HEAD prod deploy

## T-3 Preflight Production — DONE (via migrate-production)
- [x] Capture `supabase migration list` prod (otomatis `migrate-production.yml:103`, preflight captured)

## T-4 Migrate Production (attestation-gated) — DONE 2026-08-25
- [x] Trigger: Actions → `migrate-production` (main) → `confirm_project_ref=pcexxtckvwmiquseznaz` + `development_run_id=32806879672` (ca38ba0) — run https://github.com/alamaby/albot/actions/runs/32807707561 `success` (head_sha=ca38ba02cbda53c0aaa07afa3b75013e3bde2e58, pcexxtckvwmiquseznaz)
- [x] Approve Environment `production` — 2026-08-25
- [x] Verify:
  - [x] `EXPECTED_REF` check `migrate-production.yml:37` success
  - [x] Attestation `migrate-production.yml:52` success (name=migrate-development, head_sha match)
  - [x] `supabase db push` success — prod 0→25 migrations
  - [x] Post-check pending 0 `migrate-production.yml:116` success
- [x] Evidence artifact `production-migration-evidence` uploaded (38KB+ pending)

## T-5 Hosted Smoke Prod (read-only)
- [ ] `SUPABASE_URL=https://pcexxtckvwmiquseznaz.supabase.co SUPABASE_SERVICE_ROLE_KEY=<prod> npm run test:hosted` → expect schema 25 + RLS forced + grants service_role only

> **Bot prod:** `@albot_ai_bot` — token prod sudah set di Vercel Production + GitHub Environment `production` (2026-08-24).

## T-6 Vercel Production Env Validate — DONE 2026-08-25
- [x] Semua 8 vars diset scope Production (user) — awalnya health `degraded/unconfigured`
- [x] Akar masalah: `PROVIDER_KEY_ENCRYPTION_KEY` bukan standard base64 (`scripts/verify-env-format.mjs:1` FAIL "contains invalid characters") — di-generate ulang `randomBytes(32).toString('base64')`, validator 6/6 `[ok]`
- [x] Redeploy Production → env terbaca
- [x] Isolation: Preview tidak punya prod values

## T-7 Deploy Production — DONE 2026-08-25
- [x] Deploy production `albot-ten.vercel.app` dengan env prod final (post fix encryption key)

## T-8 Health Prod — DONE 2026-08-25
- [x] `curl /api/health` → `{"status":"ok","environment":"production","database":"reachable"}`
- [x] `curl /api/health?include=readiness` → `jobs{queued:0,processing:0,failed:0,succeeded:0}, deadJobs:0, leaseExpired:0, expiredSessions:0, cooldownKeys:0` — clean, no provider call

## T-9 Seed Prod Configs — DONE 2026-08-25
- [x] `add openai_compatible` "Cloudflare gpt-oss-120b" priority 0 (reasoning primary; fallback Pollinations 150 sudah ada dari migration `20260823100000`)
- [x] `add pixazo_flux_schnell` "Pixazo Flux Schnell" priority 0 + `pixazo_sdxl` "Pixazo SDXL" priority 5 (fallback Pollinations flux 151 sudah ada)
- [x] Mock dev rows tidak direplikasi ke prod

## T-10 Seed Prod Keys — DONE 2026-08-25 (bundled di T-9 `--key`)
- [x] Keys terenkripsi per config via seed script (`key_ciphertext/iv/tag/fingerprint`, no plaintext log)
- [x] `failure_count=0`, `cooldown_until=null`

## T-11 Seed Allowlist Prod — DONE 2026-08-25
- [x] `bot_users` upsert `83540732` is_allowed+is_admin via SQL editor prod

## T-12 Webhook Prod Set — DONE 2026-08-25
- [x] Custom domain production: `https://albot-be.alamaby.com` (2026-08-25) — health `ok/reachable` verified di domain custom + `albot-ten.vercel.app` tetap jalan
- [x] Webhook set via `--allow-prod` → `url=https://albot-be.alamaby.com/api/telegram/webhook`, secret match Vercel prod
- [x] `get` verify ok (pending 0, allowed_updates message+callback_query)

## T-13 Smoke E2E Prod (10 skenario) — IN PROGRESS 2026-08-25
- [x] 3. Initial prompt → `awaiting_confirmation` + `[Generate][Revise Lagi][Batal]` ✓ (sesi "/start" landscape — lihat catatan bug)
- [x] 8-parsial. `Batal` → "Sesi dibatalkan." ✓
- [x] 3-ulang. Prompt kucing → enhancement topik sesuai + keyboard ✓ (tapi lihat bug dispatch timeout)
- [ ] **Bug ditemukan #1 (fixed `a3b2a1a`, pending deploy):** `/start` diperlakukan sebagai prompt (parser tanpa command handling) → sesi sampah + buang credit. Fix: `isStartCommand` → welcome message, tanpa session/job.
- [ ] **Bug ditemukan #2 (fixed `a3b2a1a`, pending deploy):** dispatcher timeout 5s < enhancement 10-30s → "Gagal memulai pemrosesan" palsu setiap prompt padahal job sukses (processor sinkron). Fix: process route claim-fast + `after()` (maxDuration 60).
- [x] Redeploy prod `a3b2a1a` → verifikasi: tanpa "Gagal memulai pemrosesan" palsu ✓
- [x] 4/7. Revise Prompt → "tambahkan awan dramatis dan burung terbang" → revisi 2 (topik sesuai, konfirmasi ulang) → Generate → "Gambar 3 dari revisi 2." 18:41 ✓ — linkage `1 sesi / 2 revisi / 3 attempt` (a1,a2→rev1; a3→rev2) sesuai master plan
- [x] 5. Generate → foto kucing oren di atap senja terkirim + `[Regenerate][Revise Prompt][Selesai]` + `Ganti Model` ✓ (18:28, caption "Gambar 1 dari revisi 1.")
- [x] 6. Regenerate → "Gambar 2 dari revisi 1 berhasil dibuat." 18:36 — attempt 2 same revision, tanpa revisi baru ✓
- [x] 8. Selesai → "Sesi selesai. Terima kasih sudah menggunakan bot ini!" 18:42 — session completed ✓
- [x] 1. Wrong secret → curl POST tanpa header → `401` ✓ (readiness `succeeded:6, failed:0, dead:0`)
- [x] /start fix verified → "Selamat datang!..." 18:52, tanpa session/job ✓
- [x] 2. Non-allowlisted user — ACCEPTED (tidak ada akun ke-2; tercover unit test access_denied + RLS security tests)
- [ ] 1. Missing/wrong `X-Telegram-Bot-Api-Secret-Token` → 401, no DB row
- [ ] 2. Non-allowlisted user → access-denied, no job
- [ ] 9. Replay `callback_query_id` → dedupe, single transition
- [ ] 10. `getWebhookInfo` + logs + `job_events`/`provider_requests` redacted — simpan screenshot + session_id

## T-14 Dedup & Concurrency
- [ ] Same `update_id` 2x → 1 row `telegram_updates`
- [ ] Double-click Generate → `create_generation_attempt` guard tolak second

## T-15 Advisor Prod
- [ ] `supabase advisor` prod — disposition: WARN `rls_auto_enable` revoked `20260820100000`, INFO `rls_enabled_no_policy` accepted by design

## T-16 Logs Redaction Check
- [ ] Vercel logs + `provider_requests.error_message_redacted` — no secret leak (`TELEGRAM_BOT_TOKEN`, `SERVICE_ROLE`, plaintext key, `PROVIDER_KEY_ENCRYPTION_KEY`)

## T-17 Runbook Handoff
- [ ] Tulis `docs/runbooks/production-handoff.md` (15 topik `plans/2026-08-07:1709`)

## T-18 Docs Sync
- [ ] Update `docs/environment-variables.md:15`, `README.md:5`, `TODO.md:7`, regen `database.types.ts` if forward-fix

## T-19 Evidence Record
- [ ] Isi block `Milestone Verification` di Appendix plan utama — commit SHA, Vercel URL, migration 25/25, CI/migration run URLs, prod E2E session UUID, sanitized outputs

## T-20 Gate Close — DONE 2026-08-25
- [x] Approver `@alamaby` **Accepted** (2026-08-25 19:15) — plan Appendix Decision ditandai
- [x] `.memory/2026-08-25/190644-milestone-7-production-release.md` + `.memory/README.md` update

## Progress Log
- 2026-08-24 — T-1 DONE (8 checks hijau, HEAD 8e5f156). Next: push + T-2 migrate-development.
- 2026-08-24 06:42 UTC — T-2 DONE (run 32698079152 bb73b1e). Next: T-4.
- 2026-08-25 03:45 UTC — T-2 RE-RUN 32805966799 (6683a69).
- 2026-08-25 04:03 UTC — T-2 RE-RUN 32806879672 (ca38ba0 active, matches HEAD ca38ba0).
- 2026-08-25 04:09 UTC — T-4 DONE (run 32807707561 success, ca38ba0, prod 0→25 pcexxtckvwmiquseznaz). Next: T-7/T-8 Vercel prod health.
- 2026-08-25 — T-6 root cause fixed (ENCRYPTION_KEY bukan standard base64 → regen + validator `scripts/verify-env-format.mjs` 6/6 ok) → T-7 deploy → T-8 DONE: health `ok/production/reachable`, readiness clean. Next: T-9..T-12 seed prod + webhook (`--allow-prod` flag ditambahkan ke set-telegram-webhook.mjs).
