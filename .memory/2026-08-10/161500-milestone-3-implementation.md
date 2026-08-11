# Milestone 3: Telegram Intake and Durable Jobs

Created: 2026-08-10 15:01:49

## Objective

Milestone 3 implementasi webhook Telegram intake, secret validation, allowlist, rate-limit, active-session check, atomic session+revision+job creation via RPC, dan skeleton job processor.

## Decisions

- Dispatcher: inline fetch webhook → `/api/jobs/process` (fire-and-forget, recovery M7).
- Atomic creation: RPC `create_initial_session` security definer + service_role only.
- Rate limit + active session: derive dari `prompt_sessions` (no new table).
- Admin bootstrap: manual SQL seed di dev.

## Implementation

- Migration `20260810150719_create_initial_session.sql` — RPC + revoke anon/authenticated.
- `src/env.ts` — tambah `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`.
- `src/server/telegram/{webhook-auth,parser,client,messages}.ts`.
- `src/server/repositories/{bot-user,session-policy,telegram-update,callback-event,initial-session}.repository.ts`.
- `src/server/jobs/{auth,processor}.ts`.
- `src/server/application/handle-telegram-update.ts`.
- Routes: `src/app/api/telegram/webhook/route.ts` + `src/app/api/jobs/process/route.ts`.
- Script: `scripts/set-telegram-webhook.mjs`.
- Tests: unit (5 files), contract (2 files), schema.integration updated (8 migrations).

## Verification

- `npm run lint` — 0 errors/warnings.
- `npm run typecheck` — clean.
- `npm test` — **218 passed** (24 files).
- `npm run format:check` — clean.
- `npm run build` — clean.
- `npm run db:lint`, `db:check-migrations` (8), `db:types:check` — clean.
- Dev migration: 8/8 applied (Local==Remote).
- Production: 0 migrations untouched.

## Risks

- Inline dispatcher: job tetap `queued` jika fetch gagal; M7 recovery poll.
- Race active-session: toleransi concurrent (kedua user insert, yang kedua reject via message).
- Partial unique index `prompt_sessions(telegram_user_id) WHERE status NOT IN terminal` deferred to M6.

## Next

- Phase G (Vercel Preview wiring + Telegram bot setup) requires user action: set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET` di Vercel Preview env vars.
- Commit + push + run `migrate-development.yml` workflow.
