# Content-Policy Refusal Fix (RCA: bot tidak merespon)

Date: 2026-08-27 (backfill 2026-08-30)

## Task / Problem
Bot tampak "tidak merespon": content-policy refusal dari reasoning provider disalahartikan sebagai `provider_response_invalid` generik (non-retryable) sehingga tombol `Coba Lagi` looping ke dead-end yang sama. RCA via MCP prod READ ONLY (sesi `a220d31f`, rev3 instruksi sensITif ditolak Cloudflare gpt-oss-120b).

## Key Files Changed
- `src/server/providers/prompt-structure.ts` — `StructuredPromptError.reason: refusal|malformed` (non-JSON + refusal marker → refusal; valid-JSON schema-fail tetap malformed)
- `src/server/jobs/enhance-prompt.handler.ts`, `src/server/application/enhance-prompt.ts` — refusal → `provider_content_rejected` + pesan `content_policy_declined`
- `src/server/telegram/keyboards.ts` — `retryKeyboard({showNewPrompt})` tombol "Prompt Baru" (reuse action `cancel`, tanpa migration)
- `src/server/application/callback-state-machine.ts` — `handleCancel` terima `enhancement_failed`/`generation_failed`
- Review follow-up: `enhance-prompt-only.handler.ts` + `generate-image.handler.ts` — routing `content_policy_declined` di semua jalur (gap F2/F3)

## Decisions
- Klasifikasi refusal via keyword + non-JSON (keputusan #1); tombol aksi escape path (keputusan #2); berlaku untuk reasoning + image (keputusan #3)
- Tanpa migration — reuse action `cancel` yang sudah ada di DB constraint
- `provider_content_rejected` TIDAK menandai key failure (bukan masalah key)

## Verification
279 → 281 unit pass (termasuk anti false-positive refusal vs malformed); pushed `1ce8f3f` + follow-up; E2E prod OK.

## Risks / Notes
- Image refusal belum terbukti di prod (F3 defensive)
- Plan: `plans/2026-08-27-content-policy-refusal-fix.md` + review-followup

## Commit Proposal
`fix: classify content-policy refusal separately from malformed output`
