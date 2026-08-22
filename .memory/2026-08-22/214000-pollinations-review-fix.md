# Pollinations Review Fix

Created: 2026-08-22

## Task
Fix 4 medium gaps dari review `pollinations.adapter.ts` + `errors.ts` + coverage.

## Fix
- `pollinations.adapter.ts:28` apiKey non-empty validation
- `pollinations.adapter.ts:137` prompt non-empty validation (provider_request_invalid)
- `pollinations.adapter.ts:210` b64 strict regex `^[A-Za-z0-9+/=_-]+$` + length%4, Buffer guard `typeof Buffer`
- `pollinations.adapter.ts:99` log providerRequestId
- `errors.ts:84` 402 before 404, comment 113 update 402 terminal
- `openai-compatible.adapter.ts:26` apiKey validation + model.trim + timeoutMs finite/positive parity
- `pollinations-provider.contract.test.ts:70` +6 edge: empty negativePrompt, all size variants, empty prompt, invalid seed, http url, invalid b64, empty apiKey, AbortError, reasoning 402/429

## Verifikasi
- test:contract 89 passed (14 files, +10 pollinations)
- test:unit 250 passed
- lint 2 warnings pre-existing, typecheck ok, build ok, format ok
- db:lint ok, 25 migrations

## Commit
fix: harden Pollinations provider (validations + coverage)
