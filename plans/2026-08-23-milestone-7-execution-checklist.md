# Milestone 7 — Execution Checklist

Created: 2026-08-24
Source: `plans/2026-08-23-milestone-7-production-release-and-handoff.md`
Commit frozen: `bb73b1e` (HEAD saat T-1 green, pushed 2026-08-24) — attestation SHA

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

## T-2 Migrate Development (attestation source) — DONE 2026-08-24
- [x] Push commit `bb73b1e` ke `main`: `bb73b1e docs: add Milestone 7 production release and handoff plan` (pushed 8e5f156..bb73b1e)
- [x] Trigger workflow: GitHub → Actions → `migrate-development` → Run workflow → `commit_sha=bb73b1e8cf981012c905ff6d027c199803a21126`
- [x] Approve Environment `development` (required reviewer `@alamaby`) — approved 2026-08-24T06:37:18Z
- [x] `success` — run https://github.com/alamaby/albot/actions/runs/32698079152 (4m 54s, `bb73b1e` on `main`)
  - `supabase migration list` before/after — Local==Remote after (25)
  - `db:types:check` pass (`[ok] generated types match`)
  - `test:hosted` pass (hosted via `scripts/assert-hosted-tests.mjs`)
- [x] `development_run_id=32698079152` — `head_sha=bb73b1e8cf981012c905ff6d027c199803a21126`, `conclusion=success`, `name=migrate-development` verified via API

## T-3 Preflight Production
- [ ] Capture `supabase migration list` prod (otomatis di `migrate-production.yml:103`, simpan evidence)

## T-4 Migrate Production (attestation-gated)
- [ ] Trigger: Actions → `migrate-production` (hanya dari `main` — `migrate-production.yml:27`) → inputs:
  - `confirm_project_ref=pcexxtckvwmiquseznaz`
  - `development_run_id=<dari T-2>`
- [ ] Approve Environment `production`
- [ ] Verify workflow steps:
  - [ ] `EXPECTED_REF` check (`migrate-production.yml:37`)
  - [ ] Attestation `name==migrate-development && conclusion==success && head_sha==github.sha` (`migrate-production.yml:52`)
  - [ ] `supabase db push` success
  - [ ] Post-check pending 0 (`grep '^\s*[0-9]{14}\s*\|\s*\|'` no match — `migrate-production.yml:116`)
- [ ] Simpan evidence artifact `production-migration-evidence`

## T-5 Hosted Smoke Prod (read-only)
- [ ] `SUPABASE_URL=https://pcexxtckvwmiquseznaz.supabase.co SUPABASE_SERVICE_ROLE_KEY=<prod> npm run test:hosted` → expect schema 25 + RLS forced + grants service_role only

> **Bot prod:** `@albot_ai_bot` — token prod sudah set di Vercel Production + GitHub Environment `production` (2026-08-24).

## T-6 Vercel Production Env Validate — DONE 2026-08-24 (user set)
- [ ] Vercel Dashboard → `albot` → Settings → Environment Variables → **Production** (≠ Preview):
  - [ ] `SUPABASE_URL=https://pcexxtckvwmiquseznaz.supabase.co`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` (prod, ≠ dev)
  - [ ] `SUPABASE_PUBLISHABLE_KEY` (prod)
  - [ ] `PROVIDER_KEY_ENCRYPTION_KEY` base64 decode 32 bytes (`node -p "Buffer.from(process.env.X,'base64').length"` → 32, `src/env.ts:16`)
  - [ ] `TELEGRAM_BOT_TOKEN` prod format `^[0-9]+:[A-Za-z0-9_-]+$` (`src/env.ts:24`) — **bot berbeda dari dev**
  - [ ] `TELEGRAM_WEBHOOK_SECRET` ≥8 URL-safe (`src/env.ts:32`)
  - [ ] `JOB_PROCESSOR_SECRET` ≥32 (`src/env.ts:37`)
- [ ] Verify Preview env **tidak** punya prod values (isolation)

## T-7 Deploy Production
- [ ] Deploy exact SHA T-2 ke Vercel Production (`albot-ten.vercel.app`) — catat deployment URL + SHA

## T-8 Health Prod
- [ ] `curl -s https://albot-ten.vercel.app/api/health | jq` → `{"status":"ok","environment":"production","database":"reachable"}`
- [ ] `curl -s "https://albot-ten.vercel.app/api/health?include=readiness" | jq` → readiness (jobs queued/processing/dead, cooldown) — no provider call

## T-9 Seed Prod Configs
- [ ] `node scripts/seed-provider-config.mjs --env production --list` (dry-run)
- [ ] `node scripts/seed-provider-config.mjs --env production` — verify `provider_configs` (reasoning openai_compatible + pollinations 150, image pixazo_flux_schnell/sdxl + pollinations_image 151)

## T-10 Seed Prod Keys
- [ ] Insert `provider_keys` terenkripsi (ciphertext/iv/tag/fingerprint via `src/server/security/encryption.ts:1`) — **no plaintext di log/commit**
- [ ] `SELECT failure_count==0, cooldown_until is null` — verify

## T-11 Seed Allowlist Prod
- [ ] `INSERT bot_users (telegram_user_id 83540732 is_allowed true is_admin true)` — verify

## T-12 Webhook Prod Set
- [ ] `node scripts/set-telegram-webhook.mjs --env production get` → expect not set
- [ ] `node scripts/set-telegram-webhook.mjs --env production set --url https://albot-ten.vercel.app/api/telegram/webhook`
- [ ] `get` verify: `url==https://albot-ten.vercel.app/api/telegram/webhook`, `pending_update_count==0`, `allowed_updates==["message","callback_query"]`, `last_error_message==null`

## T-13 Smoke E2E Prod (10 skenario)
- [ ] 1. Missing/wrong `X-Telegram-Bot-Api-Secret-Token` → 401, no DB row
- [ ] 2. Non-allowlisted user → access-denied, no job
- [ ] 3. Initial prompt → `awaiting_confirmation` + `[Generate][Revise Lagi][Batal]`
- [ ] 4. Revise Lagi → instruction → new revision (old immutable)
- [ ] 5. Generate → `succeeded` + foto + `[Regenerate][Revise Prompt][Selesai]`
- [ ] 6. Regenerate → attempt baru same revision
- [ ] 7. Revise after result → new revision → generate → linkage 1/2/3
- [ ] 8. Selesai → `completed`, callback lama rejected
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

## T-20 Gate Close
- [ ] Approver `@alamaby` Accepted + `.memory/YYYY-MM-DD/HHmmss-milestone-7-production-release.md` + `.memory/README.md:1` update

## Progress Log
- 2026-08-24 — T-1 DONE (8 checks hijau, HEAD 8e5f156). Next: push + T-2 migrate-development.
- 2026-08-24 06:42 UTC — T-2 DONE (run 32698079152 success, bb73b1e, 25 migrations). Next: T-4 migrate-production.
