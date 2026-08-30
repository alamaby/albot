# CI Deploy Pipeline (21× Failure → RCA + Fix) & Prod Recovery 500 Incident

Date: 2026-08-30 (analysis + fix)

## Task / Problem
1. Workflow `deploy-development` (auto deploy Vercel preview + alias `albot-dev` saat push main, dibuat `00c7a6c` 29 Ags) **gagal 21× berturut-turut — belum pernah sukses**. Thread 7 commit `fix(ci)` (30 Ags) belum tuntas.
2. Cron `recovery-production` gagal 6× berturut-turut sejak 29 Ags 18:00 UTC — endpoint `https://albot-be.alamaby.com/api/recovery/run` balas HTTP 500 `{"ok":false,"reason":"internal"}`.

## RCA CI (3 lapis kronologis)
1. Run pertama: secrets `VERCEL_*` kosong karena job tanpa `environment: development` (fixed `1827187`)
2. Runner baru tidak punya `.vercel/project.json` (gitignored) → `vercel pull` "Could not retrieve Project Settings"
3. Re-link `9a3565c` pakai flag `--project-id` — **tidak ada di Vercel CLI 47** (`vercel link --help`: hanya `--project <NAME>`) → "unknown or unexpected option"

## Fix
`.github/workflows/deploy-development.yml` — tulis `.vercel/project.json` langsung dari secrets `VERCEL_PROJECT_ID`/`VERCEL_ORG_ID` (versi-independen, tanpa flag CLI). Commit `361d10e`. Format diverifikasi dari `.vercel/repo.json` lokal (`prj_…`/`team_…`).

## Prod Recovery Incident (hipotesis kuat, butuh keputusan user)
- Korelasi waktu: sukses terakhir 14:40 UTC, push `eff14bf` (prompt_audit) 16:13 UTC, gagal pertama 18:00 UTC
- Bukti prod auto-deploy dari main (Vercel Git integration): E2E prod 27 Ags sukses tanpa deploy manual terdokumentasi
- Akibatnya kode prod terbaru memanggil RPC `purge_prompt_audit` (migration 34) yang belum ada di DB prod (tercat 26 migrations per 26 Ags; repo kini 39)
- Health endpoint prod tetap `status:ok` (probe reachability saja)
- **Butuh keputusan user**: jalankan `migrate-production` (manual, attestation-gated, input `confirm_project_ref` + `development_run_id`) untuk migration 27–39

## Decisions
- Workflow-only fix di-push duluan (validate HEAD lama hijau, tanpa migration) agar feedback pipeline cepat
- Perbaikan prod TIDAK dieksekusi agent — outward-facing, butuh approval workflow

## Verification
- `gh run list/view` untuk 21+6 run; `vercel@47.0.2 link --help` diverifikasi lokal
- Menunggu: `deploy-development` hijau di `361d10e`

## Risks / Notes
- Sampai migrate-production dijalankan: recovery sweep prod mati (lease recovery, session expiry, purge 30d/180d tertunda), job stale menumpuk
- Pelajaran: push main = deploy prod (Git integration) — migration prod harus selalu mendahului push fitur berschema, atau matikan auto-prod

## Commit Proposal
`fix(ci): write .vercel/project.json directly from org/project IDs`
