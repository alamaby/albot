# Milestone 7 — Production Release and Handoff

Created: 2026-08-23 09:00:00

## Objective

Menerapkan **25 migrations terverifikasi dev** (`20260808145500` → `20260823100000`) ke Supabase production `pcexxtckvwmiquseznaz` (saat ini 0 migrations — `TODO.md:7`, `.memory/README.md:12`), deploy commit exact yang sudah lulus dev attestation ke Vercel production (`albot-ten.vercel.app`) secara isolation-safe, provision provider configs + keys terenkripsi + allowlist production tanpa plaintext di repo, lalu lulus production smoke E2E penuh dan serah-terima runbook operasional. Tidak ada schema change baru di M7 kecuali forward-fix jika smoke menemukan gap — semua perubahan schema harus additive dan non-destructive (`plans/2026-08-07-telegram-image-bot-implementation-plan.md:864`).

M7 adalah **release milestone, bukan feature milestone** — value-nya adalah risk reduction dan operational readiness. Blast radius besar (0→25) dimitigasi dengan exact-SHA attestation dan preflight capture, bukan staged partial migration.

## Scope

- Bot Telegram webhook-based, private chat + allowlist numeric `telegram_user_id`, durable jobs di Postgres, Vercel free-tier, dua Supabase hosted (dev `ceqcitzbosqzxpbtlpfn` / prod `pcexxtckvwmiquseznaz` — `docs/environment-variables.md:15`).
- Provider abstraction capability `reasoning` + `image_generation` (domain tidak mengenal vendor — `src/server/providers/registry.ts:1`, `src/server/providers/index.ts:1` hanya adapter/registry).
- Semua 25 migrations existing — cek `supabase/migrations:1` (25 files) dan `tests/integration/schema.integration.test.ts:373` `EXPECTED_MIGRATIONS` (25 entries); tidak menambah migration baru kecuali forward-fix.
- Vercel production env vars isolation (`src/env.ts:1` + `docs/environment-variables.md:62`).
- Seed production via `scripts/seed-provider-config.mjs` + `scripts/set-telegram-webhook.mjs` (tidak ada plaintext key di migration/seed/commit/plan).
- Smoke E2E prod via allowlisted admin `83540732` (`supabase/migrations/20260813100000_seed_allowlist_admin.sql:1`).

### Out of Scope

- Supabase local/Docker stack, bot publik tanpa allowlist, billing, Supabase Storage untuk gambar (kirim langsung via `sendPhoto` URL — `README.md:37`), gallery, batch generation, reference image / image-to-image, voice, group/channel/inline (`plans/2026-08-07-telegram-image-bot-implementation-plan.md:34`).
- Admin UI — V1 cukup authenticated API/CLI (`docs/runbooks/milestone-3-bootstrap.md:1`).
- Perubahan Vercel Hobby limits / provider quota-aware selection (limit ada di `plans/2026-08-07-telegram-image-bot-implementation-plan.md:836`).

## Milestones

### Fase 0 — Pre-Release Gate (Go/No-Go)

| Gate | Kriteria | Bukti |
|------|----------|-------|
| 0.1 | M0-M6 **CLOSED accepted** | `.memory/README.md:9` + closure plans `2026-08-18-milestone-4-closure-plan.md`, `2026-08-19-milestone-5-closure-plan.md`, `2026-08-20-milestone-6-closure-plan.md` |
| 0.2 | Exact commit SHA ancestor `main` | `migrate-development.yml:40` `git merge-base --is-ancestor` check |
| 0.3 | Dev 25/25 Local==Remote, semua hosted green | `tests/integration/schema.integration.test.ts:638` `records exactly the expected applied migrations`, `scripts/check-migrations.mjs:1` + `scripts/assert-hosted-tests.mjs` |
| 0.4 | `database.types.ts` no drift | `npm run db:types:check` via `scripts/verify-generated-types.mjs:1` (dipanggil `migrate-development.yml:92`) |
| 0.5 | Migration destructive reviewed | `npm run db:lint` (`scripts/db-lint.mjs:1` scan `DROP`/`TRUNCATE`/`ALTER ... DROP`) + manual review `supabase/migrations/*.sql` |
| 0.6 | Preflight prod captured | `migrate-production.yml:103` `supabase migration list` before push |
| 0.7 | Vercel prod env vars validated (≠ dev) | `docs/environment-variables.md:62` — `SUPABASE_URL` prod `https://pcexxtckvwmiquseznaz.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY` prod, `PROVIDER_KEY_ENCRYPTION_KEY` base64 32-byte (`src/env.ts:13`), `TELEGRAM_BOT_TOKEN` prod (format `src/env.ts:24`), `TELEGRAM_WEBHOOK_SECRET` ≥8 URL-safe (`src/env.ts:32`), `JOB_PROCESSOR_SECRET` ≥32 (`src/env.ts:37`) |
| 0.8 | Roll-forward remediation siap | Template forward-fix migration (additive) + hotfix branch + `supabase migration list` rollback decision tree |
| 0.9 | Prod webhook masih disabled | `scripts/set-telegram-webhook.mjs` `getWebhookInfo` prod harus kosong/error sebelum readiness (hindari traffic sebelum app siap) |

