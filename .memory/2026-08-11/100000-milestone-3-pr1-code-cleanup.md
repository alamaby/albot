# Milestone 3 — PR #1 Code Cleanup

Date: 2026-08-11 (referenced from `.memory/README.md`; file dibuat saat PR #1 di-commit)

## Summary

PR #1 menyelesaikan code cleanup Milestone 3 (Telegram Intake and Durable Jobs) di atas
implementasi inti `21ac62e`. Isi PR #1:

- **Plan synchronization** — perbarui `plans/2026-08-10-...-plan.md`: verifikasi matrix &
  acceptance criteria mencerminkan perilaku aktual (job rescheduling vs queued, callback
  action persistence untuk recognized actions).
- **Bigint helper** — `src/server/application/bigint-helper.ts` untuk konversi bigint →
  decimal string yang aman untuk PostgREST (64-bit Telegram ids). Dipakai konsisten di
  repositories (bot-user, callback-event, initial-session, session-policy, telegram-update).
- **Parser simplification** — `src/server/telegram/parser.ts` `bigintFromJson` disederhanakan
  menjadi `z.number().transform(BigInt)` (hapus union dengan `z.bigint()`). Input JSON number
  → output BigInt.
- **Messages** — prompt_received menjadi "Prompt diterima. Sedang dalam antrian...".
- **Dispatcher body** — `dispatchToProcessor` menerima payload opsional; webhook mengirim
  `{ sessionOrigin: "webhook" }`.
- **Script guard** — `scripts/set-telegram-webhook.mjs` menambah HTTPS validation + APP_ENV
  guard (tolak set webhook di production).
- **Test coverage** — tambahan test untuk idle/claim-error paths, update_id validation,
  unknown callback ack, dispatcher body; runbook `docs/runbooks/milestone-3-bootstrap.md`.

## Status

- Implementation done; commit PR #1 + test sync fixes (2026-08-13).
- Pending platform wiring (manual): Vercel Preview env vars, provisioning Telegram dev bot,
  seed allowlist admin SQL, set webhook, dispatch `migrate-development.yml`, E2E dev test.

## Verification

- `npm run lint`, `npm run typecheck` clean.
- `npm test` hijau setelah sync test parser (number-in fixtures) + webhook dispatcher assertion.
- `npm run format:check` bersih setelah whitespace fix.
