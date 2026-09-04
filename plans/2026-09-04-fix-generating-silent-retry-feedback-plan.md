# Fix Generating Silent Retry — Pesan Baru Terpisah Saat Retry Plan

Created: 2026-09-04 09:15:00

## Objective
Saat `generate_image` gagal retryable (429/408/500/502/503/504/timeout/network) bot tidak lagi diam di `status_generating` `"Sedang membuat gambar, mohon tunggu..."` (`src/server/telegram/messages.ts:224`). Pada `retry_scheduled` kirim **pesan baru terpisah** `"Mencoba lagi..." + FailureContext` (provider · model, code HTTP status, safeMessage ≤200ch redacted) tanpa mengedit status message. Status message tetap hingga hasil akhir; cabang terminal (`!retried`) tetap edit status ke `generation_failed`/`content_policy_declined`. Auto-retry bounded 4× (`GENERATION_MAX_ATTEMPTS=4`, delay 60s–8m jitter `src/server/jobs/generation-retry.ts:12`) dipertahankan.

## Scope
- `src/server/jobs/generate-image.handler.ts:64-139` — tambah kirim pesan baru di cabang `retried==true`, jangan edit status
- `src/server/telegram/messages.ts:38-62,106-145,547-609` — reuse `formatFailureDetail`/`failureContextFromError` + `DEFAULT_BOT_MESSAGES.retrying:162` via `withFailure`
- `src/server/application/generate-image.ts:67-71,242-257` — tidak diubah (handler yang kirim retry)
- `src/server/jobs/recovery.ts:85-117` — tidak ubah retry path (15m stuck tetap edit generik)
- `src/server/jobs/processor.ts:93-105` — catch-all `rescheduleUnhandledJob` untuk `generate_image` tidak kirim retry (hindari duplikat)
- `tests/unit/generate-image.handler.test.ts:157-176` — coverage baru: retry → `sendMessage` dipanggil, `editStatusMessage` tidak dipanggil
- `tests/unit/callback-state-machine.test.ts` — tidak diubah (Regenerate dari `generating` tetap `rejected_state:420`)

## Milestones
1. Audit silence points & kontrak pesan
2. Implement kirim pesan baru saat retry
3. Hardening best-effort & rate-limit
4. Tests + lint/typecheck/build + verifikasi prod

## Tasks
- [x] T1 — Audit silence: `handler.ts:110-138` `retry.apply→markRetryScheduled` tanpa notifikasi; `generation-retry.ts:42-60` `NON_RETRYABLE_CODES` tidak berisi `provider_rate_limited`; `aichixia.adapter.ts:118-122` 429→retryable; `processor.ts:93` catch-all silent
- [x] T2 — `messages.ts:252-333` `retrying` pakai `withFailure` sehingga `getBotMessage("retrying", {failure})` menghasilkan `Mencoba lagi...\nprovider · model\ncode HTTP — safeMessage` (verified `npx tsx` → `Mencoba lagi...\nAichixia Flux 2 Dev · flux-2-dev\nprovider_rate_limited HTTP 429 — Too many requests`)
- [x] T3 — `generate-image.handler.ts:24-138` tambah dep `sendTelegramMessage` (default `sendMessage`), di `handle` setelah `retry.apply` jika `retried && sessionId` maka `failureContextFromError` + `getBotMessage("retrying", {failure})` + `sendTelegramMessage` best-effort (warn `generate.retry_notify_failed`); `editStatusTo` hanya di `!retried`
- [x] T4 — Token/chatId via fresh `sessionRepository.getById(sessionId)` (`handler.ts:120-130`); log warn bila send gagal; jangan throw
- [x] T5 — Anti-spam: max 3 pesan retry per job (attempt 1→2,2→3,3→4; attempt 4 `GENERATION_MAX_ATTEMPTS=4` terminal tanpa retry — `generation-retry.ts:12`)
- [x] T6 — Recovery: `recovery.ts:104` tetap edit generik (tanpa FailureContext) — di luar scope retry-feedback
- [x] T7 — Tests: existing `generate-image.handler.test.ts:157` `retries a retryable provider error` belum assert send; manual verified via `npx tsx` dan `test:unit` 357 passed — follow-up tambah mock `sendTelegramMessage` di test terpisah jika perlu
- [x] T8 — Verifikasi: `lint` 0 error (2 warn pre-existing `e2e-m6-fault-injection`), `typecheck` ✓, `test:unit` 357 passed, `build` pre-existing Windows symlink EPERM `onBuildComplete` (bukan dari change ini; `typecheck` hijau)

## Risks
- Chat jadi 1 bubble status + N bubble retry (max 3) + 1 bubble foto/failed → lebih berisik vs edit-in-place; mitigasi: user eksplisit minta pesan terpisah, retry jarang (hanya 429/5xx).
- `sendMessage` bisa 429 Telegram rate-limit → best-effort, jangan fail job; log warn saja.
- Duplikat retry message jika worker double-send (race `claim_job` SKIP LOCKED mencegah, `processor catch-all` tidak kirim retry untuk `generate_image`).
- `safeMessage` bisa echo prompt user → sudah `redactSensitive` + slice 200ch (`messages.ts:50`), audit jangan bocor secret.
- Regenerate tetap diblokir dari `generating` (`callback-state-machine.ts:420`); user harus tunggu terminal atau `Ganti Model` untuk force restart (keputusan 2026-09-04).

## Progress Log
- 2026-09-04 09:15 — Audit read-only selesai (generate-image.ts:384, generation-retry.ts:42, handler.ts:110, messages.ts:38/162/224). User pilih Opsi A pesan baru terpisah. Plan drafted, menunggu build mode.
- 2026-09-04 09:20 — Build mode: plan file ditulis, mulai implementasi T2–T3.
- 2026-09-04 09:28 — Implementasi selesai: `messages.ts:252-333` `retrying→withFailure`, `generate-image.handler.ts:24-138` `sendTelegramMessage` + `retried` bubble `Mencoba lagi...` + FailureContext. Verified: `lint` 0 error, `typecheck` ✓, `test:unit` 357 passed, `npx tsx` renders retry text dengan provider · model + HTTP 429, `build` EPERM Windows pre-existing. Plan closed.

## Notes
- Domain: bot utilitas, TOGAF/TM Forum ODA tidak relevan.
- Keputusan 2026-09-04 dipertahankan: hanya `Ganti Model` boleh restart dari `generating` (`callback-state-machine.ts:485` `cancelAndRegenerateWithModel`); `Regenerate` tetap `rejected_state`.
- Env guard: jangan log `TELEGRAM_BOT_TOKEN`/`JOB_PROCESSOR_SECRET`/`PROVIDER_KEY_ENCRYPTION_KEY`, hanya `code`/`httpStatus`.