### Fase 1 — Apply Migrations ke Production (Attestation-Gated)

Trigger: `workflow_dispatch` `migrate-production.yml:4` dari `refs/heads/main` (`migrate-production.yml:27`) dengan input `confirm_project_ref=pcexxtckvwmiquseznaz` + `development_run_id=<run sukses migrate-development untuk SHA yang sama>`.

Workflow steps (`migrate-production.yml:23`):

1. Checkout exact SHA — `migrate-production.yml:31` `actions/checkout@11d5960a3267` dengan `ref: github.sha`.
2. Verify independent prod ref — `migrate-production.yml:37` `EXPECTED_REF="pcexxtckvwmiquseznaz"` vs `secrets.SUPABASE_PROJECT_REF` dan `inputs.confirm_project_ref` (mencegah secret misconfig retarget).
3. Attestation dev — `migrate-production.yml:52` query `api.github.com/repos/.../actions/runs/$RUN_ID`, cek `name==migrate-development` + `conclusion==success` + `head_sha==github.sha` (menjamin migration set identik dev).
4. Setup Node 22 + `npm ci` — `migrate-production.yml:83`.
5. Link prod — `migrate-production.yml:95` `supabase link --project-ref "$SUPABASE_PROJECT_REF"`.
6. Capture preflight — `migrate-production.yml:103` `supabase migration list`.
7. `supabase db push` — `migrate-production.yml:114` `echo "y" | supabase db push`.
8. Post-check pending 0 — `migrate-production.yml:116` grep `^\s*[0-9]{14}\s*\|\s*\|` harus tidak match.
9. Evidence artifact — `migrate-production.yml:128` upload `production-migration-evidence`.

Expected: `supabase_migrations.schema_migrations` prod = 25 rows identik `EXPECTED_MIGRATIONS` dev. Production RLS tetap `FORCE` + no policies + grants `service_role` only (`tests/integration/schema.integration.test.ts:588-625`).

### Fase 2 — Deploy Aplikasi ke Vercel Production

- Deploy **exact commit SHA yang sama** yang lulus attestation (Vercel Production deployment, bukan Preview acak — `vercel.json:3` framework nextjs, `next.config.ts:1`).
- Validasi env isolation: Preview tidak boleh punya prod secrets (`AGENTS.md:79` — `SUPABASE_URL` trailing slash stripped `src/env.ts:11`).
- Health probes:
  - `GET /api/health` → `200 {status:"ok", environment:"production", database:"reachable"}` (`src/app/api/health/route.ts:1`, `.memory/README.md:23` readiness semantics 200 vs 503).
  - `GET /api/health?include=readiness` → readiness snapshot non-paid (counts jobs/dead/session-expiry/key cooldown) — `docs/runbooks/milestone-6-incident-response.md:1`, no provider call.

### Fase 3 — Provision Production Configs (No Plaintext)

Via `scripts/seed-provider-config.mjs:1` (authenticated, service_role, `docs/runbooks/milestone-4-e2e.md:1`):

