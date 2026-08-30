# Repo Analysis Remediation — CI Thread Closure, Doc Backfill, Findings F1–F8

Created: 2026-08-30 20:32:27

## Objective

1. Menutup thread CI hardening 30 Ags (7 commit `fix(ci)`; `deploy-development` gagal 21× berturut-turut sejak workflow dibuat 29 Ags).
2. Backfill dokumentasi: `.memory/` dan `TODO.md` stale sejak 26 Ags padahal ada kerja 27–30 Ags (Bynara, OpenRouter free models, prompt_audit, CI auto-pipeline).
3. Remediasi 8 temuan analisa repo (F1–F8).

## Scope

- `.github/workflows/deploy-development.yml` (fix link Vercel)
- `src/server/providers/selector.ts`, `application/generate-image.ts`, `application/enhance-prompt.ts` (F1)
- `src/server/repositories/provider-config.repository.ts` (F2)
- Rate limit `/enhance-prompt` (F3, tanpa migration bila memungkinkan)
- `src/server/providers/image/pixazo-pixelforge.adapter.ts` (F4)
- `src/server/providers/reasoning/openai-compatible.adapter.ts`, `src/env.ts`, `.env.example`, `docs/environment-variables.md` (F6)
- `src/server/application/handle-telegram-update.ts` (F7)
- `docs/architecture.md` (F5), README.md + hygiene (F8)
- `.memory/` backfill + `TODO.md`

## Milestones

1. Phase 1 — Verifikasi & tutup thread CI
2. Phase 2 — Backfill dokumentasi (plan, .memory, TODO)
3. Phase 3 — Remediasi temuan F1–F8
4. Phase 4 — Verifikasi penuh, commit/push, penutup memory

## Tasks

### Phase 1 — Thread CI

- [x] `gh run list`: `deploy-development` FAILURE di HEAD `9a3565c` (validate & migrate hijau); 21× gagal sejak 29 Ags — belum pernah sukses
- [x] RCA berlapis: (a) run pertama gagal karena secrets kosong tanpa `environment: development` (fixed 1827187); (b) tanpa `.vercel/project.json`, `vercel pull` gagal "Could not retrieve Project Settings"; (c) re-link `9a3565c` pakai flag `--project-id` yang tidak ada di Vercel CLI 47 (`vercel link --help`: hanya `--project <NAME>`)
- [x] Fix: tulis `.vercel/project.json` langsung dari secrets `VERCEL_PROJECT_ID`/`VERCEL_ORG_ID` (versi-independen) — commit `361d10e`, menunggu bukti hijau
- [x] Temuan tambahan: cron `recovery-production` gagal 6× berturut-turut sejak 29 Ags 18:00 UTC — prod balas HTTP 500 `{"ok":false,"reason":"internal"}`; health endpoint prod `status:ok` (DB reachable)
- [x] Hipotesis insiden prod (belum diverifikasi langsung ke DB prod): Vercel Git integration auto-deploy main → prod, sehingga kode prod (sejak `eff14bf` prompt_audit, 16:13 UTC) memanggil RPC `purge_prompt_audit` yang belum ada di DB prod (terakhir tercat 26 migrations). Korelasi waktu: sukses terakhir 14:40 UTC, gagal pertama 18:00 UTC, push prompt_audit 16:13 UTC
- [ ] **Keputusan user diperlukan**: jalankan workflow `migrate-production` (manual, attestation-gated, input `confirm_project_ref` + `development_run_id`) untuk menerapkan migration 27–39 ke prod; tanpa itu recovery sweep prod tetap 500

### Phase 2 — Backfill dokumentasi

