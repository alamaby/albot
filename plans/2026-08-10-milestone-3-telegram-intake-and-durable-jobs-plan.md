# Milestone 3: Telegram Intake and Durable Jobs

Created: 2026-08-10 15:01:49

## Objective

Menerima Telegram update via webhook, validasi secret, dedupe, allowlist, rate limit, atomic create session+revision+enhancement job, dispatch ke `/api/jobs/process` (yang akan jadi kosong sampai M4). Inference tidak pernah berjalan di webhook.

## Scope

- Webhook route `/api/telegram/webhook` (POST only).
- Secret token validation (`X-Telegram-Bot-Api-Secret-Token`).
- Parse message + callback_query, reject group/channel.
- Allowlist check via `bot_users.telegram_user_id`.
- Prompt length + active session + rate limit (derived dari `prompt_sessions`).
- `telegram_updates` insert idempotent.
- RPC `create_initial_session` atomic.
- `/api/jobs/process` skeleton (verifies `JOB_PROCESSOR_SECRET`, claims via `claim_job`, returns 200 no-op).
- `scripts/set-telegram-webhook.ts` (set/delete/get).
- Inline dispatcher: webhook `fetch` ke `/api/jobs/process` setelah commit.
- `.env` baru: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`.
- `.env.example` + `docs/environment-variables.md` update.
- Workflow `validate.yml` unchanged (lint/typecheck/test/build/secret scan) — hosted manual via Vercel + Telegram.

## Out of Scope

- Inference execution (M4: reasoning provider).
- Callback action processing (M4).
- Dispatcher untuk long-running (M4/M5).
- Postgres trigger / pg_net (M6 jika adopt).
- Admin API/UI.
- Production webhook setup.
- Bot identity binding di webhook register (development/production isolated by Vercel env).

## Milestones

1. Phase A: Migration RPC `create_initial_session` + env secrets.
2. Phase B: Server modules (telegram auth/parser/client/messages, repositories, jobs skeleton).
3. Phase C: Routes (webhook + jobs/process + inline dispatcher).
4. Phase D: Scripts (`set-telegram-webhook.ts`) + runbook bootstrap.
5. Phase E: Tests (unit + contract).
6. Phase F: Verifikasi lokal + hosted.
7. Phase G: Vercel Preview wiring.
8. Phase H: Dokumentasi + handoff.

## Architectural Decisions

| Area | Decision | Rationale |
|---|---|---|
| Webhook auth | `X-Telegram-Bot-Api-Secret-Token` constant-time compare | Telegram-spec, no secret in URL. |
| HTTP method | POST only; else 405 | Telegram spec; reject noise. |
| Group/channel | Reject if `chat.type !== "private"` | V1 scope. |
| Update persistence | Insert `telegram_updates` row first; unique `update_id` blocks dup | Idempotent at DB level. |
| Callback persistence | Insert `callback_events` row; unique `callback_query_id` | Idempotent at DB level. |
| Atomic creation | RPC `create_initial_session(p_telegram_user_id, p_chat_id, p_source_prompt, p_update_id)` returns session+revision+job | Matches M1 pattern (definer, fixed search_path, service_role only). |
| Session lookup | `prompt_sessions` active = `status not in ('completed','cancelled','expired')` | No new table. |
| Rate limit | Count `prompt_sessions.created_at > now()-10min` untuk non-terminal session | Derive, no new table. |
| Active session | Single active per user invariant via WHERE on status set | No new table. |
| Dispatcher | Inline `fetch('/api/jobs/process', {secret})` setelah commit; errors logged but never fail webhook | Fire-and-forget for speed; dispatcher idempotent via claim. |
| Job processor skeleton | Single endpoint, verifies `JOB_PROCESSOR_SECRET`, claims via `claim_job`, returns claimed job (no execution in M3) | Reuses M1 RPC. M4 plugs in handlers. |
| Provider config for session | Default `reasoning_provider_config_id` dipilih saat enhancement (M4); tidak ada provider call di M3 | Enhancement failure gracefully surfaces di M4. |
| User onboarding | Manual SQL insert ke `bot_users` untuk allowlisted admin (runbook) | No admin API. |
| Webhook URL | `APP_ENV=development` → `set-telegram-webhook` ke Vercel Preview alias; production unset | Isolates env. |

## Session State (M3-relevant subset)

Insert `prompt_sessions` dengan `status='received'`. M3 tidak menjalankan inference; transition ke `enhancing` terjadi saat claim M4.

## Data Flow

```
Telegram → POST /api/telegram/webhook
  1. Method check (POST only)
  2. Constant-time secret compare
  3. Validate webhook body schema (zod)
  4. Reject if chat.type !== "private"
  5. INSERT telegram_updates (ON CONFLICT update_id DO NOTHING)
       → if no row inserted, return 200 (duplicate)
  6. Resolve numeric telegram_user_id; lookup bot_users
       → if not found OR is_allowed=false, send "access denied" + 200
  7. Rate limit check (count recent sessions) → if over, send "rate limit" + 200
  8. Active session check (count non-terminal) → if >0, send "session active" + 200
  9. Validate prompt length ≤ 4000
  10. RPC create_initial_session(...) → returns {sessionId, revisionId, jobId}
  11. Update telegram_updates.processed_at
  12. Inline fetch POST /api/jobs/process with {jobId} + JOB_PROCESSOR_SECRET
       (catch + log; never fail webhook)
  13. Return 200 (acknowledged)
