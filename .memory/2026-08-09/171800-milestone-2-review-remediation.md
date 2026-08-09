# Milestone 2 Review Remediation

Created: 2026-08-09 17:18:00

## Task / Problem

Review read-only M2 (commit `209847d`) menemukan 50 findings (8 Critical, 11 High, 16 Medium, 15 Low). Remediation plan disetujui; implementasi dimulai.

## Key Decisions

- Satu-satunya schema change: forward-fix migration `increment_provider_key_failure` untuk C4 (atomic failure increment + cooldown exponential backoff), additive + non-destructive, dieksekusi hanya ke development.
- C2 diselesaikan dengan discriminator eksplisit `responseKind: "flux" | "sdxl"` di `PixazoConfig` (bukan parsing string model) — partial fix yang sudah ada di working tree (model `"sdxl"` di registry) dipertahankan sebagai fallback.
- C1 via helper `makeErrorFromHttpStatus(status, ...)` di `errors.ts` yang menurunkan `retryable` dari status (retryable = 408/429/5xx).
- H4 memisahkan `getDecryptableKey` ke `ProviderKeyVaultRepository` (decrypt-only), `ProviderKeyRepository` tetap safe-projection.
- Detail C1-C8/H1-H11 dirinci penuh di plan; item M/L sebagian besar perlu diverifikasi ulang dari kode saat implementasi karena detail review hanya ada di sesi chat.
- Working tree sudah berisi partial fix C1 (pixazo) + C2 (model `"sdxl"`) yang belum di-commit — dipertahankan dan diselesaikan.

## Key Files

- `plans/2026-08-09-milestone-2-review-remediation-plan.md` — plan + task checklist (single source of truth).
- `src/server/providers/errors.ts`, `openai-compatible.adapter.ts`, `pixazo.adapter.ts`, `registry.ts`, `selector.ts`, `index.ts`.
- `src/server/security/encryption.ts`, `src/env.ts`.
- `src/server/repositories/provider-key.repository.ts`, `provider-config.repository.ts`.
- `tests/unit/encryption.test.ts`, `tests/contract/provider-repository.contract.test.ts`, `tests/contract/pixazo-provider.contract.test.ts`, `tests/contract/openai-compatible-provider.contract.test.ts`.
- `supabase/migrations/<timestamp>_add_increment_provider_key_failure.sql` (baru, C4).

## Open Items / Blockers

- Item M/L yang belum ter-trancribe dari sesi review: diverifikasi dari kode saat implementasi.
- C8 butuh hosted env tersedia (ada di `.env` lokal, gitignored).

## Verification

- `npm test` (≥110), `npm run test:hosted` (0 skip), lint, typecheck, format:check, build, `db:lint`, `db:check-migrations`.
- Forward-fix migration C4 dieksekusi ke dev via CLI; regenerate `database.types.ts`.

## Conventional Commit Proposal

`fix(provider): close milestone 2 review findings (critical and high)`

## Related

- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`
- `plans/2026-08-09-milestone-2-review-remediation-plan.md`
