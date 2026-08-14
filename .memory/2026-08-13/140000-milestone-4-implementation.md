# Milestone 4 — Prompt Enhancement, Confirmation, and Revision

Date: 2026-08-13

## Status

**Implementation done** — local + hosted tests green (266/266, 34 files), migration 11/11 applied ke dev, production untouched. Platform wiring (provider seed di dev, E2E Telegram, screenshots) dan closure pending.

## Scope Implemented

- Handler `enhance_prompt` di job processor (sebelumnya skeleton no-op M3): select provider via registry/selector M2 (config + key dari DB), `provider_requests` audit row sebelum outbound, invoke reasoning adapter, parse + zod validate structured JSON output (`prompt`/`negative_prompt`/`aspect_ratio`), persist revision `completed`, transition session `received|awaiting_revision_input → enhancing → awaiting_confirmation`, kirim confirmation message + inline keyboard.
- Callback state machine inline di webhook: `generate` (insert `generate_image` job + session → `generating`, M5 handler), `revise` (→ `awaiting_revision_input` + minta instruksi), `cancel` (→ `cancelled`). Owner check + expiry check + CAS; dedupe via `callback_events.insertIfAbsent`.
- Revision input: text saat session `awaiting_revision_input` → RPC `create_revision` (revision_number monotonic, immutable, `previous_prompt` = enhanced lama) → transition → enqueue `enhance_prompt` baru → dispatch.
- Retry bounded: `classifyEnhancementError` (retryable 408/429/5xx; terminal 4xx non-429, invalid output) + backoff `60s * 2^n` cap 8m; `mark_revision_failed` guard-patched; job `retry_scheduled`/`failed` via worker-ownership update.
- Migration `20260813074037` (2 RPC: `mark_revision_failed`, `create_revision` + partial unique index `prompt_sessions_one_active_idx` + `prompt_sessions_status_idx`) + forward-fix `20260813091942` (`#variable_conflict use_column` — original RPC ambiguous `revision_number`).
- Script `scripts/seed-provider-config.mjs` (provision provider config + encrypted key dev).
- `docs/runbooks/milestone-4-e2e.md`, `docs/environment-variables.md` note.

## Verification

- `npm test` — **266 passed** (34 files) termasuk contract baru: revision-rpc, session-one-active, enhancement-flow (mock provider end-to-end: select → request → persist → transition).
- lint 0 warning, typecheck clean, format clean, build clean.
- `db:lint`, `db:check-migrations` (11), `db:types:check` — clean.
- Dev migration 11/11 (Local==Remote). Production 0 untouched.

## Notes / Gotchas

- **Claim_job global FIFO + test isolation**: contract test `claim_job` concurrency gagal bila ada job claimable asing (enhancement-flow leftover). Fix: enhancement-flow job diinsert sebagai `processing` (bukan `queued`) agar tidak claimable, dan cleanup FK-safe (provider_requests → jobs → sessions → revisions → keys → configs). Job `ct_*` dari run yang gagal harus di-cleanup manual (delete provider_requests dulu — FK RESTRICT).
- **Cleanup aktif-sesi dev**: sebelum migration partial unique index, 22 session aktif leftover test di-cancel manual (user range `88xxxxxxx` + admin `83540732`).
- **RPC args types**: `create_revision`/`mark_revision_failed` args di generated types non-nullable (SQL `text`); call site memakai cast `as never` di test/repo sampai types di-regenerate.

## Pending Platform Wiring

1. Seed provider reasoning di dev (`node scripts/seed-provider-config.mjs ...` + key OpenAI).
2. E2E Telegram dev: prompt → enhancement → konfirmasi → Revise Lagi → revisi 2 → Generate (job `generate_image` queued) → Batal.
3. Record evidence (CI run, migration run, DB timeline, screenshots, failover test).
4. Commit + push → CI validate green → closure M4.

## Next

- M5: Image Generation and Post-Result Actions (handler `generate_image`).
