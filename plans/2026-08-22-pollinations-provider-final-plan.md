# Pollinations Provider Final Plan - Fallback gpt-oss + flux

Created: 2026-08-22

## Objective

Tambah Pollinations (https://gen.pollinations.ai) sebagai provider **fallback** untuk reasoning (`gpt-oss`) dan image (`flux`) via OpenAI-compatible API. Priority di atas 100 agar Pixazo/OpenAI tetap primary, Pollinations hanya dipakai saat primary gagal.

## Scope

- Reasoning: reuse `OpenAICompatibleReasoningAdapter` dengan `base_url https://gen.pollinations.ai/v1`, model `gpt-oss`
- Image: new `PollinationsImageAdapter` via `POST /v1/images/generations`, model `flux`, inject `negativePrompt`, map `aspectRatio`→`size`, tunda SVG
- Registry: 2 type (`pollinations`, `pollinations_image`) bukan 20 - multi-model via DB `model` column
- Migration: 2 rows `WHERE NOT EXISTS`, priority 150/151
- .env.example: `POLLINATIONS_API_KEY` untuk seed lokal
- Tests + verifikasi

## Milestones

1. Image adapter + reasoning protected fix
2. Registry + .env.example
3. Migration + schema test
4. Contract tests + full verification

## Tasks

- [x] Create `src/server/providers/image/pollinations.adapter.ts`
- [x] Update `src/server/providers/reasoning/openai-compatible.adapter.ts:117` `private buildHeaders` -> `protected`
- [x] Update `src/server/providers/index.ts` register `pollinations` + `pollinations_image`
- [x] Update `src/server/providers/errors.ts:74` tambah `case 402`
- [x] Update `.env.example:48` tambah `POLLINATIONS_API_KEY`
- [x] Create `supabase/migrations/20260823100000_add_pollinations_provider_configs.sql`
- [x] Update `tests/integration/schema.integration.test.ts:373` `EXPECTED_MIGRATIONS` + `20260823100000`
- [x] Create `tests/contract/pollinations-provider.contract.test.ts`
- [x] Run `npm run db:lint && db:check-migrations && db:types:check && test:unit && test:contract && lint && typecheck && build && format:check` — all green (db:lint ok, 25 migrations ok, db:types ok, 250 unit, 79 contract, lint 2 warnings pre-existing, typecheck ok, build ok, format:check ok)

## Risks

- Model id `gpt-oss` vs `gpt-oss-20b` perlu cek `GET /v1/models` sebelum seed - fallback 404 jadi `provider_configuration_invalid`
- `ON CONFLICT` invalid tanpa unique - fix pakai `WHERE NOT EXISTS`
- `private buildHeaders` tidak bisa override - fix protected

## Progress Log

- 2026-08-22 — Final plan konsolidasi dengan keputusan fallback flux/gpt-oss, inject negativePrompt, tunda SVG, .env.example
- 2026-08-22 21:30 — Implementasi: image adapter, registry 2 type, migration 150/151, 402 handling, contract tests, .env.example
- 2026-08-22 21:45 — Verifikasi lengkap hijau, format fixed, plan closed

## Notes

Fallback priority 150/151 > 100 default. Inject negativePrompt sebagai `prompt + " Avoid: {negativePrompt}"`. SVG tunda. API key di provider_keys vault, env hanya untuk seed.
