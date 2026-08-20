# Fix: Sesi Stuck di `enhancing` Saat Enhancement Gagal Terminal

Created: 2026-08-20

## Objective

Menghentikan sesi `prompt_sessions` yang selamanya terkunci di status `enhancing` ketika job `enhance_prompt` gagal terminal, dan memberi user jalan retry yang konsisten dengan pola `generation_failed` (tombol "Coba Lagi").

## Scope

App-only — **tanpa migration DB**. Semua asumsi schema sudah divalidasi terhadap dev DB (18 migration terpasang):

- `transition_prompt_session` allowlist memuat `enhancement_failed` → CAS `enhancing → enhancement_failed` valid.
- `prompt_sessions_one_active_idx` = `WHERE status NOT IN ('completed','cancelled','expired')` → `enhancing`/`enhancement_failed` tetap dihitung aktif (celah terkonfirmasi).
- `callback_events_action_check` memuat aksi `retry` → tombol retry valid.
- Tidak ada migration baru → `EXPECTED_MIGRATIONS` dan `database.types.ts` tidak berubah.

## Milestones

1. Fix handler + retry path (app code + unit test)
2. Data fix sesi stuck di dev
3. Verifikasi penuh lokal

## Tasks

### Kode

- [x] `src/server/jobs/enhance-prompt.handler.ts` — tiru pola generate handler:
  - `const retried = await this.retry.apply(...)`; jika `!retried` dan `prompt_session_id` ada → CAS best-effort `enhancing → enhancement_failed` + kirim pesan retry (baru).
  - Tambah dep `sendRetryMessage` (diinjeksi untuk test; default pakai `sendMessageWithKeyboard` + `retryKeyboard` + `buildBotMessage("enhancement_failed")`).
  - Private `transitionSessionToFailed(sessionId)` → RPC `transition_prompt_session { expected: "enhancing", new: "enhancement_failed" }` (best-effort, error di-log).
  - Load session fresh via `sessionRepository.getById` sebelum kirim pesan (hindari aksi pada id basi).
- [x] `src/server/telegram/keyboards.ts` — tambah `retryKeyboard(sessionId)` (tombol "Coba Lagi", data `retry:<sessionId>`), `parseRetryData`, perluas tipe `buildCallbackData`.
- [x] `src/server/application/callback-state-machine.ts` — tambah aksi `"retry"` ke `CallbackAction` + `handleRetry`:
  - Hanya valid saat `session.status === "enhancement_failed"` (selain itu ack "Sesi sedang diproses." + `rejected_state`).
  - CAS `enhancement_failed → enhancing` → enqueue job enhance ulang (revisi aktif yang sama via `insertEnhancementJob`) → dispatch processor → pesan "Sedang memproses ulang prompt..." → ack "Mencoba lagi...".
  - Rollback CAS ke `enhancement_failed` bila insert job gagal (pola sama dengan `enqueueGeneration`).
- [x] `src/server/application/handle-telegram-update.ts` — perluas cast aksi di `handleCallbackQuery` ke tipe `CallbackAction` (import dari state machine) sehingga `"retry"` lolos.
- [x] `src/server/telegram/messages.ts` — selaraskan teks `buildBotMessage("enhancement_failed")` dengan tombol retry ("Gagal memproses prompt. Silakan coba lagi.").

### Test

- [x] `tests/unit/enhance-prompt.handler.test.ts` — mock `@/server/supabase/admin` (rpcMock hoisted seperti generate handler); kasus terminal (retry.apply false → transition + pesan) & retryable (retry.apply true → tanpa transition/pesan).
- [x] `tests/unit/callback-state-machine.test.ts` — `retry` dari `enhancement_failed` (accepted, enqueue, dispatch) & dari status lain (rejected) + rollback saat insert job gagal.
- [x] `tests/unit/keyboards.test.ts` — `retryKeyboard` + round-trip `parseRetryData` + reject malformed.

### Data fix dev

