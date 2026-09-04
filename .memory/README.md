# Project Memory

Last updated: 2026-09-04 10:40 (Bynara reasoning rotation: nemotron-3-ultra 400/inactive diganti 5 model 162–166 + pesan gagal berkonteks provider; uncommitted, tunggu push tunggal — detail di `2026-09-04/103800-bynara-reasoning-rotation-and-failure-context.md`)

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Status: semua milestone M0–M7 CLOSED; pasca-M7 berjalan iterasi fitur/fix: command expansion (26 Ags), content-policy refusal fix + regenerate-after-failure (27 Ags), Bynara providers + timeout clamp + `SUPABASE_SECRET_KEY` rename (28 Ags), OpenRouter free models + `round_robin` + `prompt_audit` audit 180d + CI auto-pipeline (29–30 Ags). Backfill memory untuk 27–30 Ags dilakukan 30 Ags.
- Supabase projects: dev `ceqcitzbosqzxpbtlpfn` (**46 migrations** — 43 repo lama + 3 Aichixia/reasoning-pref 03 Sep; dev mengikuti versi file 1:1, `migration list` no pending), prod `pcexxtckvwmiquseznaz` (**39 migrations — migrate-production run `33345671587` sukses 2026-08-31 di `0a83769`**; prod BELUM dapat migrasi 43–46, harus migrate-production sebelum push fitur berschema)
- Production topology: Vercel `albot-be.alamaby.com`, webhook `@albot_ai_bot`, allowlist `83540732`, provider reasoning: Cloudflare gpt-oss-120b (0) → Pollinations gpt-oss (150) → OpenRouter free ×5 (200–230, round_robin); image: Pixazo 0/5 → **Aichixia flux2/lucid/phoenix/gemini (110–113; dev & prod ter-keyed 03 Sep — fingerprint 43658ea80bdf...)** → Pollinations flux (151) → Bynara 160-180 → picker 200-203. Picker Telegram: 8 model image + 8 model reasoning (per-sesi + default per-user). Kunci provider terenkripsi AES-256-GCM via `upsert-provider-key.mjs`.
- **Prod DB 46 migrations (03 Sep, migrate-production run 33733416461 sukses); kode prod masih versi lama** — `deploy-production` run 33733536728 GAGAL: `VERCEL_TOKEN` kosong di environment `production` (auto-created tanpa secret). Tunggu user isi secret + re-run deploy. `validate` run 33733416521 gagal prettier (fix commit `777ce23`, tunggu push).
- **Prod auto-deploy dari main via Vercel Git integration** (terbukti dari E2E prod 27 Ags tanpa deploy manual) — push main = kode prod baru; DB prod harus selalu mendahului.
- **Uncommitted 2026-09-04 (siap 1 commit)**: migration `20260904090000` (5 reasoning Bynara 162–166 + deactivate nemotron-3-ultra) + registrasi adapter + picker 8→13 + `FailureContext` di semua pesan gagal (provider + code + HTTP + safeMessage redacted). Unit 346/346, hosted 141/142 (1 fail = migration belum di dev, expected pre-push). RCA: sesi prod `81844d25` gagal 400 di nemotron (model removed dari router).
- Health endpoint: readiness probe — HTTP 200 `status:ok` saat DB reachable, 503 `status:degraded` sebaliknya, `Cache-Control: no-store`
- CI: `validate` (PR+push), `migrate-development` + `deploy-development` (auto on push main — pipeline baru 29 Ags), `migrate-production` (manual attestation-gated), `recovery-*` cron */20 (dev & prod hijau; deploy-development menunggu user ganti `VERCEL_TOKEN` — lihat Open Blockers)

## Active Decisions

