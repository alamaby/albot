# Bynara Providers, Vercel Timeout Clamp, SUPABASE_SECRET_KEY Migration

Date: 2026-08-28 (backfill 2026-08-30)

## Task / Problem
Menambah provider Bynara (reasoning + image) dan menyelesaikan rantai masalah produksi: Vercel `maxDuration 60s` vs timeout adapter, format respons `b64_json`, dan rotasi naming env Supabase.

## Key Files Changed
- `src/server/providers/index.ts`, `src/server/providers/image/bynara*.adapter.ts` — BynaraImageAdapter mendukung `b64_json` + relative URL; adapter_types `bynara_image`, `bynara_a20f/a21f/grok/nbn`
- `src/server/telegram/keyboards.ts` — model picker expose Bynara (`a20f`/`a21f`/`grok`/`nbn`), lalu **grok & sdxl dihapus dari picker** (`6e5521f`)
- Timeout clamp untuk Vercel 60s: Bynara 50s→40s (`1eb7b24`, `8dfc2ee`), grok/nano 55s (`7ec10ea`); clamp size grok/nano ke 1024x1024 (`555af04`)
- `src/env.ts` + semua pemakaian — migrasi `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (prefix `sb_secret_`, `e54550f`)
- `scripts/upsert-provider-key.mjs` (key baru untuk config existing, hapus lama) + `scripts/seed-prod-bynara.mjs` (wrapper 6×, hard-pin prod ref) + aturan anti-exfiltration di AGENTS.md
- Diag sementara `/api/diag-env`, `/api/test-bynara` ditambah lalu dihapus

## Decisions
- Migration seed prod configs (27/28) idempotent `WHERE NOT EXISTS`; API key TIDAK pernah di migration — selalu via script terenkripsi
- Timeout adapter harus < 55s untuk aman di bawah Vercel 60s (pola yang juga berlaku Pixazo — lihat F4 di plan remediasi)

## Verification
E2E prod Bynara image OK; unit/lint/typecheck/build hijau per commit.

## Risks / Notes
- `.env` lokal + Vercel env + GitHub secrets wajib sinkron untuk rename `SUPABASE_SECRET_KEY`
- Commit range `32e4db9..c4accfd` (27–28 Ags); migration `20260827100000`, `20260828100000`, `20260828120000` (auto-expire stale sessions di `create_initial_session` — fix race one-active-index)

## Commit Proposal
`feat(providers): add Bynara reasoning and image generation providers`
