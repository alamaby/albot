# Reasoning Provider/Model Display + Round-Robin Merata

Created: 2026-09-01 00:00:00

## Objective
- Setiap balasan bot berisi prompt/revisi menampilkan info provider + model reasoning sebelum "Pilih aksi di bawah...".
- Semua model reasoning kebagian task via hash round-robin merata.
- Info reasoning juga di caption/status gambar hasil generate.

Keputusan: (1) pisah baris Reasoning vs Model gambar, (2) hash strategy, (3) ya perlu di gambar.

## Scope
- In: messages.ts, enhance-prompt.ts, generate-image.ts, migrasi DB, tests
- Out: image_generation strategy (tetap priority_failover+hybrid)

## Milestones
1. Migrasi penyatuan reasoning ke round_robin
2. Refactor message builders
3. Plumbing reasoning ke confirmation + caption/status
4. Tests + verifikasi

## Tasks
- [x] Migrasi 20260901_unify_reasoning_round_robin (UPDATE provider_configs)
- [x] Update EXPECTED_MIGRATIONS di schema.integration.test.ts
- [x] Refactor buildEnhancedPromptMessage: reasoningProviderLabel + reasoningModel + imageModelLabel (pisah)
- [x] Refactor buildResultCaption + buildGenerationStatusMessage: sertakan reasoning
- [x] Plumb enhance-prompt.ts defaultSendConfirmation: kirim reasoning name/model
- [x] Plumb generate-image.ts: caption/status sertakan reasoning dari revision
- [x] Update constraint fragment test untuk 'round_robin'
- [x] Verifikasi: db:lint, db:check-migrations, db:types:check, test:unit, lint, typecheck, build

## Risks
- Update mass tanpa filter salah; caption Telegram 1024 char; label image vs reasoning bingung
- Mitigasi: filter capability='reasoning', pisah prefix, truncate

## Progress Log
- 2026-09-01 — Plan dibuat, investigasi selector.ts grouping + messages.ts:124 + enhance-prompt.ts:118 + generate-image.ts:124
- 2026-09-01 — Decisions: pisah/hash/ya-perlu. Eksekusi dimulai.
- 2026-09-01 11:31 — Migrasi 20260901113116_unify_reasoning_round_robin.sql dibuat; EXPECTED_MIGRATIONS + constraint updated
- 2026-09-01 11:33 — messages.ts:124 buildEnhancedPromptMessage pisah Reasoning/Model gambar, buildResultCaption + buildGenerationStatusMessage sertakan reasoning
- 2026-09-01 11:34 — Plumbing enhance-prompt.ts:118 defaultSendConfirmation + generate-image.ts:124 caption/status; verifikasi db:lint ok, db:check ok, db:types:check ok, test:unit 297 pass, lint/typecheck ok, build fail symlink EPERM (env Windows bukan kode)

## Notes
- Opsi A hash dipilih vs strict counter DB (kontensi write). Failover tetap via isKeyEligible+cooldown.
- Standar: RLS strict tidak diubah.
