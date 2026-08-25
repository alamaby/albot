# Recovery Cron Production

Created: 2026-08-25

## Objective

Menutup gap recovery production (known limitation M7): job stuck `queued`/lease expired di prod saat ini hanya pulih jika admin trigger manual `POST /api/recovery/run`. Menambah cron sweep otomatis `*/20` terhadap `https://albot-be.alamaby.com/api/recovery/run` — pola terbukti di dev (`recovery-development.yml`, termasuk claim-queued batch 3 dari `8e5f156`).

## Scope

- Workflow baru `.github/workflows/recovery-production.yml` (cron `*/20` + `workflow_dispatch`)
- 1 baris kode: `export const maxDuration = 60` di `src/app/api/recovery/run/route.ts`
- GitHub Environment baru `recovery-production` (tanpa protection, 1 secret) — manual oleh user
- Docs sync: runbook prod, README, environment-variables, memory, Appendix M7

Out of scope: alerting eksternal, perubahan logika recovery, retry/queue redesign.

## Keputusan Desain (confirmed user 2026-08-25)

| Aspek | Pilihan | Alasan |
|---|---|---|
| Environment | `recovery-production` baru, tanpa protection rules | Hindari cron menunggu approval (pelajaran M6 #6) |
| Isi workflow | Minimal curl-only (tanpa checkout/npm ci) | Dev workflow checkout+install hanya untuk 1 curl — sia-sia |
| URL | Hardcode prod (repository-reviewed, non-secret) + override `workflow_dispatch` | Mirror pola dev |
| Jadwal | `*/20 * * * *` | Sama dengan dev (opsi A 2026-08-24) |
| maxDuration | `60` di recovery route | Terbukti aman di Vercel Hobby (process route M7) |
| Secret | `JOB_PROCESSOR_SECRET` nilai prod di env `recovery-production` | Endpoint auth sama |

## Tasks

- [ ] T-1 (user): GitHub Environment `recovery-production` + secret `JOB_PROCESSOR_SECRET` prod
- [x] T-2: `maxDuration = 60` di recovery route
- [x] T-3: Workflow `recovery-production.yml`
- [x] T-4: Verifikasi lokal (lint 0 error, typecheck ok, 255 unit, build ok, format ok)
- [x] T-5: Commit + push `main` (`ab6e729` + docs `f1286fd`)
- [ ] T-6 (user): Manual dispatch → expect HTTP 200 + JSON sweep
- [ ] T-7 (user): Verifikasi scheduled run pertama jalan
- [x] T-8: Docs sync
- [x] T-9: Appendix M7 limitation → resolved

## Risks

| Risiko | Mitigasi |
|---|---|
| Cron menumpuk Waiting (environment berprotection) | `recovery-production` tanpa protection — verifikasi T-6/T-7 |
| Sweep ter-kill platform saat claim job berat | `maxDuration=60`; self-healing lease expiry (attempt +1 terdokumentasi) |
| Schedule workflow di-disable GitHub (repo idle 60 hari) | Cek berkala; dispatch manual fallback terdokumentasi |
| Secret salah env | 401 pada T-6 → perbaiki; URL hardcode prod mencegah salah target |
| Double-claim dengan dispatch normal | `claim_job` atomic SKIP LOCKED — aman by design |

## Progress Log

- 2026-08-25 — Plan dibuat + dikonfirmasi user (minimal curl-only, `*/20`, `maxDuration=60`). Eksekusi dimulai.
- 2026-08-25 22:01 — T-2..T-5, T-8, T-9 DONE (`ab6e729` + `f1286fd`). Sisa T-1/T-6/T-7 milik user (GitHub): buat environment `recovery-production` + secret prod, manual dispatch, verifikasi schedule run pertama.

## Notes

- Tidak ada perubahan logika recovery — kode sama terbukti di dev + M6 E2E + M7 (claim path).
- Commit proposal: `feat: add recovery cron for production (*/20, curl-only workflow)`
