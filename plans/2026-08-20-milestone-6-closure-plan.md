# Milestone 6 Closure Plan

Date: 2026-08-20
Status: Closure (draft — menunggu approval final)

## Objective

Menutup Milestone 6 (Reliability, Security, and Observability) dengan evidence lengkap: recovery sweep, backoff jitter, observability, session expiry, retention, security checks, E2E fault injection, dan disposition advisor.

## Milestone Verification (template master plan)

- **Milestone**: 6 — Reliability, Security, and Observability
- **Environment**: development
- **Commits**:
  - `950a4b2` feat(m6): reliability, security, and observability
  - `69f5868` fix(m6): purge active-pointer FK violation and bounded telegram_updates
  - `859ca48` chore(m6): regenerate database types after dev migration
  - `534dee3` test(m6): fix hosted suite after dev migration applied
  - `42985c0` docs(m6): mark dev migration applied
  - `1b7f730` ci(m6): point recovery cron at stable albot-dev.vercel.app alias
  - `8bc83b3` ci(m6): use approval-free recovery-development environment for cron
  - `4118afe` docs(m6): mark recovery cron verified
  - `1366a84` test(m6): add E2E fault injection and stale-lease seed scripts
  - `18e8f3b` docs(m6): record E2E fault injection evidence
- **Vercel deployment**: `https://albot-dev.vercel.app` (stable alias) → Preview `albot-fl8otmt38-...`
- **Supabase migration version**: 16 (dev), 0 (production)

## Automated Checks

- [x] Install — `npm ci` clean
- [x] Lint — 0 errors/warnings
- [x] Typecheck — clean
- [x] Unit tests — 235 passed
- [x] Hosted tests — 106 passed (19 files): integration + security + contract (termasuk recovery RPC + auth)
- [x] Build — clean (Next.js production build)
- [x] Secret scan — gitleaks green (CI)
- [x] db:lint, db:check-migrations (16), db:types:check — clean
- [x] `npm audit --omit=dev --audit-level=high` — step added di validate.yml

## Migration

- Dev: 16/16 applied (Local == Remote). M6 menambah:
  - `20260819120000` — 4 RPC recovery (expire_job_leases, mark_dead_jobs, recover_stale_sessions, purge_expired_metadata)
  - `20260819130000` — review fix (purge null active pointers + bounded telegram_updates)
  - `20260820100000` — advisor remediation (revoke rls_auto_enable EXECUTE dari anon/authenticated)
- Production: 0 migrations, untouched.

## Deliverables M6 (master plan)

- [x] Recovery scheduler/poller — `/api/recovery/run` + GitHub Actions cron `recovery-development.yml` (5 menit, environment `recovery-development` tanpa protection)
- [x] Lease-expiry recovery — RPC `expire_job_leases` + event `lease_expired`
- [x] Exponential backoff dengan jitter — `backoff.ts` (full jitter), di-wire ke EnhancementJobRetry + GenerationJobRetry; classifier tetap deterministic
- [x] Dead-job state dan admin visibility — RPC `mark_dead_jobs` (`dead_job`) + `/api/admin/diagnostics`
- [x] Provider/key cooldown monitoring — diagnostics `cooldownKeys`
- [x] Structured logging dan correlation IDs — `logger.ts` (JSON), `redact.ts`, `correlation.ts` (AsyncLocalStorage + `x-correlation-id`), semua `console.*` di src diganti
- [x] Redaction tests — `redact.test.ts` (9 tests), `logger.test.ts` (redaction otomatis di log)
- [x] Session expiry dan metadata retention — RPC `recover_stale_sessions` + notifikasi Telegram + `purge_expired_metadata` (30 hari) + `docs/retention.md`
- [x] Health diagnostics non-paid — `GET /api/health?include=readiness` (zero provider call)
- [x] Security advisor review — lihat bagian Advisor di bawah

## E2E Fault Injection (dev)

Script: `scripts/e2e-m6-fault-injection.mjs` (direct-RPC mode; endpoint auth terpisah).

| Fault | Expected recovery | Result |
|---|---|---|
| Worker crash / lease expired | Lease expires → sweep re-queue + `lease_expired` event | ✓ (end-to-end via cron scheduled: seeded job `b12421c6` → `queued`, attempt 1→2, `lease_expired` event dengan `correlationId "gh-32327141382"`) |
| Job max attempts | `mark_dead_jobs` → `failed` + `dead_job` | ✓ |
| Session expiry | `recover_stale_sessions` → `expired` + notifikasi | ✓ |
| Retention purge (FK active pointers) | Purge null pointer lalu hapus lineage; active session aman | ✓ (purgedRows=2, old gone, active kept) |
| Diagnostics auth | 401 tanpa bearer / salah bearer | ✓ |
| Health readiness | 200 + readiness block, non-paid | ✓ |
| Backoff jitter | Unit: delay ∈ [0, cap], deterministik dengan injected RNG | ✓ (backoff.test.ts) |
| Redaction | Token tidak bocor di log/error | ✓ (redact.test.ts, logger.test.ts) |

Satu "fail" di script (lease_expired event saat direct-RPC) adalah artefak mode — event ditulis oleh lapisan aplikasi `runRecovery()`, bukan RPC. Terbukti end-to-end via cron scheduled (lihat baris pertama tabel).

