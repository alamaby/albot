# Repo Analysis Remediation — CI Thread Closure, Doc Backfill, Findings F1–F8

Date: 2026-08-30

## Task / Problem
Melanjutkan tiga thread sekaligus: (1) menutup thread CI hardening `deploy-development` (21× gagal sejak 29 Ags), (2) backfill dokumentasi kerja 27–30 Ags yang belum tercatat, (3) remediasi 8 temuan analisa repo (F1–F8). Plan: `plans/2026-08-30-repo-analysis-remediation-plan.md`.

## Work Done

### CI thread (deploy-development)
- RCA 3 lapis: secrets kosong tanpa `environment:` (fixed `1827187`) → tanpa `.vercel/project.json` di runner baru → flag `--project-id` tidak ada di Vercel CLI 47 (`9a3565c`)
- Fix `361d10e`: tulis `.vercel/project.json` langsung; masih gagal → Fix `8f7a8e2`: hardcode ID sebenarnya (non-secret, dari `.vercel/repo.json`: `team_7caBsxNQrtdtkzQGbPBAFYKe` / `prj_joLciwdA37o6er3DKRSkiWlOhgJs`); masih gagal → probe API (`f429bdf`): `GET /v9/projects/{id}?teamId={org}` **HTTP 200** → token valid, ID benar
- Fix `fed6a84` (`--scope`): CLI tanpa scope resolve project ke default team token (project 404); dengan scope muncul `User not found (404)` di `/v2/user` → **diagnosis final: `VERCEL_TOKEN` adalah Team Access Token; CLI 47 `pull` butuh personal/user token**
- **USER ACTION**: ganti secret `VERCEL_TOKEN` (GitHub Environment `development`) dengan personal access token yang punya akses ke team `7caBsxNQrtdtkzQGbPBAFYKe`, lalu `workflow_dispatch` deploy-development. Semua fix workflow lain sudah di tempat.
- Run `8f7a8e2`: migrate gagal FLAKY di hosted tests → rerun sukses; hosted 126/126 lulus lokal. Bila flake berulang di CI, pertimbangkan retry step atau periksa interferensi recovery cron.

### Remediasi F1–F8 (commits 56dc4a8..cdc80bd)
- **F1**: `ProviderSelector` kini membaca `selection_strategy` per-config — grup kontigu by priority; `round_robin` memutar grup per-seed (OpenRouter free 200–230 akhirnya berperilaku sesuai niat migration), weighted draw dalam grup, failover order tetap. 15 unit tests (5 baru)
- **F2**: `ProviderConfigInput.selectionStrategy` → `ProviderSelectionStrategy` (type drift ditutup)
- **F3**: `/enhance-prompt` kini rate-limited — `JobRepository.countRecentEnhanceOnlyJobs` (filter `payload->>telegram_user_id`, budget sama 5/10m, tanpa migration)
- **F4**: clamp default timeout adapter ke 55s: pixazo flux/sdxl 120s, pollinations_image 120s, reasoning (openai_compatible/pollinations/bynara) 60s — semuanya ≥ `maxDuration 60s` sebelumnya. PixelForge adapter ternyata sudah dihapus 22 Ags (scope menyesuaikan)
- **F6**: env opsional `PROVIDER_APP_URL`/`PROVIDER_APP_NAME` + helper `providers/app-identity.ts`; 3 adapter tidak lagi hardcode `albot-ten.vercel.app`; default legacy dipertahankan (rekomendasi: set ke `albot-be.alamaby.com` di Vercel)
- **F7**: cast `as unknown as` di `handle-telegram-update.ts:234` dihapus — ternyata tidak pernah diperlukan; typecheck hijau
- **F5/F8**: trade-off self-dispatch + selector semantics didokumentasikan di `docs/architecture.md`; README status diperbarui; dir kosong `$COMMANDCODE_SCRATCHPAD/` & `-p/` dihapus; `seed.sql` terverifikasi by-design

### Verification
Gate lokal hijau penuh: format:check, lint (0 error; 2 warning pre-existing di `scripts/e2e-m6-fault-injection.mjs`), typecheck, **unit 297/297**, build, db:lint, db:check-migrations 39, db:types:check, **hosted 126/126** (lokal).

## Decisions
- Selector: strategy dari DB row (source of truth), bukan caller — konsisten dengan filosofi key selection yang sudah ada
- F3 tanpa migration: hitung dari tabel `jobs` (submisi akurat), bukan `provider_requests` (eksekusi)
- Prod TIDAK disentuh: deploy prod tetap via Vercel Git integration; migration prod = keputusan user (workflow manual)
- Workflow-only fix di-push duluan untuk feedback cepat (validate HEAD lama hijau, tanpa migration)

## Open Items / Blockers
- **USER ACTION 1 — deploy-development (satu-satunya tersisa)**: ganti `VERCEL_TOKEN` (Team Access Token → personal access token, akses team `7caBsxNQrtdtkzQGbPBAFYKe`) di GitHub Environment `development`; workflow sudah siap (project.json + `--scope` + probe diagnosa)
- ~~USER ACTION 2 — prod recovery 500~~ **CLOSED 2026-08-31 01:00 UTC**: user menjalankan `migrate-production` (run `33345671587`, sukses di `0a83769`, prod 26→39 migrations); cron `recovery-production` run `33346233290` → success pada percobaan pertama setelahnya
- **USER ACTION 3 (opsional)**: set `PROVIDER_APP_URL=https://albot-be.alamaby.com` di Vercel (dev+prod) untuk atribusi OpenRouter yang benar
- Hosted tests flaky di runner (1× dari 4 run hari ini) — rerun menyelesaikan; pantau bila berulang

## Commit Proposal
`fix(selector): derive config order from per-config selection_strategy`
