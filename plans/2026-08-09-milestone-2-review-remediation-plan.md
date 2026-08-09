# Milestone 2 Review Remediation Plan

Created: 2026-08-09 17:18:00

## Objective

Menutup seluruh temuan review read-only M2 (8 Critical, 11 High, 16 Medium, 15 Low) terhadap commit `209847d` sebelum M2 dinyatakan accepted. Remediasi bersifat application-layer kecuali satu forward-fix migration untuk atomic failure increment (C4).

M2 remediation selesai hanya setelah:
- Seluruh Critical (C1–C8) ter-resolve dengan test yang membuktikan.
- Seluruh High (H1–H11) ter-resolve atau explicitly accepted.
- Medium/Low ter-resolve atau explicitly accepted dengan documented risk.
- `npm test`, `test:hosted` (0 skip), lint, typecheck, format:check, build semua lulus.
- Remediation di-commit dan migration workflow development sukses (jika ada migration baru).
- Production tetap tidak tersentuh.

## Scope

- Perbaikan retry/error classification pada adapters dan registry.
- Discriminator model Pixazo yang tidak bergantung pada string model.
- Strict base64 validation untuk `PROVIDER_KEY_ENCRYPTION_KEY`.
- Atomic failure increment + cooldown via forward-fix migration (satu-satunya schema change).
- Weighted selection yang benar-benar menghormati weight (cumulative prefix).
- `PROVIDER_KEY_ENCRYPTION_KEY` divalidasi di `src/env.ts`.
- Registry menolak capability/adapter mismatch dengan `ProviderError`.
- Real hosted contract tests untuk provider repository (C8).
- Pemecahan decrypt repository, rotate compare-and-set, HTTPS-only, providerRequestId, config dari DB row, envelope version dispatch, config Zod parser.
- Timer cleanup, test global restore, strict test assertions.

## Out Of Scope

- Telegram webhook/callback.
- Admin UI/API route.
- Production provider configuration.
- Production encryption key rotation.
- Perubahan schema selain forward-fix migration C4.
- M2 dinyatakan accepted / evidence final (setelah remediation di-commit dan workflow sukses).

## Milestones

1. Phase 1: Critical (C1–C8)
2. Phase 2: High (H1–H11)
3. Phase 3: Medium (M)
4. Phase 4: Low (L)
5. Verification + commit + workflow

## Tasks

### Phase 1 — Critical

- [x] C1 — Retry classification mengabaikan computed `retryable`. `openai-compatible.adapter.ts:57` menghitung `retryable` lalu memanggil `makeRetryable` tanpa syarat (4xx non-retryable jadi retryable). Diperbaiki dengan helper `makeErrorFromHttpStatus(status, ...)` di `errors.ts` yang menurunkan `retryable` dari status (retryable = 408/429/5xx). Diterapkan di kedua adapters; helper + test classification di `provider-errors.test.ts`.
- [x] C2 — Deteksi model SDXL via string. Diganti dengan discriminator eksplisit `responseKind: "flux" | "sdxl"` di `PixazoConfig`; `buildRequestBody`/`parseResponse` dispatch pada `responseKind`, bukan `model.includes`. Registry meneruskan `responseKind` per adapter; test membuktikan model `"stable-diffusion-xl-base-1.0"` tetap terparse sebagai SDXL.
- [x] C3 — `parseEncryptionKey` non-strict base64. Validasi strict: regex base64 + length `%4 != 1` + round-trip re-encode + error message spesifik (invalid base64 / wrong length / all-zero / empty). Test assert pesan spesifik.
- [x] C4 — `markFailure` reset `failure_count` ke 1 tanpa cooldown. Forward-fix migration `20260809171800_add_increment_provider_key_failure.sql` menambah RPC `increment_provider_key_failure(p_provider_config_id uuid, p_key_id uuid, p_threshold integer)` — increment atomic + cooldown exponential backoff (`2^(count-threshold)` menit, cap 60) + grants service_role-only. Repository `markFailure` memanggil RPC (default threshold 3). **Deviasi:** `failure_count` TIDAK di-reset ke 0 saat threshold (agar backoff eskalasi); reset hanya oleh `markSuccess`. Migration diterapkan ke dev (Local==Remote 7), types di-regenerate.
- [x] C5 — Weighted selection mengabaikan weight. Implementasi cumulative-prefix draw atas total weight (deterministic hash), untuk config `weighted` dan key `weighted_round_robin`. Tambah opsi `seed?: string` di `selectProvider` untuk distribusi per-request yang tetap deterministik; default seed stabil per config/key. Test weighted selection + determinisme.
- [x] C6 — `src/env.ts` tidak memvalidasi `PROVIDER_KEY_ENCRYPTION_KEY`. Ditambahkan zod `refine` yang memvalidasi via `parseEncryptionKey` (base64 strict 32 bytes); wajib ada. `.env.example`, `docs/environment-variables.md`, env/health tests di-update.
- [x] C7 — Registry tidak enforce capability mismatch. `createProviderForConfig` baru memeriksa `entry.capability === config.capability` → `ProviderError provider_capability_mismatch` sebelum HTTP. `createReasoningProvider`/`createImageProvider` juga memeriksa capability. `getCapability(adapterType)` baru. Test capability mismatch + `getCapability`.
- [x] C8 — `provider-repository.contract.test.ts` sebelumnya stub. Ditulis hosted contract tests nyata via `getAdminClient()`: insert config+key, safe projection tanpa ciphertext columns, vault decrypt round-trip, RPC increment+cooldown, invalid threshold/unknown key, rotation CAS deactivation, anon denial. 5 hosted tests pass.

