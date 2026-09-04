# Bynara Reasoning: Replace nemotron-3-ultra + Failure Messages with Provider Context

Created: 2026-09-04 09:00:00

## Objective

1. Workstream B: nonaktifkan `Bynara nemotron-3-ultra` (terbukti HTTP 400 — model sudah tidak tersedia di router) dan tambahkan 5 model reasoning Bynara pengganti yang selectable di picker + ikut rotasi round_robin.
2. Workstream A: semua pesan gagal yang melibatkan provider memuat provider + error code + HTTP status + safeMessage redacted.

## Scope

- Migration data `provider_configs`: INSERT 5 rows (adapter_type baru per model), UPDATE deactivate nemotron. Tanpa perubahan schema.
- `src/server/providers/index.ts`: registrasi 5 reasoning adapter baru (pola `bynara`).
- `src/server/telegram/keyboards.ts`: 5 short-code picker reasoning baru (8 -> 13).
- `scripts/seed-provider-config.mjs` + `scripts/seed-prod-bynara.mjs`: allowlist + rows provisioning.
- Workstream A: `messages.ts` builder opsi konteks, plumbing `selected.config` dari use case ke handler, adapter reasoning sertakan snippet body redacted.
- Tests: keyboards, registry, callback-state-machine, enhance-prompt-select, schema EXPECTED_MIGRATIONS.

## Milestones

1. RCA 400 nemotron tuntas (model tidak tersedia — konfirmasi user).
2. Migration + registrasi + picker + provisioning selesai.
3. Pesan gagal berkonteks + redaksi aman.
4. Verifikasi penuh hijau, push, migrate dev, seed, migrate prod.

## Tasks

- [x] RCA sesi terakhir prod (enhancement_failed, provider_request_invalid, HTTP 400, nemotron-3-ultra)
- [x] Migration `20260904090000` + EXPECTED_MIGRATIONS
- [x] Registrasi 5 adapter di `providers/index.ts`
- [x] Keyboards: 5 kode picker + label + mapping
- [x] Seed scripts update (allowlist + prod rows)
- [x] Workstream A: pesan gagal berkonteks semua jalur
- [x] Unit (346/346) + lint/typecheck/format/db checks hijau; hosted 141/142 (1 fail = migration belum di dev, expected pre-push)
- [x] Commit `f476fdd` + push; gitleaks fix `c886f4a` + push; `validate` SUCCESS; `migrate-production` SUCCESS (prod 162–166 aktif, nemotron off)
- [x] Seed keys prod 5 model baru (dev dilewati — lihat bawah)
- [x] Deploy prod manual `vercel --prod` oleh user (sukses, aliased albot-be.alamaby.com, health ok)
- [~] Fix secrets env development + VERCEL_TOKEN prod — DILEWATI per user 2026-09-04 (dev tetap tanpa 5 model baru sampai secrets diperbaiki di lain waktu)
- [ ] Uji 1 prompt per model di prod (user-driven via @albot_ai_bot), verifikasi `provider_requests.http_status` 200

## Risks

- Picker 8->13 entri: UX berat di layar kecil. Mitigasi: label ringkas.
- Satu API key untuk 6 config Bynara = single point of failure. Diterima user; Cloudflare/Pollinations/OpenRouter tetap failover.
- Model ID on-trust (user menyatakan eksak). Mitigasi: uji 1 prompt per model di dev sebelum prod.
- Semua reasoning round_robin satu grup: priority hanya urutan picker, bukan porsi traffic (hash(sessionId) % N).
- safeMessage upstream bisa menggemakan prompt user — mitigasi truncate + redactSensitive.

## Progress Log

- 2026-09-04 09:00:00 — plan dibuat; RCA read-only prod selesai; jawaban user dicatat (semua Bynara router, ID eksak, deactivate nemotron, 162-166 + key sama).
- 2026-09-04 09:10:00 — build mode aktif; eksekusi dimulai.
- 2026-09-04 11:05:00 — gitleaks fix c886f4a + push; validate SUCCESS; migrate-production SUCCESS (prod 162–166 aktif, nemotron off); migrate-development FAILURE pre-existing (secrets env development kosong); deploy-production FAILURE (blocker lama VERCEL_TOKEN kosong).
- 2026-09-04 11:20:00 — deploy prod manual `vercel --prod` oleh user: sukses (health ok). Seed 5 keys baru prod via upsert per-row: sukses (fingerprint sama). Pelajaran: `upsert-provider-key.mjs` tidak bisa rotasi key berhistori (DELETE diblokir FK `provider_requests_key_fkey`) — untuk incremental seeding, seed hanya config baru; laguna/image tidak perlu (key lama tetap valid).

## Notes

- Standar: ODA observability saja; tidak ada model C2M yang relevan.
- Hapus fisik nemotron diblokir FK (provider_keys, provider_requests, prompt_revisions) -> deactivate.
- Picker resolve per adapter_type ke prioritas tertinggi (callback-state-machine.ts:1392-1394), jadi satu adapter_type per model wajib agar selectable.