```

Callback path M3: insert `callback_events` dan return 200 — tidak dispatch (M4 owns callback state machine).

## Components

### New files

- `src/app/api/telegram/webhook/route.ts` — Next.js webhook handler.
- `src/app/api/jobs/process/route.ts` — job processor skeleton.
- `src/server/telegram/webhook-auth.ts` — secret constant-time compare.
- `src/server/telegram/parser.ts` — narrow parsed message/callback shape.
- `src/server/telegram/client.ts` — thin `sendMessage`/`answerCallbackQuery` HTTP client.
- `src/server/telegram/messages.ts` — user-facing message builders (redacted errors).
- `src/server/repositories/telegram-update.repository.ts` — insert with dedupe.
- `src/server/repositories/callback-event.repository.ts` — insert with dedupe.
- `src/server/repositories/session-policy.repository.ts` — rate limit + active session queries.
- `src/server/repositories/bot-user.repository.ts` — lookup by `telegram_user_id`.
- `src/server/repositories/initial-session.repository.ts` — RPC wrapper.
- `src/server/jobs/auth.ts` — `JOB_PROCESSOR_SECRET` constant-time compare.
- `src/server/jobs/processor.ts` — claim + dispatch skeleton (handlers map; M4 plugs in).
- `scripts/set-telegram-webhook.ts` — setWebhook/set/deleteWebhook + getWebhookInfo.
- `supabase/migrations/<ts>_create_initial_session.sql` — RPC.
- `tests/unit/telegram-webhook.test.ts` — handler unit tests.
- `tests/unit/jobs-processor.test.ts` — secret validation + claim.
- `tests/contract/initial-session.contract.test.ts` — hosted RPC (creation + dedupe behaviour).
- `tests/contract/callback-event-dedupe.contract.test.ts` — hosted.

### Modified files

- `src/env.ts` — add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET` (zod).
- `.env.example` — section "Milestone 3".
- `docs/environment-variables.md` — secrets table.
- `src/server/supabase/database.types.ts` — regenerated from dev migration.

## RPC `create_initial_session`

