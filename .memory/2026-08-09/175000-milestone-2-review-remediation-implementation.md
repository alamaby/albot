# Milestone 2 Review Remediation Implementation

Created: 2026-08-09 17:50:00

## Task / Problem

Implementasi remediation 50 findings review M2 (commit `209847d`): 8 Critical, 11 High, 16 Medium, 15 Low.

## What Was Done

- **Phase 1 (C1-C8) + Phase 2 (H1-H11) selesai.** Ringkasan:
  - C1: `makeErrorFromHttpStatus` di `errors.ts` — retryable diturunkan dari status (408/429/5xx), dipakai kedua adapters.
  - C2: discriminator `responseKind: "flux" | "sdxl"` di `PixazoConfig` (bukan `model.includes`); model `"stable-diffusion-xl-base-1.0"` tetap terparse SDXL.
  - C3: `parseEncryptionKey` strict base64 (regex + length mod + round-trip) + pesan error spesifik.
  - C4: forward-fix migration `20260809171800_add_increment_provider_key_failure.sql` → RPC `increment_provider_key_failure` (increment atomic + cooldown `2^(count-threshold)` menit cap 60, service_role-only). Diterapkan ke dev (7 migrations, Local==Remote). **Deviasi:** failure_count tidak di-reset saat threshold (eskalasi backoff); reset oleh markSuccess.
  - C5: weighted selection cumulative-prefix di selector + opsi `seed` deterministik.
  - C6: `PROVIDER_KEY_ENCRYPTION_KEY` wajib + zod refine di `src/env.ts`; env/health tests + `.env.example` + docs di-update.
  - C7: registry `createProviderForConfig` enforce capability → `ProviderError provider_capability_mismatch`; unknown type → `provider_adapter_unknown` (H1).
  - C8: `provider-repository.contract.test.ts` sekarang real hosted (safe projection, vault decrypt, RPC increment+cooldown, rotation CAS, anon denial) — 5 tests.
  - H2: clearTimeout di `finally`; H3: `vi.stubGlobal` + `vi.unstubAllGlobals`; H4: `ProviderKeyVaultRepository` decrypt-only; H5: rotate CAS; H6: HTTPS-only constructors; H7: providerRequestId dari headers; H8: factory baca base_url/model dari config row; H9: envelope version dispatch; H10: zod config schema (`providers/config.ts`); H11: strict encryption test messages.
- **M/L tambahan:** M2 (SAFE_COLUMNS const), M3 (null defensives), M9 (toMatchObject codes), M11 (cdn.example.invalid), M12 (narrow strategy/capability unions di `domain/provider.ts`), L1 (hapus randomUUID), L15 (update plan M2 structure). Ekstra: unit test `provider-config.test.ts`, mock adapter unused import, docs env.
- **Verifikasi:** 142 tests pass (17 files); `test:hosted` REQUIRE_HOSTED_TESTS=true 67 pass 0 skip; lint/typecheck/format:check/build/db:lint/db:check-migrations/db:types:check bersih.

## Key Files

- `plans/2026-08-09-milestone-2-review-remediation-plan.md` — task checklist (C/H ✓; sisa M/L belum di-transcribe menunggu daftar review session).
- Migration: `supabase/migrations/20260809171800_add_increment_provider_key_failure.sql`; `src/server/supabase/database.types.ts` di-regenerate.
- `src/server/providers/{errors,registry,selector,index,config}.ts`, `reasoning/openai-compatible.adapter.ts`, `image/pixazo.adapter.ts`, `mock/*`.
- `src/server/security/encryption.ts`, `src/env.ts`.
- `src/server/repositories/provider-key.repository.ts`, `provider-key-vault.repository.ts`, `provider-config.repository.ts`.

## Open Items / Blockers

- Commit + push + jalankan `migrate-development.yml` + capture evidence — belum (menunggu instruksi user; aturan: commit hanya atas permintaan eksplisit).
- Sisa M/L findings (M1/M4-M8/M10/M13-M16, L2-L14) belum bisa di-transcribe — detail review hanya ada di sesi chat sebelumnya.

## Verification

- 142/142 tests, hosted 67/67 (0 skip), lint/typecheck/format/build/db checks semua lulus.

## Conventional Commit Proposal

`fix(provider): close milestone 2 review findings (critical and high)`

## Related

- `plans/2026-08-09-milestone-2-review-remediation-plan.md`
- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`
