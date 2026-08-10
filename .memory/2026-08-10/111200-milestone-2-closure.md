# Milestone 2 Closure

Created: 2026-08-10 11:12:00

## Task / Problem

Menutup M2 sepenuhnya: transcribe sisa M/L findings dari review commit `209847d` yang tidak terekam di repo (hanya ada di sesi review), resolve yang material, explicit-accept residual, finalisasi acceptance criteria M2, dan capture evidence final sebelum handoff ke M3.

## Key Decisions

- Transkripsi M/L dilakukan via inspeksi kode aktual post-`35a9cab` + diff `209847d..35a9cab` (detail review session tidak tersedia di repo).
- **M1 fixed**: `selectKey` hanya menghormati key weight untuk `weighted_round_robin`, padahal DB `selection_strategy` hanya mengizinkan `priority_failover|weighted` → key weight diabaikan untuk config `weighted`. `selectKey` sekarang men-draw key berdasarkan weight untuk `weighted` maupun `weighted_round_robin` (cumulative prefix); test determinisme baru ditambahkan.
- **M4 fixed**: `ProviderConfigSafe.selectionStrategy` di-narrow dari `ProviderStrategy` (union lebar) ke `ProviderSelectionStrategy` (sesuai DB constraint). Typecheck bersih.
- **M5 fixed**: `makeErrorFromHttpStatus` menandai semua 5xx retryable; taksonomi terdokumentasi hanya 408/429/500/502/503/504. Set retryable eksplisit; test 501/505 non-retryable.
- **M6 fixed**: `rotateKey` menyisakan orphan active key bila verifikasi vault melempar exception. Verifikasi dibungkus try/catch + rollback delete + error rethrow.
- **C-Low A fixed**: duplicated safe-projection column string di `provider-key.repository.ts` di-extract ke `SAFE_KEY_COLUMNS`.
- **M7/M8/M10/M13-M16 + L2-L14 accepted**: tidak dapat ditranscribe dari repo; verifikasi kode post-`35a9cab` tidak menemukan isu material tersisa; risiko residual terdocumented di plan remediation.
- Acceptance criteria M2 plan utama semua di-centang dengan evidence. Tidak ada perubahan schema pada closure; evidence run `31311782574` tetap valid.

## Key Files

- `plans/2026-08-10-milestone-2-closure-plan.md` — closure plan (baru).
- `plans/2026-08-09-milestone-2-review-remediation-plan.md` — M/L ditranscribe + risks + Progress Log.
- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md` — acceptance criteria di-centang + Progress Log.
- `src/server/providers/selector.ts`, `errors.ts`, `src/server/repositories/provider-config.repository.ts`, `provider-key.repository.ts`.
- `tests/unit/provider-selector.test.ts`, `tests/unit/provider-errors.test.ts`.
- `TODO.md`, `.memory/README.md`.

## Open Items / Blockers

- Commit + push closure M2; jalankan validate CI.
- M7/M8/M10/M13-M16 + L2-L14 accepted dengan risiko residual (detail review tidak tersedia di repo).

## Verification

- `npm test` — 143 pass (17 files), +1 test determinisme key weight.
- `npm run test:hosted` (REQUIRE_HOSTED_TESTS=true) — 67 pass, 0 skip.
- `npm run lint`, `typecheck`, `format:check`, `build`, `db:lint`, `db:check-migrations` (7), `db:types:check` — lulus.

## Conventional Commit Proposal

`fix(provider): close milestone 2 medium/low findings and record acceptance`

## Related

- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`
- `plans/2026-08-09-milestone-2-review-remediation-plan.md`
- `plans/2026-08-10-milestone-2-closure-plan.md`