- [x] `scripts/fix-stuck-enhancing-sessions.mjs` (dev-only; baca `.env`, pakai `SUPABASE_URL_DEV`/`SUPABASE_SERVICE_ROLE_KEY_DEV`):
  - Deteksi sesi stuck: `status='enhancing'` DAN tidak ada job enhance live (`queued/processing/retry_scheduled`) → dev saat ini **3 sesi**:
    - `98a061ef` (user 83540732, rev `failed`, job `failed` `provider_response_invalid`, expires 2026-08-21)
    - `aff6d19f` (user 790008574, rev `failed`, job `failed` `provider_authentication_failed`, expires 2099 — contract test)
    - `5a730955` (user 790000912, rev `pending`, tanpa job, expires 2099 — contract test)
  - Tiap sesi: CAS `enhancing → enhancement_failed` (via RPC) + kirim pesan retry (best-effort; akun contract test kemungkinan gagal terkirim → log, lanjut).
  - Cetak ringkasan.
  - **Script dibuat & dry-run OK (mendeteksi 3 sesi). Belum dijalankan dengan `--apply`.**

### Verifikasi

- [x] `npm run db:lint` (ok)
- [x] `npm run db:check-migrations` (ok, 18 migration, tak berubah)
- [x] `npm run db:types:check` (ok, tak berubah)
- [x] `npm run test:unit` (242 passed / 26 files)
- [x] `npm run lint` (0 errors)
- [x] `npm run typecheck` (ok)
- [x] `npm run build` (ok)
- [x] `npm run format:check` (hijau untuk semua file ter-track; tersisa 3 file tmp untracked `diag-dev-tmp.mjs`, `diag-dev2-tmp.mjs`, `repro-cloudflare-tmp.mjs` dari sesi debugging sebelumnya — di luar scope)

## Risks

- Re-enhance revisi `failed`: `markRevisionProcessing` (guard `status='pending'`) no-op → sukses tetap menulis `completed` via `saveEnhancedPrompt` (unconditional). Aman tapi subtil — didokumentasikan.
- Re-enhance revisi `pending` (kasus `5a730955`): guard `pending` lolos, alur normal.
- Tombol retry bisa ditekan berulang (bounded hanya oleh expiry 24 jam) — sama seperti pola regenerate; diterima.
- Sesi stuck lama tidak otomatis mendapat tombol retry (sudah gagal sebelum fix) → ditangani data fix (task di atas).
- MCP DB read-only → data fix harus lewat script dev, bukan MCP.

## Progress Log

- 2026-08-20 — Plan dibuat setelah validasi dev: 3 sesi stuck terkonfirmasi, schema mendukung `enhancement_failed` + aksi `retry`, 18 migration terpasang (tanpa migration baru).
- 2026-08-20 17:07 — Implementasi kode selesai: handler, keyboards, callback-state-machine, webhook cast, messages. Unit test 3 file ditambah (total 32 test pada file tsb; suite penuh 242). Script data fix dibuat, dry-run sukses (deteksi 3 sesi). Verifikasi penuh lokal hijau (db:lint, check-migrations, types:check, test:unit, lint, typecheck, build, format:check untuk file ter-track). Belum dijalankan: `--apply` data fix di dev; belum commit/push (menunggu keputusan user soal file tmp untracked).

## Notes

- Akar bug: `EnhancePromptHandler` (src/server/jobs/enhance-prompt.handler.ts:97) memanggil `retry.apply(...)` tanpa memeriksa return. Saat error terminal (`provider_response_invalid`, `provider_authentication_failed`, dll.) job jadi `failed` tapi sesi tetap `enhancing`; user terkunci oleh `prompt_sessions_one_active_idx` + session-policy sampai `expires_at` lewat (24 jam) lalu disapu `recover_stale_sessions`.
- Pembanding yang benar: `GenerateImageHandler` (generate-image.handler.ts:106-126) memeriksa `!retried` → CAS `generating → generation_failed` + edit pesan status.
- Keputusan user: **Opsi A (tombol retry)** — konsisten dengan `generation_failed`, tanpa migration DB. **Data fix via script dev**.