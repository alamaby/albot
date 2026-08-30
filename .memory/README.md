# Project Memory

Last updated: 2026-08-30 21:30 (repo analysis remediation — F1–F8 selesai)

## Current State

- Repository: `albot` (Next.js 16.3.0, TypeScript strict, vitest)
- Status: semua milestone M0–M7 CLOSED; pasca-M7 berjalan iterasi fitur/fix: command expansion (26 Ags), content-policy refusal fix + regenerate-after-failure (27 Ags), Bynara providers + timeout clamp + `SUPABASE_SECRET_KEY` rename (28 Ags), OpenRouter free models + `round_robin` + `prompt_audit` audit 180d + CI auto-pipeline (29–30 Ags). Backfill memory untuk 27–30 Ags dilakukan 30 Ags.
- Supabase projects: dev `ceqcitzbosqzxpbtlpfn` (39 migrations di repo, dev ikut migrate-development otomatis), prod `pcexxtckvwmiquseznaz` (**tercatat 26 migrations per 26 Ags — migration 27–39 BELUM terkonfirmasi apply; lihat Open Blockers**)
- Production topology: Vercel `albot-be.alamaby.com`, webhook `@albot_ai_bot`, allowlist `83540732`, provider: Cloudflare gpt-oss-120b (0) → Pollinations gpt-oss (150) → OpenRouter free ×5 (200–230, round_robin); image: Bynara a20f/a21f/nbn (picker; grok & sdxl dihapus dari picker 28 Ags), Pollinations flux (151). Kunci provider terenkripsi AES-256-GCM via `upsert-provider-key.mjs`.
- **Prod auto-deploy dari main via Vercel Git integration** (terbukti dari E2E prod 27 Ags tanpa deploy manual) — push main = kode prod baru; DB prod harus selalu mendahului.
- Health endpoint: readiness probe — HTTP 200 `status:ok` saat DB reachable, 503 `status:degraded` sebaliknya, `Cache-Control: no-store`
- CI: `validate` (PR+push), `migrate-development` + `deploy-development` (auto on push main — pipeline baru 29 Ags), `migrate-production` (manual attestation-gated), `recovery-*` cron */20 (dev hijau; **prod 500 — lihat Open Blockers**)

## Active Decisions

- Environment variables: `APP_ENV` overrides, else derived from `VERCEL_ENV`; env Supabase kini `SUPABASE_SECRET_KEY` (`sb_secret_`, rename 28 Ags `e54550f`)
- Timeout adapter image harus < 55s di bawah Vercel `maxDuration 60s` (Bynara 40s/55s; Pixazo PixelForge masih 120s — temuan F4, remediation 2026-08-30)
- Audit: metadata transaksional purge 30d (`purge_expired_metadata`), `prompt_audit` purge 180d (`purge_prompt_audit`); audit insert best-effort
- `prompt_revisions.instruction_kind`: 'source' | 'revision'; `create_revision` 5-arg (overload 4-arg di-drop `20260830100000`, PGRST203)
- Selection strategy: `priority_failover | weighted | round_robin` (kolom config); **F1: call sites hardcode `priority_failover` sehingga `round_robin` config-level belum efektif** — remediation berjalan (plan `plans/2026-08-30-repo-analysis-remediation-plan.md`)
- Retry bounded: classify error, backoff full-jitter (base 60s, cap 8m, max 4 attempts); `increment_provider_key_failure` cooldown eksponensial cap 60m
- RLS: enable+force semua tabel, nol policy, hanya `service_role`; semua RPC security definer + fixed search_path + EXECUTE service_role only
- CI deploy-development: link Vercel via penulisan `.vercel/project.json` langsung dari secrets (CLI 47 drop `--project-id`) — fix `361d10e`
- Migration: Database as Code, forward-fix only, `EXPECTED_MIGRATIONS` wajib sinkron (39 entri), immutability gate di CI

## Open Blockers

- **deploy-development**: blockir terakhir = `VERCEL_TOKEN` adalah Team Access Token (bukti: probe API `?teamId=` → 200; CLI `/v2/user` → 404 "User not found"). **User action**: ganti ke personal access token di GitHub Environment `development`, lalu `workflow_dispatch`. Semua fix workflow lain sudah di `fed6a84` (project.json langsung, ID hardcode, `--scope`, probe diagnosa).
- **PROD: `recovery-production` 500 sejak 29 Ags 18:00 UTC** — kode prod (auto-deploy) memanggil `purge_prompt_audit` yang belum ada di DB prod. **User action: jalankan `migrate-production` (manual, attestation-gated) untuk migration 27–39.** Sampai itu: recovery sweep prod mati (lease/session/purge tertunda).
- `maxDuration 60s` (Vercel Hobby): default timeout adapter sudah di-clamp ke 55s (F4, commit `0b72af2`) — known limitation tertutup di sisi kode.
- User action tooling: restart opencode + verifikasi MCP Supabase prod; restart opencode + smoke test Naraya GLM 5.3 Flash (plan 27 Ags)
- Hosted tests flaky di runner (1× dari 4 run 30 Ags) — rerun menyelesaikan.
- Pelajaran GitHub: environment yang direferensikan workflow auto-created KOSONG (tanpa secret) → cron 401 sampai secret diisi manual; deploy job tanpa `environment:` tidak menerima secrets; Team Access Token tidak bisa dipakai CLI untuk `pull` (butuh personal token).

## Recent Entries

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
- `2026-08-20/163000-migration-cleanup-and-status-message.md` — M5/M6 follow-up: cleanup mock configs, status message persisted, guardrail check-migrations.
- `2026-08-13/140000-milestone-4-implementation.md` — M4 CLOSED: enhancement/confirmation/revision E2E verified.
- `2026-08-11/100000-milestone-3-pr1-code-cleanup.md` — M3 PR#1 cleanup + runbook bootstrap.
- `2026-08-10/161500-milestone-3-implementation.md` — M3 webhook intake + durable jobs (218 tests).
- `2026-08-10/141000-milestone-2-review-followup.md` — M2 review follow-up (http.ts, https-only, fail-fast).
- `2026-08-10/111200-milestone-2-closure.md` — M2 closure.

## Related Plans

- `plans/2026-08-30-repo-analysis-remediation-plan.md` — **ACTIVE**: CI thread closure + backfill + remediasi F1–F8
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