- [x] Buat plan file ini
- [x] Entri `.memory/2026-08-27/` — content-policy refusal fix + review follow-up; regenerate-after-failure
- [x] Entri `.memory/2026-08-28/` — Bynara providers + model picker, clamp timeout, migrasi env `SUPABASE_SECRET_KEY`, script upsert-provider-key/prod seed, grok+sdxl keluar picker
- [x] Entri `.memory/2026-08-29/` dan `2026-08-30/` — OpenRouter free + round_robin, prompt_audit + admin/prompts + instruction_kind, CI auto pipeline + hardening, insiden recovery-production
- [x] Update `.memory/README.md` — current state, active decisions, open items, recent entries, timestamp
- [x] Update `TODO.md` — Completed 27–30 Ags; In Progress = remediasi ini

### Phase 3 — Remediasi temuan

- [x] **F1 — `round_robin` level config tidak efektif**: selector membaca `selection_strategy` per-config (grup kontigu by priority; round_robin memutar antar config dalam grup via seeded rotation; weighted draw dalam grup; failover semantics tetap) — `selector.ts` + 2 call sites; 15 unit tests (5 baru: grup failover di depan, fail-through ke tail rr, weighted fallback dalam grup, non-contiguous groups)
- [x] **F2 — Type drift**: `ProviderConfigInput.selectionStrategy` kini `ProviderSelectionStrategy` (termasuk `round_robin`)
- [x] **F3 — Rate limit `/enhance-prompt`**: `JobRepository.countRecentEnhanceOnlyJobs` (filter `payload->>telegram_user_id`, window sama ACCESS_CONTROLS 5/10m) + guard di `handleEnhanceOnlyCommand` + test rate-limit — tanpa migration
- [x] **F4 — Timeout adapter**: clamp default efektif ke 55s — pixazo flux/sdxl (120s→55s), pollinations_image (120s→55s), reasoning openai_compatible/pollinations/bynara (60s→55s) di `providers/index.ts`; konsisten dengan konvensi Bynara 55s (28 Ags). Catatan: adapter PixelForge sudah dihapus 22 Ags, scope menyesuaikan
- [x] **F6 — Hardcoded identity**: env opsional `PROVIDER_APP_URL`/`PROVIDER_APP_NAME` (zod, default nilai legacy) + helper `providers/app-identity.ts` + 3 adapter (openai-compatible, bynara, pollinations) + `.env.example` + `docs/environment-variables.md`
- [x] **F7 — Type hole**: cast `as unknown as` dihapus — ternyata tidak diperlukan sama sekali; `CallbackAction` import unused ikut dibersihkan; typecheck hijau tanpa cast
- [x] **F5 — Self-dispatch coupling**: trade-off didokumentasikan di `docs/architecture.md` §4 (4 poin trade-off + alasan tolak alternatif); §3.3 selector semantics di-update
- [x] **F8 — Hygiene**: `$COMMANDCODE_SCRATCHPAD/` dan `-p/` dihapus (terverifikasi kosong); README status "M7 closure pending" → post-M7 iterasi, angka migration hard-coded diganti pointer; `seed.sql` terverifikasi by-design (dijelaskan `supabase/seed/README.md`)

### Phase 4 — Verifikasi & penutup

- [x] Gate lokal: `format:check` ✓ (4 file di-prettier), `lint` ✓ (0 error; 2 warning pre-existing di `scripts/e2e-m6-fault-injection.mjs`), `typecheck` ✓, `test:unit` 297/297 ✓, `build` ✓, `db:lint` ✓, `db:check-migrations` 39 ✓, `db:types:check` ✓
- [x] Commit terpisah per topik — tanpa trailer `Co-authored-by:`
- [x] Push → `validate` ✓ + `migrate-development` ✓ (hosted 126/126) di HEAD `fed6a84`
- [x] Entri `.memory` penutup + checklist akhir plan
- [ ] **USER ACTION — satu-satunya blockir `deploy-development`**: secret `VERCEL_TOKEN` (GitHub Environment `development`) berisi **Team Access Token** — dibuktikan: probe API `GET /v9/projects/{id}?teamId={org}` → HTTP 200, tapi CLI `pull` gagal `/v2/user` → `User not found (404)` (team token tidak punya user context). Ganti dengan **personal access token** yang punya akses ke team `7caBsxNQrtdtkzQGbPBAFYKe` di Vercel dashboard, update secret, lalu `workflow_dispatch` deploy-development