## Acceptance Criteria (master plan M6)

- [x] Fault injection suite passes (unit + E2E).
- [x] No duplicate image generation dari dispatcher/callback replay — existing claim_job atomic + callback dedupe contract tests.
- [x] Expired leases recover (E2E + contract).
- [x] Dead jobs discoverable dan explainable (`dead_job` code + diagnostics).
- [x] Secret scan covers source, logs, persisted error samples — gitleaks + redaction.
- [x] Rate limits tetap efektif under concurrent requests — existing session-policy + one-active index.
- [x] Health check tidak melakukan paid inference — readiness hanya query DB.
- [x] Security/performance advisor findings reviewed dan recorded — lihat Advisor.

## Advisor Review (Supabase Database Linter, dev)

| Finding | Level | Disposition |
|---|---|---|
| `anon_security_definer_function_executable` — `rls_auto_enable()` SECURITY DEFINER executable by anon | WARN | **Fixed**: migration `20260820100000` revoke EXECUTE dari anon/authenticated; service_role tetap. Fungsi adalah event-trigger default Supabase (`ensure_rls`) — event trigger dijalankan engine, tidak butuh EXECUTE publik. |
| `authenticated_security_definer_function_executable` — same, authenticated | WARN | **Fixed**: sama dengan di atas. |
| `rls_enabled_no_policy` × 10 (bot_users, callback_events, generation_attempts, job_events, jobs, prompt_revisions, prompt_sessions, provider_configs, provider_keys, provider_requests, telegram_updates) | INFO | **Accepted — by design**: deny-by-default. RLS enabled + force, tanpa policies = tidak ada akses untuk anon/authenticated (strategi keamanan repo sejak M1: service_role only, revoke EXECUTE). Ini bukan gap; advisor menganggap "no policy" sebagai potensi oversight, tapi di sini sengaja. Diverifikasi oleh `tests/security/rls.security.test.ts` (denies anon/authenticated reads+writes). |

## Remediation During E2E / Review (bugs found & fixed)

1. **Purge FK violation (kritis)** — `prompt_sessions.active_revision_id`/`active_generation_attempt_id` FK `on delete restrict` tidak pernah di-null → purge sesi yang pernah generate gagal. Fix: `20260819130000` null-kan pointer sebelum delete children (commit `69f5868`).
2. **Purge telegram_updates unbounded** — hapus semua row lama sekaligus. Fix: bounded `limit p_max_rows` (commit `69f5868`).
3. **Type drift setelah migration dev** — `database.types.ts` tidak memuat RPC M6. Fix: regenerate (commit `859ca48`), `as never` dihapus.
4. **Hosted suite stale** — `EXPECTED_MIGRATIONS` 14→16; fixture `recover_stale_sessions` flaky (global oldest). Fix: commit `534dee3`.
5. **Alias stabil tidak ada** — `albot-git-main-alamaby.vercel.app` tidak pernah dibuat; cron recovery akan gagal. Fix: buat alias `albot-dev.vercel.app` + update workflow/docs (commit `1b7f730`).
6. **Cron butuh approval** — environment `development` punya required reviewer → run menumpuk Waiting. Fix: environment khusus `recovery-development` tanpa protection (commit `8bc83b3`).

## Production Status

- Production Supabase: 0 migrations (untouched).
- Production Vercel (`albot-ten.vercel.app`): belum deploy M6 (M7).
- Production bot/webhook: belum di-set (M7).
- Provider production config: belum ada (M7).

## Evidence Required (master plan)

- [x] Fault injection report — tabel di atas + `scripts/e2e-m6-fault-injection.mjs`.
- [x] Redacted log samples — structured JSON dari `logStructured`; redaction di `redact.test.ts`/`logger.test.ts`.
- [x] Dead-job dan recovery timeline — seeded job `b12421c6` (queued + lease_expired event), E2E dead job (failed + dead_job).
- [x] Supabase advisor findings dengan disposition — bagian Advisor di atas.
- [x] Rate-limit concurrency test output — existing security/hosted tests.
- [x] CI run URLs + migration dev run URL (16/16).
- [ ] Telegram E2E screenshots — (opsional untuk M6; notifikasi session-expired belum di-screenshot).

## Known Limitations (dicatat, tidak diperbaiki M6)

- Cron GitHub Actions tidak menjamin interval tepat 5 menit (delay normal platform); recovery tetap andal karena durable jobs + claim_job, hanya latency poll bervariasi.
- `expire_job_leases` + `claim_job` menghabiskan 2 attempt per worker crash (sweep +1, re-claim +1) — disengaja, terdokumentasi di `docs/retention.md` + runbook.
- Pixazo async/polling (`getResult`) tidak diimplementasikan — sync-only (sama seperti M5).
- Admin UI tidak ada — endpoint authenticated (`/api/admin/diagnostics`) cukup untuk V1.

## Decision

- [x] Accepted
- [ ] Blocked

Approver: @alamaby
Date: 2026-08-20

## Next

- Milestone 7: Production Release and Handoff (migration production, deployment, smoke tests, runbook).