- Environment variables: `APP_ENV` overrides, else derived from `VERCEL_ENV`; env Supabase kini `SUPABASE_SECRET_KEY` (`sb_secret_`, rename 28 Ags `e54550f`)
- Timeout adapter image harus < 55s di bawah Vercel `maxDuration 60s` (Bynara 40s/55s; Pixazo PixelForge masih 120s — temuan F4, remediation 2026-08-30)
- Audit: metadata transaksional purge 30d (`purge_expired_metadata`), `prompt_audit` purge 180d (`purge_prompt_audit`); audit insert best-effort
- `prompt_revisions.instruction_kind`: 'source' | 'revision'; `create_revision` 5-arg (overload 4-arg di-drop `20260830100000`, PGRST203)
- Selection strategy: `priority_failover | weighted | round_robin` (kolom config); **F1: call sites hardcode `priority_failover` sehingga `round_robin` config-level belum efektif** — remediation berjalan (plan `plans/2026-08-30-repo-analysis-remediation-plan.md`)
- Retry bounded: classify error, backoff full-jitter (base 60s, cap 8m, max 4 attempts); `increment_provider_key_failure` cooldown eksponensial cap 60m
- RLS: enable+force semua tabel, nol policy, hanya `service_role`; semua RPC security definer + fixed search_path + EXECUTE service_role only
- CI deploy-development: link Vercel via penulisan `.vercel/project.json` langsung dari secrets (CLI 47 drop `--project-id`) — fix `361d10e`
- Migration: Database as Code, forward-fix only, `EXPECTED_MIGRATIONS` wajib sinkron (**46 entri** sejak 03 Sep), immutability gate di CI. **Pelajaran MCP (03 Sep)**: `apply_migration` MCP merekam versi UTC apply-time (bukan timestamp file) → file migration di-rename agar nama=versi dev + isi idempotent; jangan andalkan MCP untuk versioning, pakai `supabase db push` via CLI/workflow.
- Node runtime: `engines.node: "22.x"` (pinned `08ad863`); `actions/setup-node@22` di validate + migrate workflows; **Vercel dashboard Node.js Version tetap 22.x** (konsistensi dengan prod Git-integration builds); deploy ke Vercel via **manual CLI** (`npx vercel@47`, runbook `docs/runbooks/manual-deploy.md`), bukan via `deploy-development.yml` (disabled `43b32cb`)
- Next.js 16 deployment: `adapterPath: "@next-community/adapter-vercel"` di `next.config.ts` (`f150b01`); adapter + build-utils + routing-utils di `dependencies` (bukan devDeps — `vercel build` strip devDeps)

## Open Blockers

- **`VERCEL_TOKEN` GitHub environment `production` kosong** (terungkap 2026-09-03 saat push pertama auto-prod): `deploy-production` run 33733536728 gagal di `Pull Vercel project settings` (probe HTTP 403, `No existing credentials`). Konsekuensi: kode prod belum dapat deploy Aichixia/picker + T7a (DB prod sudah schema 46 + key Aichixia — additive, aman). Fix: Settings → Environments → production → isi `VERCEL_TOKEN` (team-scoped, org `team_7caBsxNQrtdtkzQGbPBAFYKe`), lalu re-run `deploy-production` via workflow_dispatch. (Pelajaran lama terkonfirmasi: environment auto-created = KOSONG tanpa secret.)
- **Commit `777ce23` (fix prettier `seed-prod-aichixia.mjs`) belum di-push** — `validate` run 33733416521 gagal di step `Format check`.

- **Pooled image provider (ai.pooled.dev) — PARKED 2026-09-03, menunggu pihak pooled**: endpoint `/v1/images/generations` 404 (route tidak ada), `/v1/models` hanya LLM chat. Key `POOLED_API_KEY` valid tapi chat-only di `.env` lokal. Blueprint reaktivasi ada di `2026-09-03/093100-pooled-image-provider-cancelled.md`.

