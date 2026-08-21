# Bot Tidak Respon: Dispatcher Swallow + No Auto-Claim

**Issue:** User 83540732 kirim prompt baru sejak 2026-08-21 10:17:35 UTC tidak
mendapat respon apapun dari bot. DB `prompt_sessions` baru (id `2102ce5a`) dan
`jobs` baru (id `033b6f11`, `enhance_prompt`, `queued`, `attempt_count=0`,
`locked_by=null`) dibuat, tapi job tidak pernah di-claim. Last successful job
sebelumnya `b041b17c` gagal di Pixazo PixelForge (HTTP 500). Last job update
DB: 10:17:40 UTC (~2.5 jam tanpa aktivitas setelah timestamp stuck).

**Root Cause:**

1. `dispatchToProcessorUrl` (commit sebelumnya `4562fab`) swallow error — `catch`
   hanya log via `logStructured` lalu return `void`. Caller
   `handlePrivateTextMessage` punya try/catch yang mengirim "Gagal memulai
   pemrosesan", tapi karena dispatcher tidak throw, catch tidak pernah jalan.
   User tidak terima respon apapun (silent failure).
2. Tidak ada cron/scheduler yang men-trigger `/api/jobs/process` di luar
   dispatcher webhook. Job baru hanya diproses inline saat user kirim pesan.
   Kalau dispatcher gagal (network, 401, Vercel cold start, timeout 5s), job
   stuck `queued` permanen sampai user kirim pesan baru dan dispatcher sukses.

**Fix:**

1. `dispatchToProcessorUrl` di `src/server/application/handle-telegram-update.ts`
   return `Promise<DispatchResult>` (`{ok:true,status}` | `{ok:false,status?,error}`)
   alih-alih swallow. Type `TelegramWebhookDeps.dispatchToProcessor` disinkronkan.
2. `handlePrivateTextMessage` step 7 cek return: `ok:true` → kirim
   `buildBotMessage("prompt_received")`; `ok:false` → log
   `webhook.dispatcher_returned_error` + kirim "Gagal memulai pemrosesan.
   Silakan coba lagi sebentar." ke user.
3. Cron workflow `.github/workflows/process-jobs-development.yml` (`*/1 * * * *`,
   environment `recovery-development`, secret `JOB_PROCESSOR_SECRET`) men-trigger
   `POST /api/jobs/process` tiap 1 menit. Backlog drain karena processor claim
   1 job per call.
4. Tests `tests/unit/telegram-webhook.test.ts`:
   - Mock `dispatchToProcessor` updated untuk return `{ok:true,status:200}`.
   - Test "never fails when the dispatcher call fails" diubah dari `throw` ke
     return `{ok:false,status:500,error}`.
   - Test baru "tells the user when the dispatcher returns an error" memastikan
     user terima "Gagal memulai pemrosesan" dan TIDAK terima "diterima" saat
     dispatcher `ok:false`.

**Files Changed:**

- `src/server/application/handle-telegram-update.ts` — dispatcher return type
  + step 7 explicit error feedback.
- `tests/unit/telegram-webhook.test.ts` — mock return type + 2 test
  (dispatcher swallow→return error, dispatcher return error→user feedback).
- `.github/workflows/process-jobs-development.yml` — cron baru.
- `docs/runbooks/milestone-6-incident-response.md` — section 2a baru (runbook
  "Bot diam setelah user kirim teks").
- `docs/environment-variables.md` — catatan post-M6 cron `process-jobs`.
- `TODO.md` — checklist baru + status DEFERRED Pollinations.
- `plans/2026-08-22-bot-no-response-after-new-text.md` — plan.

**Verification (lokal):**

- `npm run lint` 0 errors, 2 warnings preexisting.
- `npm run typecheck` clean (tracked files; `scripts/set-webhook.ts` untracked
  artifact dihapus).
- `npm run test:unit` 243/243 passed.
- `npm run db:lint` ok.
- `npm run db:check-migrations` 23/23.
- `npm run db:types:check` ok.
- `npm run format:check` all matched.
- `npm run build` ok.

**Open:**

- Deploy commit baru ke Vercel preview, tunggu cron 1 menit aktif.
- Trigger manual `POST /api/jobs/process` dengan `JOB_PROCESSOR_SECRET` untuk
  menarik job stuck `033b6f11` sebelum deploy propagated.
- Verifikasi user: kirim prompt baru, pastikan bot respon dengan `prompt_received`
  atau `Gagal memulai pemrosesan` (bukan silent failure).

**Related Plan / Specs:**

- `plans/2026-08-22-bot-no-response-after-new-text.md`
- Plan Pollinations `plans/2026-08-22-pollinations-provider-implementation-plan.md`
  di-DEFER sampai dispatcher stabil (Pollinations TIDAK terkait masalah ini).

**Commit Message (Suggested):**

```
fix(telegram): surface dispatcher errors and add process-jobs cron

- dispatchToProcessorUrl returns DispatchResult; webhook sends explicit error
  message when dispatch fails (no more silent failures)
- add process-jobs-development cron (1 minute) to claim queued jobs even when
  the inline webhook dispatcher drops the call
- update tests to assert structured return and user feedback
```