```sql
create or replace function public.create_initial_session(
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_source_prompt text,
  p_update_id bigint,
  p_job_type text default 'enhance_prompt'
)
returns table (session_id uuid, revision_id uuid, job_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_id uuid;
  v_revision_id uuid;
  v_job_id uuid;
  v_expires_at timestamptz := now() + interval '30 minutes';
begin
  if p_telegram_user_id is null then raise exception 'telegram_user_id required'; end if;
  if p_telegram_chat_id is null then raise exception 'telegram_chat_id required'; end if;
  if p_source_prompt is null or length(btrim(p_source_prompt)) = 0
    or length(p_source_prompt) > 4000 then
    raise exception 'source_prompt invalid length';
  end if;
  if p_update_id is null then raise exception 'update_id required'; end if;
  if p_job_type is null or length(btrim(p_job_type)) = 0 then
    raise exception 'job_type required';
  end if;

  insert into public.prompt_sessions
    (telegram_user_id, telegram_chat_id, status, expires_at)
  values
    (p_telegram_user_id, p_telegram_chat_id, 'received', v_expires_at)
  returning id into v_session_id;

  insert into public.prompt_revisions
    (session_id, revision_number, source_prompt, status)
  values
    (v_session_id, 1, p_source_prompt, 'pending')
  returning id into v_revision_id;

  update public.prompt_sessions
    set active_revision_id = v_revision_id
  where id = v_session_id;

  insert into public.jobs
    (job_type, prompt_session_id, prompt_revision_id, status, payload)
  values
    (p_job_type, v_session_id, v_revision_id, 'queued',
     jsonb_build_object('telegram_user_id', p_telegram_user_id,
                        'telegram_chat_id', p_telegram_chat_id))
  returning id into v_job_id;

  return query select v_session_id, v_revision_id, v_job_id;
end;
$$;

revoke all on function public.create_initial_session(bigint, bigint, text, bigint, text) from public;
grant execute on function public.create_initial_session(bigint, bigint, text, bigint, text) to service_role;
```

## Webhook Handler (key behavior)

```ts
// src/server/telegram/webhook-auth.ts
import { timingSafeEqual } from "node:crypto";
export function verifyWebhookSecret(header: string | null, expected: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- Reject POST body > 1 MB (Telegram limit 25 MB, but lower reasonable).
- Zod schema for `Update`: `update_id`, `message?` (text only), `callback_query?`.
- Untuk `callback_query`: insert `callback_events` row, answer `answerCallbackQuery` ephemeral, return 200 — no job dispatch (M4).
- Untuk `message`: hanya handle private text; lainnya silently acknowledged.
- Send Telegram messages via `messages.sendAccessDenied(settings.telegramUserId, settings.lang)`. Never include token, key, env.

## Job Processor Skeleton

```ts
// src/server/jobs/processor.ts
export type JobHandler = (job: Job) => Promise<void>;
const handlers: Record<string, JobHandler> = {
  // M4: enhance_prompt: enhancePromptHandler,
};

export async function processClaimedJob(job: Job, workerId: string): Promise<void> {
  const handler = handlers[job.job_type];
  if (!handler) {
    // Unknown job type: mark failed (no retry)
    await markJobFailed(job.id, workerId, "unknown_job_type");
    return;
  }
  await handler(job);
}
```

M3 processor route: validate secret → call `claim_job` → if row, call `processClaimedJob` dan return `{status:'processed', jobId}`; jika no row, return `{status:'idle'}`.

## Telegram Client

Thin `fetch` wrappers, no SDK:

```ts
export async function sendMessage(token: string, chatId: number, text: string): Promise<void> { ... }
export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> { ... }
```

Timeouts 5s, no retries in webhook path (logging only). Token dari `getServerEnv()`, never logged.

## Webhook Setup Script

```ts
// scripts/set-telegram-webhook.ts
// usage:
//   tsx scripts/set-telegram-webhook.ts set   <bot_token> <url> <secret> [allowed_updates]
//   tsx scripts/set-telegram-webhook.ts get   <bot_token>
//   tsx scripts/set-telegram-webhook.ts delete <bot_token>
```

Resolves `APP_ENV` from env, reads Vercel alias dari `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_BRANCH_URL`, abort jika `APP_ENV=production` (harus manual per runbook).

## Tasks

### Phase A — Migration + Secrets

- [ ] A1: Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET` ke `src/env.ts` (zod schemas).
- [ ] A2: Update `.env.example` + `docs/environment-variables.md`.
- [ ] A3: Tulis migration `20260810_HHMMSS_create_initial_session.sql` (RPC).
- [ ] A4: Apply ke dev via `migrate-development.yml`; regen types.

### Phase B — Server modules

- [ ] B1: `src/server/telegram/webhook-auth.ts` (`verifyWebhookSecret` + unit test).
- [ ] B2: `src/server/telegram/parser.ts` (zod schemas + unit test).
- [ ] B3: `src/server/telegram/client.ts` + `messages.ts` + unit tests.
- [ ] B4: `src/server/repositories/{bot-user,session-policy,telegram-update,callback-event,initial-session}.repository.ts`.
- [ ] B5: `src/server/jobs/{auth,processor}.ts` skeleton.