- **deploy-development**: **CLOSED via pivot 2026-08-31**. Workflow `deploy-development.yml` di-rename ke `.yml.disabled` (commit `43b32cb`). Deploy manual via Vercel CLI (`npx vercel@47 deploy --yes`); runbook `docs/runbooks/manual-deploy.md`. Root cause build trace failure: Next.js 16 pakai adapter API baru; fixed via `@next-community/adapter-vercel@0.0.1-beta.29` + `adapterPath` di `next.config.ts` (`bb4c885` + `f150b01`).
- ~~recovery-production 500~~ **CLOSED 2026-08-31 01:00 UTC**: migrate-production run `33345671587` sukses (prod 26→39 migrations); cron run `33346233290` → success.
- ~~PROVIDER_APP_URL~~ di-set user 2026-08-31 (atribusi OpenRouter kini mengikuti domain deployed).
- Hosted tests flaky di runner (1× dari 4 run 30 Ags) — rerun menyelesaikan.
- Pelajaran GitHub: environment yang direferensikan workflow auto-created KOSONG (tanpa secret) → cron 401 sampai secret diisi manual; deploy job tanpa `environment:` tidak menerima secrets; Team Access Token tidak bisa dipakai CLI untuk `pull` (butuh personal token), dan personal token pun harus di-scope ke team — scope "Personal Account" tidak bisa mengakses project milik team (403); **push main = deploy prod (Vercel Git integration) — migration prod harus selalu mendahului push fitur berschema** (dibuktikan insiden 29–31 Ags).

## Recent Entries

- `2026-09-04/103800-bynara-reasoning-rotation-and-failure-context.md` — 5 reasoning Bynara pengganti nemotron (400) + pesan gagal berkonteks provider; unit 346/346, hosted 141/142; **uncommitted, tunggu push tunggal + migrate/seed dev & prod**
- `2026-09-03/135635-aichixia-image-provider-and-reasoning-picker.md` — Aichixia image (4 model, priority 110–113) + picker reasoning enhance/revise (8 model, per-sesi+default); lesson MCP versioning; unit 329 + contract 107 + hosted 142/142; **dev & prod ter-keyed** (prod via `scripts/seed-prod-aichixia.mjs` post migrate-production 33733416461); open: `VERCEL_TOKEN` prod kosong → deploy-production gagal 33733536728 + prettier fix `777ce23`
- `2026-09-03/093100-pooled-image-provider-cancelled.md` — Pooled ai.pooled.dev dibatalkan: `/v1/images/generations` 404, `/v1/models` hanya LLM chat; key valid (chat-only); rantai failover image tidak berubah
- `2026-08-31/153144-manual-deploy-pivot.md` — Next.js 16 Vercel adapter + disable deploy-development CI; manual deploy via `vercel` CLI
- `2026-08-31/105212-fix-deploy-development-node-22.md` — Repo guardrail `engines.node: "22.x"` push `6a961ea`; superseded oleh pivot manual deploy
- `2026-08-30/213000-repo-analysis-remediation.md` — Remediasi F1–F8 selesai (selector per-config strategy, rate-limit /enhance-prompt, clamp 55s, env attribution, cast, docs, hygiene); unit 297 + hosted 126/126 lokal; CI thread: project.json + ID hardcode, hosted flaky 1× (rerun)
- `2026-08-30/203300-ci-deploy-pipeline-and-prod-recovery-incident.md` — RCA 21× deploy-development failure + fix `361d10e`; insiden recovery-production 500 (drift schema prod, butuh migrate-production)
- `2026-08-30/203200-*` — (plan) `plans/2026-08-30-repo-analysis-remediation-plan.md` — remediasi F1–F8 hasil analisa repo
- `2026-08-29/233000-prompt-audit-feature.md` — prompt_audit 180d + provider_requests audit columns + instruction_kind + /api/admin/prompts
- `2026-08-29/230000-openrouter-free-models-and-round-robin.md` — 5 model free OpenRouter + round_robin (temuan F1: belum efektif di config level)
- `2026-08-28/220000-bynara-providers-timeouts-env-migration.md` — Bynara providers/picker, clamp timeout, SUPABASE_SECRET_KEY, upsert-provider-key
- `2026-08-27/220000-regenerate-after-failure-fix.md` — Regenerate/Selesai dari generation_failed + cleanup stuck attempt
- `2026-08-27/210000-content-policy-refusal-fix.md` — refusal vs malformed + tombol Prompt Baru (semua jalur)
- `2026-08-26/155000-command-expansion.md` — Command expansion CLOSED: `/help`, `/generate-image` direct, `/enhance-prompt` enhance-only, 274 unit, hosted 126/126, prod 26/26, E2E OK.
- `2026-08-25/190644-milestone-7-production-release.md` — M7 CLOSED (accepted @alamaby): prod migrate 0→25 attestation-gated (32807707561), deploy albot-be.alamaby.com + @albot_ai_bot, smoke happy path lulus, runbook handoff.
- `2026-08-22/214000-pollinations-review-fix.md` — Review-fix: prompt/apiKey/b64 validation, log providerRequestId, errors 402 order, openai parity, 6 edge tests → 89 contract.
- `2026-08-22/213000-pollinations-provider-implemented.md` — Pollinations fallback IMPLEMENTED: gpt-oss priority 150 + flux 151, 402 handling, migration 20260823100000.
- `2026-08-22/150920-bot-no-response-dispatcher-swallow.md` — Fix: dispatcher swallow → `DispatchResult` + user feedback; cron ditambahkan lalu dihapus opsi 1.
- `2026-08-22/000000-pixazo-pixelforge-dev-migrate.md` — Dev migrate 23/23 aman, PF2 config + picker siap.
- `2026-08-21/083000-pixazo-pixelforge-plan.md` — Pixazo PixelForge v2 plan (type/size/seed, hybrid selection, user_image_preferences).

