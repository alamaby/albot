# Pollinations Provider - Final Plan Konsolidasi

Created: 2026-08-22 21:00 WIB

## Task
Konsolidasi dua plan Pollinations (ringkas + detailed truncated) menjadi final plan fallback: reasoning `gpt-oss` + image `flux` via `https://gen.pollinations.ai/v1`.

## Keputusan
1. Default image `flux`, reasoning `gpt-oss` (id Pollinations `gpt-oss`)
2. Fallback: priority 150/151 > 100 default (selector.ts:98 ASC)
3. NegativePrompt inject: `prompt + " Avoid: {negativePrompt}"`
4. SVG tunda
5. API key di provider_keys vault, tambah `POLLINATIONS_API_KEY` di .env.example untuk seed lokal

## Perubahan Plan
- Dari 20 adapter type -> 2 type (`pollinations`, `pollinations_image`) - single model via DB `model` column
- Fix `private buildHeaders` -> `protected` di openai-compatible.adapter.ts:117
- Fix migrasi `ON CONFLICT DO NOTHING` invalid -> `WHERE NOT EXISTS`
- Tambah 402 handling di errors.ts:74
- Detail plan truncated di 214 baris digabung ke final plan `plans/2026-08-22-pollinations-provider-final-plan.md`

## File Berubah (rencana)
- `src/server/providers/image/pollinations.adapter.ts` (new)
- `src/server/providers/reasoning/openai-compatible.adapter.ts` (protected)
- `src/server/providers/index.ts` (register 2)
- `src/server/providers/errors.ts` (402)
- `.env.example` (POLLINATIONS_API_KEY)
- `supabase/migrations/20260823100000_...sql`
- `tests/integration/schema.integration.test.ts` EXPECTED_MIGRATIONS
- `tests/contract/pollinations-provider.contract.test.ts` (new)

## Risiko
- Model id gpt-oss perlu verifikasi GET /v1/models
- Priority collision jika tidak >100
- Pollen 402 tidak terklasifikasi

## Verifikasi
db:lint, db:check-migrations, db:types:check, test:unit, test:contract, lint, typecheck, build, format:check

## Commit
feat: add Pollinations fallback provider (gpt-oss + flux)