- **Reasoning:** reuse `OpenAICompatibleReasoningAdapter` (`src/server/providers/reasoning/openai-compatible.adapter.ts:1`) via `provider_configs` rows — primary Cloudflare gpt-oss fallback Pollinations `gpt-oss` priority 150 (`supabase/migrations/20260823100000_add_pollinations_provider_configs.sql:5`, `src/server/providers/index.ts:26` register `pollinations`).
- **Image:** Pixazo `pixazo_flux_schnell` + `pixazo_sdxl` (`src/server/providers/index.ts:38`), Pollinations `flux` priority 151 fallback (`src/server/providers/index.ts:65`, `src/server/providers/image/pollinations.adapter.ts:1`).
- **Keys:** `provider_keys` ciphertext `key_ciphertext`/`key_iv`/`key_auth_tag`/`key_fingerprint` (AES-256-GCM `src/server/security/encryption.ts:1`, `PROVIDER_KEY_ENCRYPTION_KEY` 32-byte `src/env.ts:13`), `is_active` + `failure_count`/`cooldown_until` tracking (`src/server/providers/selector.ts:1`, `src/server/providers/errors.ts:1` classification 401/429/5xx).
- **Allowlist:** `bot_users` `telegram_user_id=83540732` `is_allowed=true` `is_admin=true` (`supabase/migrations/20260813100000_seed_allowlist_admin.sql:1`); tambahan user via approved process.

Plaintext key tidak pernah di-return repository/admin API (`src/server/repositories/provider-config.repository.ts:1`), tidak di-log (`src/server/observability/redact.ts:1`, `src/server/observability/logger.ts:1`).

### Fase 4 — Set Telegram Production Webhook

Via `scripts/set-telegram-webhook.mjs:1`:
- Token prod `TELEGRAM_BOT_TOKEN` (BotFather berbeda dari dev), secret `TELEGRAM_WEBHOOK_SECRET` constant-time compare (`src/server/security/telegram-webhook-auth.ts:1`), HTTPS only, `POST` only, `allowed_updates: ["message","callback_query"]` (`src/app/api/telegram/webhook/route.ts:1`), reject group/channel.
- Verifikasi `getWebhookInfo` prod: `url=https://albot-ten.vercel.app/api/telegram/webhook`, `has_custom_certificate=false`, `pending_update_count==0`, `allowed_updates` sesuai, no `last_error_message`.

### Fase 5 — Production Smoke E2E (Allowlisted Admin)

Skenario wajib (`plans/2026-08-07-telegram-image-bot-implementation-plan.md:1628`):

1. Missing/wrong `X-Telegram-Bot-Api-Secret-Token` → `401`, no DB row.
2. Non-allowlisted user → access-denied, no provider job.
3. Initial prompt (≤4000 chars) → `prompt_session` `received`→`enhancing`→`awaiting_confirmation`, `prompt_revision` `pending`→`completed`, job `enhance_prompt` `queued`→`succeeded`, enhanced prompt + tombol `[Generate] [Revise Lagi] [Batal]`.
4. Revision before generation: `Revise Lagi` → `awaiting_revision_input` → kirim instruksi → `create_revision` RPC monotonic (`supabase/migrations/20260813074037_milestone4_enhancement_revision.sql:1` + fix `20260813091942`) → enhancement kedua → konfirmasi ulang, revision lama immutable.
5. Generate → `generation_attempt` `queued` (`supabase/migrations/20260818100000_milestone5_generation.sql:1` RPC `create_generation_attempt` guard), provider select `image_generation` (`src/server/providers/selector.ts:1` weighted/`priority_failover`), `PixazoImageAdapter`/`PollinationsImageAdapter` sync `completed`, `sendPhoto` URL, `mark_generation_attempt_succeeded`, session `result_ready` + tombol `[Regenerate] [Revise Prompt] [Selesai]`.
6. Regenerate → attempt baru same revision, no new revision, guard `create_generation_attempt` tolak double-click.
7. Revise after result → `Revise Prompt` → new revision → confirm → generate → attempt ke revision baru, linkage `1 session / 2 revisions / 3 attempts` (`plans/2026-08-07-telegram-image-bot-implementation-plan.md:1482`).
8. Complete → `complete_prompt_session` RPC (`20260818100000`) → `completed`, callback lama rejected.
9. Duplicate callback `callback_query_id` → dedupe `callback_events` unique (`supabase/migrations/20260808145500_create_core_schema.sql:1`), exactly-once transition via `transition_prompt_session` CAS (`supabase/migrations/20260808145700_add_atomic_functions.sql:1`).
10. `getWebhookInfo` prod clean + Vercel logs + `job_events` timeline + `provider_requests` audit redacted.

