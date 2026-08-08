# Start Milestone 2 Provider Abstraction and Configuration

Created: 2026-08-08 17:50:00

## Task / Problem

Milestone 2: build provider-neutral engine, encrypted provider key management, provider/key selection, retry classification, server-only repository, OpenAI-compatible reasoning adapter, and Pixazo image adapter.

## Key Decisions

- Provider awal: OpenAI-compatible reasoning + Pixazo image generation.
- Admin surface: server-only repository/application contract.
- `PROVIDER_KEY_ENCRYPTION_KEY`: base64, decoded 32 bytes, AES-256-GCM.
- Pixazo models:
  - Flux 1 Schnell: `POST https://gateway.pixazo.ai/flux-1-schnell/v1/getData` → `{ "output": "https://..." }`
  - SDXL: `POST https://gateway.pixazo.ai/getImage/v1/getSDXLImage` → `{ "imageUrl": "https://..." }`
- Authentication: `Ocp-Apim-Subscription-Key` header.
- Empty response fields (imageUrl/output) must map to `provider_response_invalid`.

## Implementation Plan

Plan file: `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`

Milestones:

1. M2 baseline + env validation (`PROVIDER_KEY_ENCRYPTION_KEY`).
2. Encryption (`encryption.ts`) + fingerprint (`fingerprint.ts`).
3. Domain contracts (`domain/provider.ts`) + error taxonomy (`providers/errors.ts`).
4. Config validation + provider registry.
5. Provider/key selector.
6. Server-only repositories (`repositories/`).
7. OpenAI-compatible reasoning adapter.
8. Pixazo Flux Schnell adapter.
9. Pixazo SDXL adapter.
10. Mock adapters + unit/contract/integration/security tests.
11. Development workflow verification + evidence.

## Open Items / Blockers

- (none) — M2 ready to implement.

## Conventional Commit Proposal

`feat(provider): implement milestone 2 abstraction and encrypted key management`

## Related

- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`
- `docs/environment-variables.md`
