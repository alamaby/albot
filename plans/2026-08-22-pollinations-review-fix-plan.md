# Pollinations Review Fix Plan

Created: 2026-08-22

## Objective
Tutup 4 gap medium review agar fallback Pollinations production-ready tanpa ubah priority/model keputusan (flux + gpt-oss fallback 150/151).

## Scope
- Validasi input prompt/apiKey/b64
- Lengkapkan contract edge coverage
- Rapikan errors.ts & logging

## Milestones
1. P0 adapter hardening
2. P0 errors order + log
3. P1 contract coverage
4. Verifikasi hijau

## Tasks
- [x] P0 `src/server/providers/image/pollinations.adapter.ts:28` — validate apiKey non-empty
- [x] P0 `pollinations.adapter.ts:128` — validate prompt non-empty
- [x] P0 `pollinations.adapter.ts:197` — b64 strict regex (A-Za-z0-9+/=_- whitespace, length%4)
- [x] P0 `pollinations.adapter.ts:88` — log providerRequestId
- [x] P0 `src/server/providers/errors.ts:74` — reorder 402 before 403/404, update comment 113
- [x] P0 `src/server/providers/reasoning/openai-compatible.adapter.ts:36` — model.trim + timeoutMs finite/positive parity
- [x] P1 `tests/contract/pollinations-provider.contract.test.ts:70` — 6 edge cases: empty negativePrompt, size variants, seed invalid, http url, AbortError, reasoning 402/429
- [x] Verifikasi `db:lint, db:check-migrations, db:types:check, test:unit, test:contract, lint, typecheck, build, format:check`

## Risks
- b64 regex url-safe strict — mitigasi terima `_-`
- Edge Buffer guard `typeof Buffer !== "undefined"` — fallback atob

## Progress Log
- 2026-08-22 — Review done, plan dibuat
- 2026-08-22 — Exec fix
- 2026-08-22 — Fix done: prompt/apiKey/b64/log, errors 402 order, openai-compatible parity, 10 pollinations tests (89 contract), all green

## Notes
402 terminal rate_limited benar untuk pollen habis (hindari loop, fallback ke next priority via selector.ts:98).