### Phase C — Routes

- [ ] C1: `src/app/api/telegram/webhook/route.ts` (orchestration).
- [ ] C2: `src/app/api/jobs/process/route.ts` (secret + claim + dispatch).
- [ ] C3: Inline dispatcher in webhook handler (best-effort fetch).
- [ ] C4: Update `vercel.json` (jika Vercel route segment config diperlukan untuk body size).

### Phase D — Scripts

- [ ] D1: `scripts/set-telegram-webhook.ts` (set/get/delete).
- [ ] D2: Runbook entry: bootstrap allowlist user (manual SQL).

### Phase E — Tests

- [ ] E1: `tests/unit/telegram-webhook.test.ts` covering all branches in flow diagram.
- [ ] E2: `tests/unit/jobs-processor.test.ts` (secret valid/invalid, claim success/no-job).
- [ ] E3: `tests/contract/initial-session.contract.test.ts` (success, duplicate update_id dedupe, invalid prompt length).
- [ ] E4: `tests/contract/callback-event-dedupe.contract.test.ts`.

### Phase F — Verify local + hosted

- [ ] F1: `npm run lint`, `typecheck`, `test`, `format:check`, `build`.
- [ ] F2: `npm run test:hosted` (REQUIRE_HOSTED_TESTS=true) — 0 skip.
- [ ] F3: `npm run db:lint`, `db:check-migrations`, `db:types:check`.

### Phase G — Vercel Preview wiring

- [ ] G1: Set Preview env vars: `APP_ENV=development`, `TELEGRAM_BOT_TOKEN` (dev bot), `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`, `SUPABASE_URL=dev`, `SUPABASE_SERVICE_ROLE_KEY=dev`, `PROVIDER_KEY_ENCRYPTION_KEY=dev`.
- [ ] G2: Deploy Preview auto dari `main`.
- [ ] G3: `npm run set-telegram-webhook set <dev_token> <preview_url>/api/telegram/webhook <secret> message,callback_query`.
- [ ] G4: Send test prompt dari dev allowlisted user → verify di DB: `prompt_sessions` row, `prompt_revisions` row, `jobs` row, `telegram_updates` row.
- [ ] G5: Verify webhook latency < 1s (Vercel function logs).
- [ ] G6: Verify duplicate `update_id` produces no duplicate session.
- [ ] G7: Verify non-allowlisted user gets "access denied" Telegram message, no DB session.
- [ ] G8: Production Supabase & production bot untouched.

### Phase H — Documentation + handoff

- [ ] H1: Update `TODO.md` M3 progress.
- [ ] H2: Update `.memory/<ts>-milestone-3.md`.
- [ ] H3: Update `.memory/README.md`.
- [ ] H4: Run `migrate-development.yml` workflow → record run URL.
- [ ] H5: Commit + push.
- [ ] H6: Generate CM proposal: `feat(telegram): milestone 3 webhook + durable jobs`.

## Verification Matrix

| Scenario | Expected |
|---|---|
| Missing `X-Telegram-Bot-Api-Secret-Token` | 401, no DB row |
| Wrong secret | 401, no DB row |
| GET / PUT / DELETE | 405 |
| Group chat message | 200, no session, no job, log only |
| Non-allowlisted user | 200 + "access denied" message, no session, no job |
| Prompt > 4000 chars | 200 + "prompt too long" message, no session |
| Existing active session | 200 + "session active" message, no new session |
| Rate limit > 5/10min | 200 + "rate limit" message, no new session |
| Duplicate `update_id` | 200, no duplicate session/job |
| Valid prompt | 200 fast (< 1s), 1 session + 1 revision + 1 job row, dispatcher hits `/api/jobs/process` and gets `{status:'idle'}` (no handler yet) → job remains `queued` |
| Webhook → processor with wrong secret | 401, job stays queued |
| Webhook → processor with valid secret + no job | 200 `{status:'idle'}` |
| Callback_query (any) | 200, `callback_events` row, no job, no session |
| `answerCallbackQuery` logout | logged, doesn't fail webhook |

## Acceptance Criteria

