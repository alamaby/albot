# Regenerate After Failure — Toast & Stuck Session Fix

Date: 2026-08-27 (backfill 2026-08-30)

## Task / Problem
Retry dari `generation_failed` ditolak callback state machine (toast "Sesi sedang diproses") dan `generation_attempts` stuck `processing` (attempt `559f8439`) membuat sesi `7f5645b9` mati 10 jam (job `42ec7df3` failed 3/3 `provider_unknown_error`).

## Key Files Changed
- `src/server/application/callback-state-machine.ts:364,470` — `handleRegenerate`/`handleComplete` expectedStatus `result_ready|generation_failed` (keputusan #1: Selesai boleh dari gagal)
- `src/server/jobs/generate-image.handler.ts:60` + `src/server/application/generate-image.ts:283` — failure terminal selalu `mark_generation_attempt_failed` (`cleanupStuckProcessingAttempt`) sebelum transition, mencegah guard "generation already in progress" saat retry

## Decisions
- Keputusan #2: TIDAK ada recovery manual via `transition_prompt_session` di Dashboard — biarkan fix code yang membuka retry path
- DB MCP tetap READ ONLY; perubahan data hanya via RPC

## Verification
typecheck/lint/unit 274 passed; E2E prod confirmed: Regenerate & Selesai diterima dari `generation_failed`; sesi `7f5645b9` ter-retry. Plan CLOSED.

## Risks / Notes
- Selesai dari `generation_failed` menutup sesi tanpa gambar — diterima per keputusan #1
- Plan: `plans/2026-08-27-regenerate-after-failure-toast-fix.md`

## Commit Proposal
`fix: allow Regenerate and Selesai from generation_failed`