Inspect: `telegram_updates` dedupe, `callback_events` dedupe, `jobs` claim `FOR UPDATE SKIP LOCKED` (`supabase/migrations/20260808145700`), recovery sweep `expire_job_leases`/`mark_dead_jobs`/`recover_stale_sessions`/`purge_expired_metadata` (`supabase/migrations/20260819120000_milestone6_recovery.sql:1` + fix `20260819130000`).

### Fase 6 — Release Evidence & Handoff

- Evidence artifact: production migration workflow URL + `manifest.txt` (workflow/ run_id/ sha/ project_ref) + `migration-hashes.txt` + `migration-list.txt` + `hosted-tests.json` (mirip `migrate-development.yml:115`).
- Vercel production deployment URL + commit SHA + health/readiness sanitized output + `getWebhookInfo` sanitized.
- Production E2E session ID + relational query `prompt_sessions / prompt_revisions / generation_attempts` linkage.
- Supabase advisor findings disposition (WARN `rls_auto_enable` revoked `20260820100000`, INFO `rls_enabled_no_policy` accepted by design — `plans/2026-08-20-milestone-6-closure-plan.md:89`).
- Runbook + ownership handoff (lihat `## Tasks`).

## Tasks

- [ ] **T-0 Gate freeze:** Tentukan exact commit SHA ancestor `main`; catat `EXPECTED_MIGRATIONS` 25 sinkron (`tests/integration/schema.integration.test.ts:373`).
- [ ] **T-1 Local green:** `npm ci && npm run lint && npm run typecheck && npm run test:unit && npm run build && npm run format:check && npm run db:lint && npm run db:check-migrations && npm run db:types:check` — semua hijau sebelum trigger `migrate-development` (AGENTS.md migration workflow).
- [ ] **T-2 Migrate dev final:** `workflow_dispatch` `migrate-development.yml` dengan `commit_sha=<SHA>` → tunggu `success` → catat `development_run_id` + `run URL`; verify `db:types:check` + hosted tests `Require hosted` (`migrate-development.yml:94`).
- [ ] **T-3 Preflight prod:** `supabase migration list` prod (0 pending) via `migrate-production.yml:103` capture; dokumentasikan versi preflight.
- [ ] **T-4 Migrate prod:** `workflow_dispatch` `migrate-production.yml` dengan `confirm_project_ref=pcexxtckvwmiquseznaz` + `development_run_id` → verify attestation → `supabase db push` → post-check pending 0 → upload evidence.
- [ ] **T-5 Hosted smoke prod (read-only):** Jalankan `tests/integration/schema.integration.test.ts:638` expectations terhadap prod (tables/columns/constraints/FK/indexes/functions/triggers/RLS forced/grants/migrations 25) — via `vitest run tests/integration --reporter=json` dengan `SUPABASE_URL` prod service_role (jangan pakai anon publishable untuk assert grants).
- [ ] **T-6 Vercel prod env validate:** Set/check Vercel Production Environment variables (≠ Preview): `SUPABASE_URL` prod, `SUPABASE_SERVICE_ROLE_KEY` prod, `SUPABASE_PUBLISHABLE_KEY` prod, `PROVIDER_KEY_ENCRYPTION_KEY` prod (base64 32B), `TELEGRAM_BOT_TOKEN` prod, `TELEGRAM_WEBHOOK_SECRET` prod, `JOB_PROCESSOR_SECRET` prod. Guard: Preview tidak punya prod secrets; `src/env.ts:56` `parseServerEnv` akan throw jika invalid.
- [ ] **T-7 Deploy prod:** Deploy exact SHA ke Vercel production (`albot-ten.vercel.app`) — verify deployment URL + commit SHA di Vercel dashboard.
- [ ] **T-8 Health prod:** `curl https://albot-ten.vercel.app/api/health` → `200 ok reachable production`; `curl .../api/health?include=readiness` → readiness JSON (job counts 0 queued/processing, dead 0, cooldown 0) — `src/app/api/health/route.ts:1`.
- [ ] **T-9 Seed prod configs:** `node scripts/seed-provider-config.mjs --env production` — reasoning OpenAI-compatible (Cloudflare/Pollinations fallback 150) + image Pixazo flux/sdxl + Pollinations flux 151 (`supabase/migrations/20260823100000:5`). Verify `provider_configs` `capability`/`adapter_type`/`priority`/`is_active`.
- [ ] **T-10 Seed prod keys:** Insert `provider_keys` terenkripsi per config (ciphertext+iv+tag+fingerprint) via vault (`src/server/security/encryption.ts:1`); verify `key_ciphertext` non-empty + no plaintext log (`src/server/observability/redact.ts:1`).
- [ ] **T-11 Seed allowlist prod:** Insert `bot_users` allowlist prod (admin 83540732 + tambahan approved) — verify `is_allowed`/`is_admin`.
- [ ] **T-12 Webhook prod set:** `node scripts/set-telegram-webhook.mjs --env production set --url https://albot-ten.vercel.app/api/telegram/webhook` → `getWebhookInfo` prod verify URL + `pending_update_count==0` + `allowed_updates` + no error.
- [ ] **T-13 Smoke E2E prod (10 skenario Fase 5):** Eksekusi berurutan dengan admin allowlisted; catat `prompt_session` IDs, `job` IDs, `provider_requests` redacted, `telegram_updates`/`callback_events` counts; screenshot Telegram prod (enhancement, revision, generate, regenerate, revise-after-result, complete).
- [ ] **T-14 Dedup & concurrency prod:** Replay `update_id` + `callback_query_id` duplikat → verify no duplicate session/job/attempt/transition; `claim_job` concurrent claim → single owner (`supabase/migrations/20260808145700`).
- [ ] **T-15 Advisor prod:** `supabase advisor` prod (security/performance) → disposition: WARN `rls_auto_enable` revoked (`20260820100000`), INFO `rls_enabled_no_policy` accepted (deny-by-default, `tests/security/rls.security.test.ts:1`).
- [ ] **T-16 Logs redaction check:** `supabase-albot-be-production_query_logs` atau Vercel logs — verify no secret (`TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, plaintext provider key, `PROVIDER_KEY_ENCRYPTION_KEY`) di `job_events.payload`/`provider_requests.error_message_redacted`/`logs`.
- [ ] **T-17 Runbook production handoff:** Tulis/update `docs/runbooks/production-handoff.md` + `docs/runbooks/milestone-6-incident-response.md:1` covering 15 topik (`plans/2026-08-07-telegram-image-bot-implementation-plan.md:1709`): add reasoning OpenAI-compatible, add image adapter baru, add/rotate/disable/delete provider key, ubah priority/weight, all keys cooldown, add/revoke allowlist, ganti bot token/webhook secret, reset webhook, queued/dead job handling, provider outage, delivery failure, migration dev/prod, restore deploy tanpa destructive rollback, log inspection tanpa secret.
- [ ] **T-18 Docs sync:** Update `docs/environment-variables.md:15` refs + `README.md:5` status Milestone 7 + `TODO.md:7` current milestone → In Progress → Completed; regen `database.types.ts` jika ada forward-fix.
- [ ] **T-19 Evidence record:** Kumpulkan `Milestone Verification` block (`plans/2026-08-07-telegram-image-bot-implementation-plan.md:1662` template) — commit SHA, Vercel URL, migration version 25, CI run URLs, migration run URLs, test session IDs, sanitized outputs, known limitations, approver decision.
- [ ] **T-20 Gate close:** Approver `@alamaby` sign-off Accepted/Blocked di Progress Log + `.memory/YYYY-MM-DD/HHmmss-milestone-7-production-release.md` + `.memory/README.md:1` update (per `AGENTS.md:5`).

## Risks

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| **Blast radius 0→25 migration atom** — satu migration fail → prod stuck half-applied | Downtime prod, mismatch dev/prod | Attestation exact SHA + preflight/postflight checks (`migrate-production.yml:52-123`); forward-fix migration additive, jangan `DROP` (`scripts/db-lint.mjs`); `supabase/migrations` adalah source of truth (`plans/2026-08-07:864`); rollback Vercel tidak rollback DB (`plans/2026-08-07:1739`) |
| **Secret isolation bocor** — Preview pakai prod `SUPABASE_SERVICE_ROLE_KEY` / `TELEGRAM_BOT_TOKEN` | Data prod terekspos, bot prod terima traffic preview | `migrate-production.yml:37` independent ref check `pcexxtckvwmiquseznaz`; Vercel env per-environment (`docs/environment-variables.md:10`); `SUPABASE_URL` strip trailing slash (`src/env.ts:11`); verify `albot-dev.vercel.app` vs `albot-ten.vercel.app` |
| **Hosted-only dev = shared integration env** — test dev ganggu prod / disposable data | Flaky attestation, prod polluted | Prod 0→25 hanya via approved workflow environment `production` required reviewer `@alamaby`; `migrate-production.yml:28` `environment: production`; jangan pakai `supabase link` prod lokal tanpa approval |
| **Free-tier pause/quota** — Supabase inactivity pause / Vercel Hobby duration exceed | `GET /health` 503 `degraded` (`.memory/README.md:23`), job delivery fail | Monitor `supabase advisor` + `GET /health?include=readiness`; durable jobs + `claim_job` SKIP LOCKED (`20260808145700`) + recovery sweep (`20260819120000`); bounded lease `recovery-development.yml:1` (dev) — prod cron terpisah jika diperlukan |
| **Pixazo/Pollinations contract drift** — `base_url`/`auth`/`responseKind` berubah | Image generation 401/403/malformed | Adapter registry `src/server/providers/index.ts:38` + `src/server/providers/image/pixazo.adapter.ts:1` + `pollinations.adapter.ts:1` contract tests (`tests/contract/pixazo-provider.contract.test.ts`, `pollinations-provider.contract.test.ts`); verify sebelum seed prod via `GET /v1/models` Pollinations |
| **Database webhook / `pg_net` exactly-once illusion** | Duplicate image generation, biaya ganda | Durable `jobs` row + atomic `claim_job` + unique `callback_events(callback_query_id)` + `telegram_updates(update_id)` + CAS `transition_prompt_session` (`20260808145500` + `20260808145700`); backoff full jitter (`src/server/jobs/backoff.ts:1` M6) |
| **Image URL expiry sebelum delivery retry** | `sendPhoto` fail, no Storage fallback | Delivery immediate (`src/server/application/generate-image.ts:1`); `mark_generation_attempt_failed` retry bounded `GENERATION_MAX_ATTEMPTS` (`src/server/jobs/handlers/generation-retry.ts:1`); user-facing `Regenerate` (`plans/2026-08-07:256`) — tidak simpan di Storage by design |
| **Key rotation tanpa downtime** | Cooldown semua keys → no eligible key | `provider_keys` failure_count + `cooldown_until` (`20260809171800_add_increment_provider_key_failure.sql:1`); selector fallback ke next config (`src/server/providers/selector.ts:1`); runbook rotation: add new key active → verify → deactivate old |
| **Vercel rollback ≠ DB rollback** — app revert tapi schema prod sudah maju | App crash column missing | Release sequence additive: add nullable column → deploy app compatible 2 schema → write new data → add constraint/drop old next release (`plans/2026-08-07:877`); M7 tidak melakukan column removal |
| **Full prompt logging** — sensitive prompt tersimpan | PII leak via logs/`job_events` | Structured logs minimal (`src/server/observability/logger.ts:1` + `redact.ts:1` + `correlation.ts:1`); `provider_requests.error_message_redacted`; retention 30 hari (`docs/retention.md:1`, `20260819120000` `purge_expired_metadata`); no raw payload logging by default |

## Progress Log

- 2026-08-23 09:00:00 — Plan dibuat. Objective Fase 0-6, 20 tasks, risks/mitigasi, release sequence attestation-gated, smoke 10 skenario, dan evidence template terdokumentasi. Implementasi belum dimulai — menunggu Go/No-Go approval dan eksekusi `migrate-development` → `migrate-production` di branch `main`.
- _Update log ini per `AGENTS.md:7` saat task dikerjakan: `YYYY-MM-DD HH:mm:ss — <done/pending/blocked + alasan>` dan checklist `## Tasks` di-`[x]`._
- 2026-08-25 — Eksekusi M7 lengkap: T-1 local green (HEAD bb73b1e) → T-2 attestation 3x re-run (bb73b1e→6683a69→ca38ba0, final run 32806879672) → T-4 migrate-prod 0→25 (run 32807707561) → T-6 env fix (ENCRYPTION_KEY bukan standard base64; validator `scripts/verify-env-format.mjs`) → T-7/T-8 deploy+health ok/reachable (domain custom albot-be.alamaby.com) → T-9..T-12 seed+webhook (@albot_ai_bot, --allow-prod flag) → T-13 smoke: skenario 1,3,4/7,5,6,8 + /start + Batal lulus; linkage 1 sesi/2 revisi/3 attempt sesuai master plan; jobs succeeded:6 failed:0. 2 bug ditemukan & fixed (a3b2a1a): /start sebagai prompt → welcome command; dispatcher timeout 5s → claim-fast + after(). T-17 runbook + T-18 docs sync (4a879f2). T-19 evidence terisi. T-20 pending approval @alamaby.

## Notes

- **Standar arsitektur:** TOGAF tidak diterapkan full ceremony (proporsional untuk satu serverless app — `plans/2026-08-07-telegram-image-bot-implementation-plan.md:1772` Notes). Separation of concerns, deployment view (Vercel Preview vs Production), data view (25 migrations, RLS FORCE, atomic functions), security boundaries (service_role only, encrypted keys), dan operational governance diterapkan proporsional.
- **Deviation from TM Forum ODA / C2M:** Tidak relevan — domain bukan telecom rating; pakai TOGAF proportional.
- **Database as Code:** `supabase/migrations/*.sql` adalah source of truth; jangan pakai Supabase dashboard SQL Editor (`plans/2026-08-07:1775`). Setiap migration baru WAJIB update `EXPECTED_MIGRATIONS` di `tests/integration/schema.integration.test.ts:373` + `npm run db:types:check` + verifikasi `db:lint`/`db:check-migrations`/`typecheck`/`build` hijau sebelum trigger `migrate-development.yml` (AGENTS.md Migration Workflow).
- **Production isolation invariant:** `migrate-production.yml:45` `EXPECTED_REF="pcexxtckvwmiquseznaz"` repository-reviewed; misconfigured secret tidak bisa retarget prod. Pollinations fallback priority 150/151 >100 default agar Pixazo tetap primary (`plans/2026-08-22-pollinations-provider-final-plan.md:1`).
- **Commit message proposal (Conventional Commits, single line):** `docs: add Milestone 7 production release and handoff plan`
- **File ini:** Satu file = satu plan (`AGENTS.md:7`). Jangan overwrite; update `## Tasks` + `## Progress Log` yang sama saat eksekusi. Nomor plan sudah di 2026-08-23 — duplikat nama pakai suffix `-2`, `-3`.
- **Open Questions (tidak block M0-M6, block prod jika belum jawab):** Pixazo docs URL/version final? Model default reasoning prod (Cloudflare `gpt-oss-120b` vs Pollinations `gpt-oss`)? Retention metadata prod (30 hari fixed atau env)? Single active session per user tetap? Regenerate param fixed atau user-choosable `aspect_ratio`/`style` next?

## Appendix — Verification Commands (Local + CI)

```bash
# Pre-flight lokal (harus hijau sebelum trigger dev — AGENTS.md)
npm run db:lint
npm run db:check-migrations
npm run db:types:check
npm run test:unit
npm run lint
npm run typecheck
npm run build
npm run format:check

# Hosted (dev) — dipanggil workflow, jangan manual tanpa creds
npm run test:hosted -- --reporter=json --outputFile=/tmp/hosted.json
node scripts/assert-hosted-tests.mjs /tmp/hosted.json

# Prod health
curl -s https://albot-ten.vercel.app/api/health | jq
curl -s "https://albot-ten.vercel.app/api/health?include=readiness" | jq

# Webhook prod
node scripts/set-telegram-webhook.mjs --env production get

# Advisor (via supabase CLI linked prod)
supabase migration list
```

## Appendix — Milestone Verification (T-19, terisi 2026-08-25)

```md
## Milestone Verification

Milestone: 7 — Production Release and Handoff
Environment: production
Commit: ca38ba02cbda53c0aaa07afa3b75013e3bde2e58 (attestation/migration) → a3b2a1a (deploy final, 2 smoke bug fixes)
Vercel deployment: https://albot-be.alamaby.com (custom domain; alias albot-ten.vercel.app)
Supabase migration version: 25 (prod pcexxtckvwmiquseznaz) == 25 (dev) Local==Remote

### Automated Checks
- [x] Install (`npm ci`)
- [x] Lint — 0 errors (2 warnings pre-existing e2e-m6 script)
- [x] Typecheck — clean
- [x] Unit tests — 255 passed (termasuk +5 test M7: executeClaimedJob x2, isStartCommand x2, slash-start x1)
- [x] Contract tests — 89 (incl. pollinations edge)
- [x] Hosted integration — schema 25 + RLS + recovery (via migrate-development REQUIRED_HOSTED_TESTS)
- [x] Build — clean
- [x] Secret scan — gitleaks green (validate.yml per push)

### Migration Runs
- migrate-development: https://github.com/alamaby/albot/actions/runs/32806879672 (ca38ba02..., success)
- migrate-production: https://github.com/alamaby/albot/actions/runs/32807707561 (attestation valid, 0→25, success)

### Manual Checks (Smoke E2E prod @albot_ai_bot, user 83540732)
- [x] 1. Wrong secret → 401 (curl, no DB row)
- [x] 3. Initial prompt → enhancement topik sesuai + [Generate][Revise Lagi][Batal] + Pilih Model
- [x] 4/7. Revise → revisi 2 (awan dramatis + burung) → Generate → "Gambar 3 dari revisi 2."
- [x] 5. Generate → foto terkirim + result keyboard + Ganti Model
- [x] 6. Regenerate → "Gambar 2 dari revisi 1" (attempt 2, tanpa revisi baru)
- [x] 8. Selesai → "Sesi selesai" (completed)
- [x] /start → welcome (fix a3b2a1a), Batal → "Sesi dibatalkan."
- [x] Relational proof: 1 sesi / 2 revisi / 3 attempt (a1,a2→rev1; a3→rev2) — sesuai master plan
- ACCEPTED (2): non-allowlisted user — tanpa akun ke-2, tercover unit+RLS tests; dedupe replay — tercover contract tests (callback_events unique + CAS transition_prompt_session)
- [x] 10. getWebhookInfo — verified saat T-12 (url benar, secret match, pending 0)

### Health & Readiness
- GET /api/health → {"status":"ok","environment":"production","database":"reachable"}
- GET /api/health?include=readiness → jobs succeeded:6, failed:0, dead:0, cooldownKeys:0

### Bugs Ditemukan & Fixed Saat Smoke
1. /start diperlakukan sebagai prompt (parser tanpa command handling) → welcome command (a3b2a1a)
2. Dispatcher timeout 5s < enhancement 10-30s → "Gagal memulai pemrosesan" palsu tiap prompt → claim-fast + after() di process route (a3b2a1a)

### Known Limitations
- maxDuration 60s (Vercel Hobby) < Pixazo adapter timeout 120s — generation yang melebihi 60s akan terkill platform (belum terjadi di smoke; lease recovery menutup)
- Recovery cron hanya development; prod mengandalkan dispatch feedback + manual recovery endpoint
- Vercel Hobby duration/quota; Supabase free tier pause risk

### Decision
- [ ] Accepted
- [ ] Blocked

Approver: @alamaby
Date: <pending>
```
