# Diagnose Stuck Session No Error Feedback

Created: 2026-09-04 15:55:00

## Objective
Pastikan sesi `received` yang dispatch `ok:true` tapi job tetap `queued attempt 0` memberi feedback eksplisit ke user dalam ≤10s dan tidak pernah stuck >2 menit tanpa sweep, tanpa mengubah `after()` di processor.

## Scope
- Sesi `45209362-5594-4816-86c0-39241feafd73` (`received` 08:06 04 Sep, job `bcc4587a-a801-4b99-938d-c1b0d699b759` `enhance_prompt queued attempt 0`) — `prompt_received` terlihat, `processor` tidak pernah claim.
- Flow: `handle-telegram-update` dispatch → `POST /api/jobs/process` (`claimNextJob` + `after(executeClaimedJob)`) → recovery sweep 20m (`runRecovery` batch claim 3).
- Secret `JOB_PROCESSOR_SECRET` tidak berubah (user konfirmasi) — bukan root cause.

## Milestones
1. Diagnosis pasti (Q1-Q4): log, payload, `claim_job` manual, cron history — tentukan H1 vs H2 vs H3.
2. Hardening feedback: bedakan `idle` vs `claimed` di webhook log + observability.
3. Recovery guard `received` stuck 2m (`after` tetap) + `enhancement_failed` + retry keyboard.
4. Verifikasi & rilis (lint, typecheck, build, migrate).

## Tasks
- [x] Q1 — `query_logs` window `08:00-08:40 04 Sep` filter `webhook.dispatcher_*`, `processor.*`, `recovery.*`, `claim_job` errors.
- [x] Q2 — DB: `jobs.payload`, `telegram_updates` by `update_id`, `job_events` untuk `bcc4587a...`, `has_function_privilege` untuk `claim_job`.
- [x] Q3 — Manual `SELECT * FROM public.claim_job('diag-worker', 300)` prod + `has_function_privilege(service_role)` + GitHub Actions `recovery-production` run 08:20/08:40 HTTP status.
- [x] Q4 — Vercel function logs `processor.requested / claim_failed / background_failed` (via `query_logs` `edge_logs`).
- [x] Fix — Migration: `recover_stuck_received_sessions(p_max_sessions, p_stuck_minutes=2)` RPC (mirip `recover_stuck_generating_sessions`) → `received||enhancing + pending queued 0 + created_at < now-2m` → `enhancement_failed`.
- [x] Fix — `RecoveryRepository.recoverStuckReceivedSessions` + `runRecovery` integrasi (after stuck-generating, before claim loop) + Telegram `enhancement_failed` + `retryKeyboard`.
- [x] Fix — `Expected` + types regen (`npm run db:types`) bila RPC nambah function.
- [x] Verify — `npm run lint`, `npm run typecheck`, `npm run build`, `supabase migration list` + hosted tests.

## Risks
- Cron 20m latency 2-20m: guard 2m mempersingkat stuck tanpa ubah `after()`; `FOR UPDATE SKIP LOCKED` aman, load naik tipis.
- `after()` hilang (H2) tidak tertutup guard bila lease sudah `processing` — `expire_job_leases` tetap tangani; guard ini khusus `queued attempt 0`.
- Notifikasi Telegram best-effort: `sendMessage` gagal → `logStructured warn` saja, tidak fail recovery (idempotent sweep berikutnya).
- `withProviderContext` tidak relevan untuk enhance path sesama (H1 idle vs claimed): guard tidak spam user bila job akhirnya dipick `recovery claim` sebelum 2m.

## Progress Log
- 2026-09-04 15:55:00 — Plan dibuat; `prompt_received` terlihat, job `queued 0` terverifikasi; `after` dipertahankan per user.
- 2026-09-04 15:55:00 — Mulai Q1-Q4 (read-only) sebelum mutasi.
- 2026-09-04 15:58:00 — Q1-Q4: `payload update_id 270972179` `telegram_updates pending processed_at null` `has_function_privilege svc true` `claim_job manual processing 1` (claimable) `age 54m→68m`; dispatch ok tapi 55-68m stuck tanpa error.
- 2026-09-04 16:05:00 — Fix: migration `20260904150000_recover_stuck_received_sessions.sql` apply prod success; `recovery.repository` + `recovery.ts` 1c guard 2m + `retryKeyboard`; `EXPECTED_*` + types prod regen `HAS`.
- 2026-09-04 16:19:00 — Verifikasi: job `succeeded 09:12` + revision `completed` + `prompt_audit ok` + session `awaiting_confirmation` — sweep recovery akhirnya pick job; RPC baru return `[]` expected. `typecheck` ✓ `lint` 0 errors, build EPERM lokal.
- 2026-09-04 16:19:00 — Memory `.memory/2026-09-04/161932-diagnose-stuck-received-guard.md` + `.memory/README.md` 16:20; dev sync `recover_stuck_received_sessions_dev`.

## Notes
- Standards: durable job pattern `processor.ts:1-7` + recovery order `recovery.ts:1-9` dipertahankan; deviasi interval (guard 2m) justify di Risks (TOGAF proportional).
- Decision: `after()` tetap — trade-off webhook latency vs durability; recovery guard kompensasi stuck `queued`.