## Risks

- **F1 mengubah perilaku seleksi provider** — grup OpenRouter free (priority 200–230) kini benar-benar dibagi beban saat failover sampai ke sana; dampak runtime kecil karena grup itu fallback terakhir. Mitigasi: contract tests + semantics strategy lama dipertahankan.
- **F3 tanpa migration kurang presisi** (audit row ≠ jumlah command persis); fallback migration kecil bila tidak akurat → wajib migration workflow.
- **Insiden prod**: recovery sweep prod tidak berjalan sampai migration 27–39 diterapkan; dampak fungsional terbatas (lease recovery, session expiry, purge tertunda) tapi menumpuk job stale.
- Workflow-only change dieksekusi lebih dulu (push `361d10e`) agar feedback pipeline cepat — validate pada HEAD lama sudah hijau sehingga aman.

## Progress Log

- 2026-08-30 20:32:27 — Plan dibuat. Phase 1 selesai: RCA CI (3 lapis), fix `361d10e` di-push, insiden `recovery-production` 500 terdokumentasi + korelasi waktu.
- 2026-08-30 20:55 — Phase 2 selesai (5 entri memory + README + TODO). Phase 3 F1–F3 selesai; selector test 15/15, webhook test 42/42.
- 2026-08-30 21:10 — F4–F8 selesai. Gate lokal hijau penuh (297 unit). Temuan tambahan: cast F7 tidak diperlukan; PixelForge adapter sudah dihapus (F4 scope menyesuaikan ke pixazo/pollinations/reasoning defaults).
- 2026-08-30 21:12 — Iterasi CI lanjutan: run `361d10e` masih gagal di `vercel pull` ("Could not retrieve Project Settings") — nilai secrets `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` dicurigai tidak cocok. Fix `8f7a8e2`: hardcode ID sebenarnya (non-secret, dari `.vercel/repo.json` lokal).
- 2026-08-30 21:30 — Run `8f7a8e2`: migrate gagal FLAKY di hosted tests → **rerun sukses**; hosted 126/126 lulus lokal. Commit kode remediasi `56dc4a8..426f745` di-push; migrate hijau di `426f745`.
- 2026-08-30 21:45 — Deploy tetap gagal; tambah probe API (`f429bdf`): **HTTP 200** → token valid & ID benar. Fix scope (`fed6a84`): CLI tanpa `--scope` resolve ke default team token → project 404; dengan `--scope` muncul `User not found (404)` pada `/v2/user` → **kesimpulan: `VERCEL_TOKEN` adalah Team Access Token; CLI pull butuh user token**. Blockir terakhir = user action di Vercel dashboard.
- 2026-08-30 21:50 — STATUS AKHIR: semua pekerjaan agent selesai. validate ✓, migrate ✓ (hosted 126/126), deploy-development menunggu user ganti token. Prod migration 27–39 juga menunggu keputusan user (`migrate-production`).

## Notes

- Keputusan desain F1: `selection_strategy` adalah properti per-config di DB; selector membaca strategy dari grup kontigu berdasar priority sehingga seed OpenRouter (`round_robin`, priority 200–230) berperilaku sesuai komentar migration ("sessions distribute across the 4 free models") tanpa mengubah call sites menjadi strategy-aware penuh.
- Bukti prod auto-deploy dari main: E2E prod 27 Ags (content-policy fix, regenerate fix) sukses tanpa deploy prod manual terdokumentasi — satu-satunya jalur adalah Vercel Git integration. Implikasi: push main = deploy prod; migration prod harus selalu mendahului push fitur berschema.
- Open items tooling (user action): restart opencode + verifikasi MCP Supabase prod; restart opencode + smoke test Naraya GLM 5.3 Flash.
