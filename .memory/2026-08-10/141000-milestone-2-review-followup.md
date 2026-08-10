# Milestone 2 Review Follow-Up

Created: 2026-08-10 14:10:00

## Task / Problem

Code review post-closure M2 (commit `b5d5a64`) menemukan 8 findings baru: Review-1 (Pixazo https-only), Review-2 (rotateKey rollback hosted test), Review-3 (selectProvider dual-strategy doc), Review-4 (extract readProviderRequestId), Review-5 (markSuccess affected rows), Review-6 (Pixazo body request_id fallback), Review-7 (accept), Review-8 (Pixazo metadata). Semua kecuali Review-7 dieksekusi.

## Key Decisions

- `src/server/providers/http.ts` baru: `readProviderRequestId(response)` (dari header x-request-id/x-request-trace-id) + `isHttpsUrl(value)` (regex `^https://`). Kedua adapters pakai helper — duplikasi hilang.
- Pixazo: flux `output` dan SDXL `imageUrl` kini wajib https; body request id via `readBodyRequestId` (prefer `request_id`, fallback `id`, lalu header); `metadata` berisi `model` + `providerRequestId`.
- `ProviderKeyRepository` constructor menerima vault opsional (injectable) agar rollback path bisa diuji tanpa DB error buatan. Default tetap membuat vault dari encryptionKey.
- `markSuccess` memakai `.select("id")` + throw `key not found` bila 0 rows (fail-fast pada referensi stale).
- `selectProvider` JSDoc mendokumentasikan dua dimensi strategi: top-level `strategy` = config selection, `selected.selectionStrategy` (DB row) = key selection; keduanya sengaja independen.
- **Hosted test requirement**: repository memakai `getServerEnv()` (nama env dasar), sedangkan harness pakai `_DEV` names. Contract test memetakan `getHostedEnv()` ke `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` + `resetServerEnvCache()` di module scope.
- Review-7 (selectKey signature tetap wide `ProviderStrategy`) di-accept untuk future flexibility.

## Key Files

- `plans/2026-08-10-milestone-2-review-followup-plan.md` — plan (baru).
- `src/server/providers/http.ts` — helper baru.
- `src/server/providers/image/pixazo.adapter.ts`, `reasoning/openai-compatible.adapter.ts`.
- `src/server/repositories/provider-key.repository.ts` (vault injectable + markSuccess check), `provider-key-vault.repository.ts`.
- `src/server/providers/selector.ts` (JSDoc dual-strategy).
- `tests/contract/pixazo-provider.contract.test.ts` (+4), `tests/contract/provider-repository.contract.test.ts` (+3, env mapping).

## Open Items / Blockers

- (none).

## Verification

- `npm test` — 150 pass (17 files).
- `npm run test:hosted` (REQUIRE_HOSTED_TESTS=true) — 74 pass, 0 skip.
- `npm run lint`, `typecheck`, `format:check`, `build`, `db:lint`, `db:check-migrations`, `db:types:check` — lulus.

## Conventional Commit Proposal

`fix(provider): apply post-closure review findings (medium/low)`

## Related

- `plans/2026-08-10-milestone-2-closure-plan.md`
- `plans/2026-08-09-milestone-2-review-remediation-plan.md`
- `plans/2026-08-08-milestone-2-provider-abstraction-configuration-plan.md`
