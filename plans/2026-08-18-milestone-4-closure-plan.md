# Milestone 4 Closure Plan

Date: 2026-08-18
Status: Closure

## Objective

Menutup Milestone 4 (Prompt Enhancement, Confirmation, and Revision) dengan evidence lengkap: implementasi, verifikasi otomatis, E2E dev, acceptance criteria, dan catatan remediasi.

## Verification Evidence

### Milestone Verification (template master plan)

- **Milestone**: 4 — Prompt Enhancement, Confirmation, and Revision
- **Environment**: development
- **Commit**: `35b80af` (implementasi) + fixes: `419d366`, `ff46eaa`, `7e67058`, `4eea150`, `c7cbbba`, `62c8780`, `cdfe365`
- **Vercel deployment**: `https://albot-1urv40l0w-alam-aby-bashits-projects.vercel.app` (final, E2E)
- **Supabase migration version**: 11 (dev), 0 (production)

### Automated Checks

- [x] Install — `npm ci` clean
- [x] Lint — 0 errors/warnings
- [x] Typecheck — clean
- [x] Unit tests — 179 passed
- [x] Contract tests — revision-rpc (4), session-one-active (2), enhancement-flow (1), database-functions (10), dll
- [x] Hosted integration tests — schema integration (11 migrations), service-role smoke, RLS security
- [x] Build — clean (Next.js production build)
- [x] Secret scan — gitleaks green (CI run #32)
- [x] db:lint, db:check-migrations (11), db:types:check — clean

### CI Runs

- validate #25 (35b80af): https://github.com/alamaby/albot/actions/runs/31768910649 — success
- validate #26 (419d366): https://github.com/alamaby/albot/actions/runs/31780330307 — success
- validate #27 (ff46eaa): https://github.com/alamaby/albot/actions/runs/31788373199 — success
- validate #28 (7e67058): https://github.com/alamaby/albot/actions/runs/32029002888 — success
- validate #29 (4eea150): https://github.com/alamaby/albot/actions/runs/32091304129 — success
- validate #30 (c7cbbba): https://github.com/alamaby/albot/actions/runs/32094182664 — success
- validate #31 (62c8780): https://github.com/alamaby/albot/actions/runs/32097483609 — success
- validate #32 (cdfe365): https://github.com/alamaby/albot/actions/runs/32104130627 — success

### Migration

- Dev: 11/11 applied (Local==Remote) — `20260813074037` + forward-fix `20260813091942` ditambah dari 9 M3.
- Production: 0 migrations, untouched.

## E2E (dev, Telegram + Vercel Preview)

Prompt "desain poster kafe cozy di malam hari":

1. Balasan "Prompt diterima. Sedang dalam antrian..."
2. Enhancement: session `awaiting_confirmation`, revision `completed` (enhanced: "A warm, cozy coffee shop at night..."), provider request `succeeded` HTTP 200 (Cloudflare gpt-oss-120b).
3. Pesan konfirmasi + tombol `Generate` / `Revise Lagi` / `Batal` muncul.
4. `Revise Lagi` → bot minta instruksi.
5. Kirim "buat lebih terang" → revision 2 `completed` ("A bright, inviting coffee shop interior..."), `previous_prompt` = enhanced revisi 1 (audit), revisi 1 tidak berubah (immutable).
6. `Generate` → session `generating`, job `generate_image` `queued` (handler M5 belum ada — path benar, konfirmasi user wajib sebelum generation).
7. `Batal` (session lain) → session `cancelled`.

Sanitized timeline DB (session `97bba427`):

```text
prompt_sessions:  1 (97bba427, await conf -> generating/cancelled flow)
prompt_revisions: 2 (rev 1 "kafe cozy", rev 2 "buat lebih terang" — both completed)
jobs:             2 enhance_prompt succeeded + 1 generate_image queued
provider_requests: HTTP 200 Cloudflare
callback_events:  revise/generate/cancel, prompt_session_id ter-link, dedupe unik
```

## Acceptance Criteria (master plan M4)

- [x] Original dan enhanced prompt auditable per revision (`source_prompt`, `previous_prompt`, `revision_instruction`, `enhanced_prompt`).
- [x] Setiap revision `revision_number` monotonik naik (rev 1, rev 2; RPC `create_revision` row-lock + `#variable_conflict`).
- [x] Konfirmasi user wajib sebelum image generation (generate_image job hanya dibuat dari callback `generate`; session `awaiting_confirmation` → `generating`).
- [x] Double callback → maksimal satu transisi/revision request (unique `callback_query_id`; CAS transitions).
- [x] Callback owner mismatch ditolak (state machine owner check + unit test).
- [x] Reasoning provider dapat diganti melalui config (DB `provider_configs` + registry/selector; Cloudflare ↔ OpenRouter).
- [x] Retry bounded mengikuti error classification (`classifyEnhancementError`, backoff 60s*2^n cap 8m, unit tests).
- [x] Job recover setelah lease expiry (`claim_job` lease recovery + contract test).

## Failure/Concurrency Scenarios (master plan)

- [x] Reasoning timeout → retryable, job `retry_scheduled` + backoff (unit test).
- [x] Reasoning 429 → key cooldown via `increment_provider_key_failure`, retry (unit test classification).
- [x] Reasoning 401 → terminal, `enhancement_failed`; failover antar config (E2E: OpenRouter 401 → pindah Cloudflare).
- [x] Invalid structured output → `provider_response_invalid`, no persist (prompt-structure unit test).
- [x] Double-click `Revise Lagi` → satu revisi (callback dedupe; E2E user tekan 3x, hanya 1 revisi efektif per session).
- [x] Callback replay → `callback_events.insertIfAbsent` null, ack only.
- [x] Callback dari user lain → rejected (owner check unit test).
- [x] Callback setelah session expiry → session `expired`, no transition (unit test).
- [x] Worker crash setelah provider success sebelum Telegram send → job `succeeded` durable; confirmation resend recovery M6 (documented known limitation).

## Remediation During E2E (bugs fixed)

1. `provider_adapter_unknown` — registry adapter tidak ter-registrasi → side-effect import `providers/index`.
2. 401 semua provider — base_url/model dari DB tidak diteruskan ke adapter factory → merge `base_url` + `model` ke payload.
3. `confirmation send failed (toString)` — raw RPC row vs SessionSafe → reload via repository setelah transition.
4. Callback "berkilau" — use case pakai stub "not wired" → wire Telegram client di `createDefaultWebhookDeps`.
5. `callback_events.prompt_session_id` null → parse sessionId dari callback data sebelum insert.
6. `mark_revision_failed` guard gagal → revision di-set `processing` sebelum provider call.
7. Contract test flakiness → isolate config lain di beforeAll, cleanup FK-safe.

## Production Status

- Production Supabase: 0 migrations (untouched).
- Production Vercel (`albot-ten.vercel.app`): belum deploy (M7).
- Production bot/webhook: belum di-set (M7).
- Provider production config: belum ada (M7).

## Evidence Required (master plan)

- [x] Unit/integration test reports — local + hosted green (180 unit + contract/integration).
- [x] CI validate run URLs (8 runs, semua success).
- [x] Sanitized session/revision timeline — session `97bba427` (2 revisions completed, jobs succeeded).
- [x] Telegram development screenshots — user verified pesan konfirmasi + tombol (manual).
- [x] Provider failover test evidence — OpenRouter 401 (base_url bug) → Cloudflare 200 (fix).

## Next

- Milestone 5: Image Generation and Post-Result Actions (handler `generate_image` — job sudah `queued` di dev dari E2E M4).
