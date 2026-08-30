# Prompt Audit Feature (180-day, cross-purge) + instruction_kind

Date: 2026-08-29/30 (backfill 2026-08-30)

## Task / Problem
Audit prompt lintas-retensi: metadata transaksional di-purge 30 hari, tapi perlu jejak input/output enhancement & generation sampai 180 hari, plus atribusi model reasoning.

## Key Files Changed
- Migrations `20260829130000` (tabel `prompt_audit` FK-free + index), `20260829140000` (RPC `purge_prompt_audit`), `20260829150000` (+`previous_prompt`, `revision_instruction`), `20260829160000` (`provider_requests` +`request_messages`/`response_content`/`reasoning_model` + denormalized telegram ids + index user), `20260829170000` (`prompt_revisions.instruction_kind` 'source'|'revision'), `20260829180000` (5-arg `create_revision`), `20260830100000` (drop overload legacy 4-arg)
- `src/server/repositories/prompt-audit.repository.ts` — best-effort insert (`enhance_input`/`enhance_output`/`generate_input` termasuk baris gagal dengan `error_code`) + query admin
- `src/app/api/admin/prompts/route.ts` — GET audit (user_id/session_id/since/until/limit/offset)
- `src/server/jobs/recovery.ts` — purge audit 180 hari di sweep
- `src/server/application/enhance-prompt.ts` — capture `request_messages`/`response_content` (redacted)/`reasoning_model` ke `provider_requests`
- `src/server/application/revision-input.ts` — `create_revision` dengan `p_instruction_kind: "revision"`

## Decisions
- `prompt_audit` FK-free agar purge metadata transaksional tidak terblokir
- Audit insert best-effort — kegagalan audit tidak pernah menggagalkan flow user
- Retention: metadata 30d, audit 180d

## Verification
Schema integration test di-update untuk tabel/kolom baru (`9a9d88b`); types regen (`0e3a999`); guard `buildMessagesForAudit` untuk mocks (`efaceb5`); hosted tests hijau di migrate-development.

## Risks / Notes
- `response_content` tersimpan redacted (log redaction dipakai ulang)
- Commit: `eff14bf`, `3cc6f0b`, `d17234d`, `63b77ad`, `9a9d88b`, `efaceb5`, `0e3a999`

## Commit Proposal
`feat(audit): add prompt_audit table with 180-day retention sweep`