- [ ] Webhook never waits for inference; response < 1s in Vercel logs.
- [ ] Duplicate `update_id` produces no duplicate session/revision/job.
- [ ] Non-allowlisted user cannot spawn session.
- [ ] Only `private` chat accepted.
- [ ] Callback queries persist but no job dispatched (deferred to M4).
- [ ] Length, active-session, rate-limit checks precede `create_initial_session`.
- [ ] New RPC `create_initial_session` is definer, fixed `search_path`, service_role only.
- [ ] `JOB_PROCESSOR_SECRET` validated constant-time.
- [ ] `TELEGRAM_WEBHOOK_SECRET` validated constant-time.
- [ ] Provider boundary: webhook handler doesn't import provider/`src/server/providers/**`; job processor doesn't import Telegram.
- [ ] Decoder/parser rejects payloads with `update_id` non-bigint or wrong shape (zod).
- [ ] Production Vercel + production bot + production Supabase untouched.
- [ ] All verification commands pass.

## Evidence Required

- Commit SHA(s).
- CI validate run URL.
- `migrate-development.yml` run URL (`Local==Remote` updated).
- Vercel Preview URL.
- `getWebhookInfo` (sanitized): pending_update_count, allowed_updates, url.
- DB rows (sanitized) proving 1 session, 1 revision, 1 job, 1 telegram_update per valid prompt.
- Duplicate test output (1 session despite 2 updates).
- Non-allowlist test output (0 session, "access denied" message sent).
- Webhook latency histogram (Vercel logs).
- Secret scan result.

## Risks

- **Telegram retries before processor fires** → dispatcher adalah best-effort; recovery poll di M7. M3 verified: jobs remain `queued` setelah dispatch no-op.
- **Webhook latency spike dari inline fetch** → 5s timeout, fire-and-forget; webhook return 200 within ~200ms typical.
- **Group/channel detection depends on `chat.type` field** → bot ditambahkan ke grup sebelum secret diset bisa lolos; mitigasi: secret required + group rejection.
- **RPC `create_initial_session` race condition** → dua update concurrent dengan user sama dapat masuk sebelum active-session check di aplikasi. Mitigasi: partial unique index `prompt_sessions(telegram_user_id) WHERE status NOT IN terminal` di M6. Untuk M3: receive-side check tolerates concurrent (keduanya insert, yang kedua reject user via Telegram response).
- **Vercel Hobby body limit (4.5MB)** → Telegram update max 25MB; kita tolak > 1MB di handler (M3 typical text < 100KB).
- **`APP_ENV` resolution on Vercel Preview** → Vercel Preview tidak set `VERCEL_ENV=production`; gunakan `APP_ENV=development` env var explicitly.
- **No inference in M3** → `enhance_prompt` job stays `queued`; verified dengan query setelah webhook test (status check).
- **Bootstrap admin manual** → lupa seed admin → tidak ada user yang bisa akses. Mitigasi: runbook preflight checklist + check `bot_users` count.

## Progress Log

- 2026-08-10 15:01:49 — Plan detail M3 dibuat. Keputusan dari user: dispatcher inline fetch, RPC `create_initial_session`, rate limit/active session derived dari `prompt_sessions`, bootstrap admin manual SQL seed. Implementasi belum dimulai.
- 2026-08-10 16:15:00 — Implementasi selesai. Semua verifikasi commands lulus: lint 0 warning, typecheck clean, 218 tests (24 files) pass, format:check clean, build clean, db:lint + db:check-migrations (8) + db:types:check clean. Dev migration applied (8/8 Local==Remote), production untouched (0 migrations). Commit `21ac62e` push ke origin/main.
- 2026-08-10 16:20:00 — M3 CODE DONE. Pending platform wiring: (1) set Vercel Preview env vars `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `JOB_PROCESSOR_SECRET`; (2) set Telegram dev bot webhook ke Vercel Preview alias via `scripts/set-telegram-webhook.mjs`; (3) seed allowlisted admin user via manual SQL; (4) dispatch `migrate-development.yml` workflow.

## Notes

- Domain bukan telecom/billing/payment; TOGAF proporsional.
- Tidak ada schema change selain RPC `create_initial_session` (additive migration).
- Conventional Commit proposal: `feat(telegram): milestone 3 webhook intake and durable jobs`.