### Phase 2 — High

- [x] H1 — Registry melempar plain `Error`. Diganti `ProviderError` code `provider_adapter_unknown` (unknown type) dan `provider_capability_mismatch`. Test assert code.
- [x] H2 — Timer leak. `try/catch/finally` dengan `clearTimeout` di `finally` pada kedua adapters.
- [x] H3 — Test memodifikasi `global.fetch` tanpa restore. Diganti `vi.stubGlobal("fetch", mockFetch)` + `vi.unstubAllGlobals()` di `afterEach` kedua contract test adapters.
- [x] H4 — Capability decrypt dipisahkan. `ProviderKeyVaultRepository` baru (`provider-key-vault.repository.ts`) decrypt-only; `ProviderKeyRepository` safe-projection only dan memakai vault untuk verifikasi rotation.
- [x] H5 — `rotateKey` tanpa compare-and-set. Deaktivasi old key sekarang CAS: `.update({ is_active: false }).eq("id", oldKey.id).eq("provider_config_id", ...).eq("is_active", true)`; no-op bila sudah nonaktif (concurrent rotation aman).
- [x] H6 — `baseUrl` arbitrary. Constructor kedua adapters menolak non-https dengan `ProviderError provider_configuration_invalid`; config Zod schema (H10) juga mewajibkan https.
- [x] H7 — OpenAI adapter tidak meng-capture `providerRequestId`. `readRequestId(response)` membaca `x-request-id`/`x-request-trace-id`; dipasang ke `metadata.providerRequestId` hasil sukses dan `ProviderError.providerRequestId` pada error. Pixazo juga meng-capture `request_id`/`id` dari body + header.
- [x] H8 — Registry hardcode `baseUrl`/`model`. Factory membaca `config["base_url"]`/`config["model"]` dari DB row dengan fallback ke default provider.
- [x] H9 — `decryptProviderKey` hardcode `version === 1`. Refactor jadi `switch (version)` dispatch; handler v1 terisolasi; unknown version → null. Test unknown version.
- [x] H10 — Tidak ada config Zod parser. `src/server/providers/config.ts` schema `providerConfigInputSchema` (capability enum, adapterType/name non-empty, baseUrl https, settings object, strategy enum, priority/weight ranges); `ProviderConfigRepository.insert` memvalidasi. Test unit baru `provider-config.test.ts`.
- [x] H11 — Encryption tests hanya `toThrow()`. Diperkuat assert pesan spesifik (invalid base64 / wrong length / all-zero / empty) + test unknown version.

### Phase 3 — Medium

- [ ] M1 — (detail dari review session; verifikasi saat implementasi)
- [x] M2 — Column list string digandakan 5x di `provider-config.repository.ts`. Pindahkan ke konstanta `SAFE_COLUMNS` (single source of truth).
- [x] M3 — Null defensives di `mapRow` config repository (model nullable → `?? ""`, settings null → `?? {}`).
- [ ] M4 — (detail dari review session; verifikasi saat implementasi)
- [ ] M5 — (detail dari review session; verifikasi saat implementasi)
- [ ] M6 — (detail dari review session; verifikasi saat implementasi)
- [ ] M7 — (detail dari review session; verifikasi saat implementasi)
- [ ] M8 — (detail dari review session; verifikasi saat implementasi)
- [x] M9 — Contract tests pakai bare `rejects.toThrow()`. Diperkuat dengan `toMatchObject({ code, retryable, httpStatus })` di kedua contract test adapters + error classification tests.
- [ ] M10 — (detail dari review session; verifikasi saat implementasi)
- [x] M11 — Fixtures CDN host realistis. Diganti `https://cdn.example.invalid/...` di contract test adapters.
- [x] M12 — Narrow strategy type: `ProviderSelectionStrategy`/`ProviderKeySelectionStrategy`/`ProviderStrategy` di `domain/provider.ts`; `ProviderConfigSafe.selectionStrategy` dan selector pakai union sempit. `capability` juga di-narrow ke `ProviderCapability`.
- [ ] M13 — (detail dari review session; verifikasi saat implementasi)
- [ ] M14 — (detail dari review session; verifikasi saat implementasi)
- [ ] M15 — (detail dari review session; verifikasi saat implementasi)
- [ ] M16 — (detail dari review session; verifikasi saat implementasi)

### Phase 4 — Low

