# Milestone 2 Provider Abstraction And Configuration

Created: 2026-08-08 17:50:00

## Objective

Membangun provider-neutral engine untuk reasoning dan image generation, encrypted provider-key management, provider/key selection, retry classification, server-only repository contract, OpenAI-compatible reasoning adapter, dan Pixazo image adapter.

M2 selesai hanya setelah:
- Provider contract dan domain error stabil.
- Provider registry menolak capability/adapter yang tidak kompatibel.
- Provider key tersimpan sebagai ciphertext, IV, auth tag, dan fingerprint.
- Plaintext key tidak muncul pada response, log, fixture, atau serialized config.
- Selector menghormati capability, active state, cooldown, priority, dan weight.
- Retry/failover classification lulus semua skenario.
- OpenAI-compatible adapter lulus contract tests.
- Pixazo adapters (Flux Schnell + SDXL) lulus contract tests berdasarkan dokumentasi yang dikonfirmasi.
- Repository server-only lulus typecheck, security tests, dan integration tests.
- Development verification berjalan; production tetap belum disentuh.

## Decisions

- Provider awal: OpenAI-compatible reasoning + Pixazo image generation.
- Admin surface: server-only repository/application contract. Admin UI/API ditunda ke milestone berikutnya.
- `PROVIDER_KEY_ENCRYPTION_KEY`: base64 yang decode tepat 32 bytes.
- Encryption: AES-256-GCM.
- IV: random 12 bytes per encryption.
- Auth tag: authenticated GCM tag, disimpan terpisah.
- Fingerprint: deterministic SHA-256 fingerprint dari plaintext key, hanya untuk deduplication/display-safe identification.
- Plaintext key hanya berada di memory selama outbound provider request.
- Provider adapter tidak boleh membaca Telegram state atau mengubah session state.
- Repository tidak boleh mengirim provider request atau Telegram message.
- Existing M1 DB strategy (capabilities, selection_strategy, provider selection) tetap digunakan.
- Pixazo models:
  - Flux 1 Schnell (primary): `https://gateway.pixazo.ai/flux-1-schnell/v1/getData`
  - SDXL (secondary): `https://gateway.pixazo.ai/getImage/v1/getSDXLImage`
- Pixazo authentication: `Ocp-Apim-Subscription-Key` header.
- Pixazo response format:
  - Flux: `{ "output": "https://..." }` — require non-empty `output`
  - SDXL: `{ "imageUrl": "https://..." }` — require non-empty `imageUrl`
- Empty response fields map to `provider_response_invalid`.

## Scope

- Add `PROVIDER_KEY_ENCRYPTION_KEY` validation.
- Implement AES-256-GCM encryption/decryption.
- Implement deterministic provider-key fingerprint.
- Implement provider domain contracts.
- Implement normalized provider error taxonomy.
- Implement config validation.
- Implement provider registry.
- Implement provider selector.
- Implement key selector.
- Implement cooldown/failure state handling.
- Implement server-only config repository.
- Implement server-only encrypted-key repository.
- Implement key rotation contract.
- Implement OpenAI-compatible reasoning adapter.
- Implement Pixazo Flux Schnell adapter.
- Implement Pixazo SDXL adapter.
- Implement mock adapters.
- Add unit, contract, integration, and security tests.
- Add redacted evidence fixtures.
- Add provider source/contract documentation references.

## Out Of Scope

- Telegram webhook.
- Telegram callback handling.
- Durable job processor.
- Admin UI.
- Public admin API route.
- Provider key plaintext response.
- Production provider configuration.
- Production encryption key rotation.
- Real provider API calls in CI.
- Pixazo implementation before API contract confirmation (sudah dikonfirmasi).
- Database schema changes unless a concrete M2 invariant requires forward-fix migration.

## Target Structure

```text
src/server/
├── domain/
│   └── provider.ts                  # contracts + capability/strategy unions
├── providers/
│   ├── config.ts                    # zod config validation (remediation H10)
│   ├── errors.ts
│   ├── index.ts                     # registry initialization
│   ├── registry.ts
│   ├── selector.ts
│   ├── reasoning/
│   │   └── openai-compatible.adapter.ts
│   ├── image/
│   │   └── pixazo.adapter.ts         # flux + sdxl via responseKind discriminator
│   └── mock/
│       ├── mock-image.adapter.ts
│       └── mock-reasoning.adapter.ts
├── repositories/
│   ├── provider-config.repository.ts
│   ├── provider-key.repository.ts    # safe projection only
│   └── provider-key-vault.repository.ts  # decrypt-only (remediation H4)
└── security/
    └── encryption.ts                 # encryption + fingerprint
```

> Catatan (drift vs rencana awal): folder `contracts/` tidak ada — contract
> didefinisikan langsung di `domain/provider.ts`. `fingerprint.ts` tergabung
> dalam `encryption.ts`. Pixazo diimplementasikan sebagai satu adapter dengan
> discriminator `responseKind` (bukan dua file terpisah).

## Verification Commands

```text
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:security
npm run test:hosted
npm run db:lint
npm run db:check-migrations
npm run db:types:check
npm run format:check
npm run build
```

