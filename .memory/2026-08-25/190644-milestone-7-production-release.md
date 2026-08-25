# Milestone 7 — Production Release and Handoff

Date: 2026-08-25 19:06:44
Status: Implementation complete — closure pending approver sign-off (@alamaby)

## Task / Problem

Menutup M7: migration 0→25 ke prod `pcexxtckvwmiquseznaz` (attestation-gated), deploy Vercel production, seed configs/keys/allowlist, webhook `@albot_ai_bot`, smoke E2E 10 skenario, runbook handoff.

## Key Files Changed

- `plans/2026-08-23-milestone-7-production-release-and-handoff.md` — plan utama + T-19 evidence terisi
- `plans/2026-08-23-milestone-7-execution-checklist.md` — checklist eksekusi (T-1..T-19 done)
- `scripts/verify-env-format.mjs` — NEW: validator format env prod (nilai tidak di-print)
- `scripts/set-telegram-webhook.mjs` — flag `--allow-prod` (M3 guard jadi opt-in)
- `src/app/api/jobs/process/route.ts` — claim-fast + `after()` (maxDuration 60), tidak lagi sinkron
- `src/server/jobs/processor.ts` — ekstrak `executeClaimedJob(job, workerId)`
- `src/server/application/handle-telegram-update.ts` — `isStartCommand` → welcome, bukan prompt
- `src/server/telegram/messages.ts` — pesan `welcome`
- `docs/runbooks/production-handoff.md` — NEW: runbook 15 topik operasional prod
- `README.md`, `TODO.md`, `docs/environment-variables.md` — status M7 + prod refs

## Technical / Business Decisions

- **Attestation re-run 3x**: setiap push docs setelah migrate-dev membatalkan `head_sha` match (`migrate-production.yml:77`) → re-run migrate-dev untuk HEAD baru (final `development_run_id=32806879672`, SHA `ca38ba0`). Pelajaran: freeze commit sebelum T-2, jangan push apa pun sampai prod migrate selesai.
- **Blast radius 0→25 diterima** sebagai satu atom — dimitigasi attestation exact-SHA + preflight/postflight, bukan staged rollout.
- **Claim-fast dispatch**: processor tidak lagi menjalankan job sinkron di request HTTP; claim → respond → `after()`. Recovery sweep tetap inline (`processNextJob` dipertahankan untuk recovery.ts).
- **`--allow-prod` webhook**: M3 guard tetap default-refuse, opt-in eksplisit untuk M7+.
- **Domain custom** `albot-be.alamaby.com` untuk webhook prod (user menambahkan di Vercel).

## Bugs Ditemukan & Fixed Saat Smoke (commit a3b2a1a)

1. `/start` diperlakukan sebagai prompt (parser tanpa command handling) → sesi sampah + enhancement landscape hallucination + buang credit. Fix: `isStartCommand` → welcome message tanpa session/job.
2. Dispatcher timeout 5s (`handle-telegram-update.ts:114`) < durasi enhancement 10–30s → "Gagal memulai pemrosesan" palsu DI SETIAP prompt padahal job sukses. Fix: process route claim-fast + `after()`; pesan gagal kini hanya muncul saat claim benar-benar gagal.

## Assumptions / Risks

- `maxDuration 60s` (Vercel Hobby) < Pixazo adapter timeout 120s — generation >60s akan terkill platform; belum terjadi (smoke 1–3 menit selesai <60s), lease recovery menutup kasus ini.
- Recovery cron hanya development; prod mengandalkan dispatch feedback + manual `POST /api/recovery/run`.
- Skenario smoke 2 (non-allowlisted) ACCEPTED tanpa uji manual (tidak ada akun ke-2; tercover unit + RLS tests); skenario 9 (dedupe replay) tercover contract tests.

## Verification Performed

- T-1 local green (8 checks), T-2 dev migrate success (3 runs, final 32806879672), T-4 prod migrate success (32807707561, 0→25), T-8 health `ok/production/reachable` + readiness clean, T-13 smoke: skenario 1,3,4/7,5,6,8 + /start + Batal lulus; linkage `1 sesi / 2 revisi / 3 attempt` sesuai master plan; `jobs.succeeded:6, failed:0, dead:0`; 255 unit pass; lint/typecheck/build/format green.
- Evidence lengkap: `plans/2026-08-23-milestone-7-production-release-and-handoff.md` Appendix.

## Blockers / Unresolved

- T-20 gate close: menunggu approver `@alamaby` menandai Accepted di plan Appendix.

## Conventional Commit Proposal

`feat: release M7 production (migrate 0->25, deploy, smoke e2e, runbook)`

## Related Plans

- `plans/2026-08-23-milestone-7-production-release-and-handoff.md` (utama)
- `plans/2026-08-23-milestone-7-execution-checklist.md` (checklist)
- `plans/2026-08-24-queue-claim-via-recovery-opsi-a.md` (prekursor claim-fast)