## Related Plans

- `plans/2026-09-03-aichixia-image-provider-and-reasoning-picker-plan.md` — Aichixia image + reasoning picker (implementasi selesai, open items: provisioning key + commit)
- `plans/2026-09-02-bot-dev-removal-and-auto-prod-plan.md` — T7a: hapus bot dev, auto prod chain (T8/T9 open)
- `plans/2026-08-31-fix-deploy-development-node-22.md` — **CLOSED** (superseded): engines.node 22.x pinned (`08ad863`), tapi tidak cukup untuk build trace — butuh adapter
- `plans/2026-08-31-nexjs16-vercel-adapter-and-manual-deploy-pivot.md` — **CLOSED**: Next.js 16 adapter + disable CI + manual deploy runbook
- `plans/2026-08-30-repo-analysis-remediation-plan.md` — **CLOSED** via manual deploy pivot (Phase 4 final user action tidak lagi applicable)
- `plans/2026-08-27-content-policy-refusal-fix.md` + `-review-followup.md` — closed
- `plans/2026-08-27-regenerate-after-failure-toast-fix.md` — closed
- `plans/2026-08-27-add-naraya-glm-5-3-flash-models.md` — tooling opencode (user action tersisa)
- `plans/2026-08-27-supabase-albot-be-production-mcp.md` — tooling opencode (user action tersisa)
- `plans/2026-08-23-milestone-7-production-release-and-handoff.md` — M7 plan + checklist (closed)
- `plans/2026-08-22-pollinations-provider-final-plan.md` — closed
- `plans/2026-08-21-pixazo-pixelforge-model-and-telegram-provider-selection.md` — closed
- `plans/2026-08-07-telegram-image-bot-implementation-plan.md` — Master plan (M0–M7 closed)

## Legacy

Entri sebelum 2026-08-26 (M0–M2, Pollinations, Pixazo detail) ada di folder `.memory/2026-08-*` masing-masing; ringkasan arsitektur ada di `docs/architecture.md`.
