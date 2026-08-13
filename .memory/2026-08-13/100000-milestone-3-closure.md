# Milestone 3 — Closure (Platform Wiring + E2E)

Date: 2026-08-13

## Summary

Milestone 3 (Telegram Intake and Durable Jobs) **CLOSED**. Implementation selesai
(`21ac62e`), PR #1 cleanup committed (`db11ed1`, `bfd558f`, `540c430`), lalu platform
wiring + E2E selesai 2026-08-13.

## Platform Wiring

- **Vercel Preview env vars** diset: `APP_ENV=development`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`, `SUPABASE_URL` dev
  (`ceqcitzbosqzxpbtlpfn`), `SUPABASE_SERVICE_ROLE_KEY` dev,
  `PROVIDER_KEY_ENCRYPTION_KEY` dev.
- **`PROVIDER_KEY_ENCRYPTION_KEY` terlewat di M2** — tidak pernah dibuat untuk GitHub
  Environment dev. Dibuat baru (base64 32-byte, AES-256-GCM) saat wiring M3; aman karena
  DB dev belum punya data terenkripsi. Perlu dicatat bahwa M2 belum pernah benar-benar
  menggunakan key ini di dev.
- **Deployment Protection (Vercel)** adalah penyebab webhook 401 "Protected deployment" —
  dimatikan untuk Preview. Production tetap terlindungi (sampai M7).
- **Bot token ekspos di chat** → di-revoke & diganti via BotFather, env di-update.
- **Webhook terpasang**: `https://albot-6vpa38l30-alam-aby-bashits-projects.vercel.app/api/telegram/webhook`,
  allowed_updates `message,callback_query`.
- **Seed admin**: migration `20260813100000_seed_allowlist_admin.sql`
  (`83540732`/`alamaby`, is_allowed+is_admin) — applied ke dev via `migrate-development.yml`.

## E2E Evidence

- Prompt "desain poster kafe cozy di malam hari" → balasan "Prompt diterima. Sedang dalam antrian...".
- DB dev: `prompt_sessions` status `received`, `prompt_revisions` `pending`,
  `jobs` `enhance_prompt` `queued`, `telegram_updates` update_id unik berurutan (668535295-298).
- Active-session guard menolak prompt kedua ("Masih ada sesi aktif...") — sesuai matrix.
- Job tetap `queued` (processor no-op M3; reschedule `retry_scheduled` untuk session `/start`).

## Workflow

- `migrate-development.yml` run 31670269521: awalnya gagal di hosted tests karena
  `EXPECTED_MIGRATIONS` di `tests/integration/schema.integration.test.ts` belum include
  seed → fixed `540c430` → rerun hijau (9/9 migrations, hosted 79/79).
- Production: 0 migrations, untouched.

## Verification

- lint, typecheck, 222 unit tests, format:check, build — green.
- hosted 79/79 (12 files) — green.
- db:lint, db:check-migrations (9), db:types:check — green.