- [x] L1 — Import `randomUUID` tidak terpakai di `provider-key.repository.ts`. Dihapus.
- [ ] L2 — (detail dari review session; verifikasi saat implementasi)
- [ ] L3 — (detail dari review session; verifikasi saat implementasi)
- [ ] L4 — (detail dari review session; verifikasi saat implementasi)
- [ ] L5 — (detail dari review session; verifikasi saat implementasi)
- [ ] L6 — (detail dari review session; verifikasi saat implementasi)
- [ ] L7 — (detail dari review session; verifikasi saat implementasi)
- [ ] L8 — (detail dari review session; verifikasi saat implementasi)
- [ ] L9 — (detail dari review session; verifikasi saat implementasi)
- [ ] L10 — (detail dari review session; verifikasi saat implementasi)
- [ ] L11 — (detail dari review session; verifikasi saat implementasi)
- [ ] L12 — (detail dari review session; verifikasi saat implementasi)
- [ ] L13 — (detail dari review session; verifikasi saat implementasi)
- [ ] L14 — (detail dari review session; verifikasi saat implementasi)
- [x] L15 — Plan M2 drift vs struktur aktual. `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md` di-update: contracts/ tidak ada (di `domain/provider.ts`), `fingerprint.ts` tergabung di `encryption.ts`, Pixazo satu adapter dengan `responseKind`, tambah `config.ts` + `provider-key-vault.repository.ts` + `index.ts`.

### Verifikasi

- [x] `npm test` — 142 pass (17 files) mencakup hosted dev.
- [x] `npm run test:hosted` dengan `REQUIRE_HOSTED_TESTS=true` — 67 pass, 0 skip.
- [x] `npm run lint` — 0 warnings/errors.
- [x] `npm run typecheck` — bersih (types di-regenerate dari dev).
- [x] `npm run format:check` — bersih.
- [x] `npm run build` — sukses.
- [x] `npm run db:lint`, `db:check-migrations` (7), `db:types:check` — lulus.
- [ ] Commit remediation + jalankan `migrate-development.yml` + capture evidence.

## Risks

- **Forward-fix migration (C4) menyentuh production?** Tidak — workflow migration development saja; production tetap 0 migration. Migration harus additive dan non-destructive.
- **C8 butuh hosted env di CI.** Hosted credentials ada di GitHub Environment development dan `.env` lokal; workflow development mensyaratkan `REQUIRE_HOSTED_TESTS=true` — tidak boleh ada skip.
- **Weighted selection determinisme antar serverless instance.** Hash harus stabil per (config/key id), bukan counter process-local; test memastikan determinisme.
- **Detail M/L dari review session tidak semuanya terekam di file ini.** Item M/L yang belum ter-trancribe akan diverifikasi dari kode saat implementasi; jika ada temuan tambahan yang teridentifikasi saat bekerja, tambahkan ke plan ini.
- **Encryption version dispatch (H9) tidak boleh memutus decrypt backward-compatible.** Handler version 1 harus mempertahankan perilaku AAD + fingerprint saat ini.

## Progress Log

- 2026-08-08 21:30:00 — Plan remediation dibuat setelah review read-only M2 (commit `209847d`). C1-C8 dan H1-H11 dirinci penuh; M/L tercantum nomor + yang sudah teridentifikasi, sisanya akan diverifikasi saat implementasi.
- 2026-08-09 17:18:00 — Implementasi remediation Phase 1-2 selesai (C1-C8 + H1-H11 + M2/M3/M9/M11/M12 + L1/L15 + items tambahan: provider-config test, capability narrowing, mock adapter unused import, env docs). Forward-fix migration C4 diterapkan ke dev (7 migrations), types di-regenerate. 142 tests pass, hosted 67 (0 skip, REQUIRE_HOSTED_TESTS=true), lint/typecheck/format/build/db checks bersih. Pending: commit remediation + jalankan `migrate-development.yml` + capture evidence; M/L yang belum ter-trancribe menunggu daftar review session.

## Notes

- Detail lengkap C1-C8/H1-H11 diambil dari sesi review M2 (read-only, 50 findings: 8 Critical, 11 High, 16 Medium, 15 Low).
- Satu-satunya schema change yang direncanakan: forward-fix migration `increment_provider_key_failure` (C4).
- **Deviasi C4:** `failure_count` TIDAK di-reset ke 0 saat threshold tercapai (berbeda dari draf awal) agar backoff eskalasi lintas siklus; reset hanya terjadi pada `markSuccess`. Dampak: angka `failure_count` mencerminkan kegagalan beruntun terakhir, cooldown tumbuh eksponensial.
- Commits remediation diharapkan: `fix(provider): close milestone 2 review findings (critical/high)` (+ mungkin commit lanjutan untuk medium/low).
- Setelah implementasi: jalankan `npm test`, `npm run test:hosted`, lint/typecheck/format/build, db checks; update plan ini (check off + Progress Log); commit; jalankan `migrate-development.yml` dengan commit SHA baru.
