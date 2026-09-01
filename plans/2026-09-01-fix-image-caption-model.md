# Fix Image Caption — Tampilkan Model Image di Hasil Generate

Created: 2026-09-01

## Objective
Caption `sendPhoto` dan status `succeeded` hasil generate tampilkan model image yang benar-benar dipakai (ringkas `Model: <label>`, fallback ke `cfg.name/model` jika mapping code tidak ada), di samping `Reasoning:` yang sudah ada. Format ringkas, konsisten dengan `Reasoning:`.

## Scope
- In: `src/server/telegram/messages.ts` (`buildResultCaption`, `buildGenerationStatusMessage`), `src/server/application/generate-image.ts` plumbing, `src/server/telegram/keyboards.ts` mapping fallback
- Out: migrasi DB (tidak ada perubahan schema)

## Milestones
1. Extend builder signature
2. Plumb image provider label
3. Verifikasi + deploy dev/prod

## Tasks
- [x] `messages.ts:173` tambah `imageModelLabel?: string | null` ke `buildResultCaption` — append `Model: ${label}` setelah reasoning
- [x] `messages.ts:192` tambah `imageModelLabel` ke `buildGenerationStatusMessage` (`succeeded` + `succeeded_generic` jika ada)
- [x] `generate-image.ts:124` `defaultSendPhoto`: resolve image label via `ADAPTER_TO_MODEL_CODE→MODEL_CODE_LABEL` dengan fallback `cfg.model || cfg.name`; pass ke `buildResultCaption`
- [x] `generate-image.ts:371` status edit `succeeded`: sertakan `imageModelLabel` juga
- [x] Kirim `imageModelLabel` via `sendPhoto` arg atau re-resolve dari `attempt.image_provider_config_id` untuk keandalan
- [x] Unit test `messages.test.ts` varian ringkas + fallback
- [x] Verifikasi `test:unit`, `lint`, `typecheck`, `format:check`
- [ ] Deploy `vercel --yes` + alias `albot-dev.vercel.app` dan `vercel --prod`

## Risks
- Caption 1024 char — label ringkas aman, truncate jika perlu
- Keyboard sudah tampilkan model, caption duplikat tapi diperlukan untuk riwayat chat

## Progress Log
- 2026-09-01 — Plan dibuat setelah laporan user: migrate-production+deploy sudah tapi caption image kosong
- 2026-09-01 — Decisions: ringkas (`Model: …`) + fallback (`cfg.model/name`)

## Notes
- TOGAF proporsional, tidak ubah RLS/migrasi. Format ringkas dipilih atas verbose `Model gambar:`.
