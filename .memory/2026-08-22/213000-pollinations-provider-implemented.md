# Pollinations Fallback Implemented - gpt-oss + flux

Created: 2026-08-22 21:30 WIB

## Task
Implementasi Pollinations sebagai fallback provider sesuai final plan `plans/2026-08-22-pollinations-provider-final-plan.md` dengan keputusan: flux + gpt-oss, priority 150/151 fallback, inject negativePrompt, tunda SVG, .env.example.

## Implementasi
- `src/server/providers/image/pollinations.adapter.ts` — new `PollinationsImageAdapter` POST `https://gen.pollinations.ai/v1/images/generations`, body prompt/model/n/size/response_format:url, inject `negativePrompt` as `Avoid:`, size map 1:1/16:9/9:16/4:3/3:4, b64_json fallback, isHttpsUrl, readProviderRequestId, logStructured upstream_error
- `src/server/providers/reasoning/openai-compatible.adapter.ts:92,117,128` — `private` -> `protected` untuk buildRequestBody/buildHeaders/parseResponse
- `src/server/providers/index.ts` — register `pollinations` (reasoning gpt-oss, https://gen.pollinations.ai/v1, 60s) + `pollinations_image` (image flux, https://gen.pollinations.ai/v1, 120s) — 2 type, model via config.model
- `src/server/providers/errors.ts:74` — tambah `case 402: return "provider_rate_limited"` untuk Pollen habis
- `.env.example:50` — tambah `# POLLINATIONS_API_KEY=`
- `supabase/migrations/20260823100000_add_pollinations_provider_configs.sql` — 2 rows WHERE NOT EXISTS, priority 150/151
- `tests/integration/schema.integration.test.ts:373` — EXPECTED_MIGRATIONS + `20260823100000` (total 25)
- `tests/contract/pollinations-provider.contract.test.ts` — 8 tests (reasoning gpt-oss Bearer, image inject/size/b64/402)

## Verifikasi
- `npm run db:lint` — ok (migration static SQL scan passed)
- `npm run db:check-migrations` — ok (25 migrations pass)
- `npm run db:types:check` — ok (types match)
- `npm run test:unit` — 250 passed (26 files)
- `npm run test:contract` — 79 passed (14 files, termasuk 8 pollinations)
- `npm run lint` — 0 errors, 2 warnings pre-existing (e2e-m6-fault-injection.mjs)
- `npm run typecheck` — ok (next typegen + tsc)
- `npm run build` — ok (9/9 static pages)
- `npm run format:check` — ok (after format)
- Plan `plans/2026-08-22-pollinations-provider-final-plan.md` tasks 8/9 -> 9/9 closed

## Keputusan Desain
- 2 adapter type bukan 20 — reuse model via DB column, fallback via priority
- 402 pollen mapped ke rate_limited non-retryable
- Inject negativePrompt via `Avoid:` karena OpenAI images API tidak punya negative_prompt

## Commit
feat: add Pollinations fallback provider (gpt-oss + flux)