Hosted development workflow must run with:
```text
REQUIRE_HOSTED_TESTS=true
```

Production workflow must not run in M2.

## Acceptance Criteria

- [ ] `PROVIDER_KEY_ENCRYPTION_KEY` validates as base64-decoded 32-byte key.
- [ ] AES-256-GCM round trip passes.
- [ ] Tampered ciphertext/IV/auth tag fails.
- [ ] Wrong root key fails.
- [ ] Fingerprint deterministic and ciphertext non-deterministic.
- [ ] Provider config parser rejects invalid capability/adapter/settings.
- [ ] Registry resolves OpenAI-compatible reasoning and Pixazo image adapters.
- [ ] Unknown adapter and capability mismatch fail before HTTP.
- [ ] Selector respects active state, cooldown, priority, and weight.
- [ ] Retry taxonomy maps all required HTTP/network/provider errors.
- [ ] Repository writes only ciphertext material.
- [ ] Repository safe result never exposes plaintext or encrypted fields.
- [ ] Key rotation verifies new key before deactivating old key.
- [ ] OpenAI-compatible adapter contract passes.
- [ ] Pixazo Flux Schnell adapter contract passes based on confirmed API evidence.
- [ ] Pixazo SDXL adapter contract passes based on confirmed API evidence.
- [ ] Mock adapters pass common provider contracts.
- [ ] No provider adapter imports Telegram modules.
- [ ] No plaintext provider key appears in logs, errors, fixtures, snapshots, or artifacts.
- [ ] Unit, contract, integration, security, and hosted tests pass with zero skips in hosted workflow.
- [ ] Development verification evidence captured.
- [ ] Production migration/configuration remains untouched.

## Evidence Required

- M2 development workflow URL and run ID (setelah dijalankan).
- Exact commit SHA.
- Environment validation report.
- Encryption test report.
- Redacted provider config example.
- Database row showing ciphertext/fingerprint only.
- Provider selector test report.
- Retry classification report.
- OpenAI-compatible adapter contract report.
- Pixazo API source/contract evidence (URL dokumentasi).
- Pixazo adapter contract report (Flux + SDXL).
- Source search proving vendor names limited to adapters/registry/fixtures.
- Gitleaks/secret scan result.
- Confirmation production remains unchanged.

## Risks

- **Pixazo API contract may be incomplete or change.**
  Mitigation: fixtures from official contract; fail closed on unexpected response.

- **Encryption root key compromise exposes all provider keys.**
  Mitigation: Vercel server-only secret, no browser exposure, authenticated encryption, rotation, audit, least privilege.

- **Provider selector behavior differs across serverless instances.**
  Mitigation: deterministic selection contract; avoid process-local counters as source of correctness.

- **Provider failure state can be overwritten by stale workers.**
  Mitigation: conditional updates/version checks and tests with concurrent updates.

- **Ciphertext format migration can break existing keys.**
  Mitigation: versioned envelope, backward-compatible decrypt path, forward-only rotation.

- **Real provider calls leak secrets or incur cost in CI.**
  Mitigation: mocked HTTP and contract fixtures; no real provider credentials in CI tests.

- **Admin repository can become an unintended decryption API.**
  Mitigation: separate safe projection from decrypt handle; no public/admin route in M2.

## Progress Log

- 2026-08-08 17:50:00 — Plan dibuat setelah M1 + remediation selesai dengan evidence. Decisions: OpenAI-compatible + Pixazo, server-only repository/API contract, base64 32-byte AES-GCM key. M2 belum diimplementasikan.
- 2026-08-08 18:50 — Implementasi M2 Phase 1-7 selesai: encryption service, provider contracts, error taxonomy, registry, selector, repositories, adapters (OpenAI-compatible + Pixazo Flux Schnell/SDXL), mock adapters. 110 total tests pass, 56 hosted tests pass dengan REQUIRE_HOSTED_TESTS=true. Typecheck, lint, format, build semua lulus. Pending: forward-fix migration (jika ada schema changes), regenerate types, jalankan migrate-development.yml, capture evidence.
- 2026-08-09 17:18 — Review read-only M2 (commit `209847d`): 50 findings (8 Critical, 11 High, 16 Medium, 15 Low). Remediation plan dibuat di `plans/2026-08-09-milestone-2-review-remediation-plan.md`. Structure actual tercatat (L15): contracts didefinisikan di `domain/provider.ts`; fingerprint tergabung di `encryption.ts`; Pixazo satu adapter dengan `responseKind`.

## Notes

- Pixazo adapter implementation berdasarkan official documentation:
  - Flux 1 Schnell: https://www.pixazo.ai/models/flux#doc-flux-1-schnell-get-image-code
  - SDXL: https://www.pixazo.ai/models/stable-diffusion#doc-stable-diffusion-xl-base-10-get-image-code
- M2 database changes should be avoided unless concrete provider lifecycle invariant requires a forward-fix migration.
- Production provider configuration and production encryption key remain out of scope for M2.
- Proposed commit: `feat(provider): implement milestone 2 abstraction and encrypted key management`

