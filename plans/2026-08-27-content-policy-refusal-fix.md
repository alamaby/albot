# Content-Policy Refusal Fix (RCA: bot tidak merespon)

Created: 2026-08-27
Status: **CLOSED** (pushed `1ce8f3f`, 279 unit pass)

## Objective
Bot tampak "tidak merespon" karena content-policy refusal disalah-artikan sebagai `provider_response_invalid` generik (non-retryable) sehingga `Coba Lagi` looping ke dead-end yang sama. RCA via MCP prod read-only (sesi `a220d31f`).

## RCA (dari `supabase-albot-be-production`, READ ONLY)
- Sesi `a220d31f` → status `enhancement_failed`; rev3 (`6e853cb8`) instruksi *"hanya apron saja / tanpa pakaian di bawah"* → 2 `enhance_prompt` gagal (`1b2b7e82` 07:05, `dcd31f4d` 07:06) `provider_response_invalid`.
- Provider Cloudflare gpt-oss-120b (config `077d9c6d`, key `534a5eec`) menolak konten → output non-JSON yang gagal zod `parseEnhancedPromptContent`.
- `provider_requests` `http_status:null` — respons refusal tidak valid-parsed.
- `jobs` global `succeeded 35, failed 3, queued 0` — bukan stuck job; processing sehat.

## Fix (A + B + C, gabungan)
| # | Perubahan | File |
|---|---|---|
| C | `StructuredPromptError.reason: refusal\|malformed`; non-JSON + refusal marker → refusal (valid-JSON schema-fail tetap malformed) | `prompt-structure.ts` |
| A | refusal → `provider_content_rejected` + pesan `content_policy_declined`; log/retry behavior akurat | `enhance-prompt.ts`, `messages.ts` |
| B | `retryKeyboard({showNewPrompt})` tambah tombol `Prompt Baru` (reuse `cancel`); `handleCancel` terima `enhancement_failed`/`generation_failed` | `keyboards.ts`, `enhance-prompt.handler.ts`, `callback-state-machine.ts` |

Tanpa migration (reuse action `cancel` yang sudah ada di DB constraint).

## Tests
- `prompt-structure`: refusal (keyword+non-JSON) vs malformed (valid-JSON schema-fail + kata policy) — false-positive guard
- `enhance-prompt.handler`: terminal `provider_content_rejected` → `sendRetryMessage({contentPolicy:true})`
- `callback-state-machine`: cancel dari `enhancement_failed` accepted; cancel dari `result_ready` rejected
- 279 total passed

## Progress Log
- 2026-08-27 — RCA via MCP prod (sesi a220d31f); keputusan #1 keyword+non-JSON, #2 tombol aksi, #3 reasoning+image.
- 2026-08-27 — Implementasi A+B+C selesai; 279 unit pass; pushed `1ce8f3f`.

## Notes
- Image path tidak punya `parseEnhancedPromptContent` (validasi URL); refusal image jika muncul ter-mapping `provider_response_invalid`/`provider_unknown_error` — keyboard `Prompt Baru` (B) tetap berlaku untuk `generation_failed` dari kedua capabilitas.