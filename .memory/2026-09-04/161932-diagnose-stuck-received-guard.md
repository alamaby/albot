# Diagnose stuck session no-error feedback (2026-09-04 recovery guard)

## Task

Sesi terakhir prod `45209362-5594-4816-86c0-39241feafd73` stuck di `received` + `jobs:bcc4587a queued attempt 0` sejak `2026-09-04 08:06:45+00` — user di Telegram sudah lihat `Prompt diterima. Sedang dalam antrian...` tapi tidak pernah dapat error/retry (08:06-09:01 = 55-68m). User konfirmasi (3 poin): dispatch ok, secret tidak berubah, investigasi dulu (jangan auto-cancel). `after()` di processor dipertahankan per pilihan user.

## Key files changed

- `supabase/migrations/20260904150000_recover_stuck_received_sessions.sql` (baru): RPC `recover_stuck_received_sessions(p_max 25, p_stuck 2m)` — `received|enhancing + queued enhance_prompt attempt 0 + pending + created < now-2m + expires_at > now` → `revision failed + job failed stuck_received_timeout + session enhancement_failed`, `SKIP LOCKED`, `security definer` + grant `service_role` only (mirror `20260902085338_recover_stuck_generating_sessions.sql:1-72`).
- `src/server/repositories/recovery.repository.ts`: `recoverStuckReceivedSessions(max 25, stuck 2m)` wrapper (try/catch missing-function → `[]`, mirip `recoverStuckGeneratingSessions:50-68`).
- `src/server/jobs/recovery.ts`: `RECOVERY_BATCH_STUCK_RECEIVED=25` + `RECOVERY_STUCK_RECEIVED_MINUTES=2`, `RecoveryRunResult.recoveredStuckReceived`, sweep `1c` setelah stuck-generating `recovery.ts:82-114` + Telegram `retryKeyboard` `handle-telegram-update.ts` best-effort (`src/server/telegram/messages.ts:140` + `src/server/telegram/keyboards.ts:retryKeyboard`).
- `tests/integration/schema.integration.test.ts`: `EXPECTED_FUNCTIONS` + query `claim_job` `IN (...)` + `has_function_privilege` loop ditambah `recover_stuck_received_sessions(integer, integer)`, `EXPECTED_MIGRATIONS` + `20260904150000` (49 repo).
- `src/server/supabase/database.types.ts`: regen via `npx supabase gen types --project-id pcexxtckvwmiquseznaz --schema public` (prod) → `recover_stuck_received_sessions` types.
- `supabase/config.toml` re-linked to prod then back to dev (prod `pcexxtckvwmiquseznaz`, dev `ceqcitzbosqzxpbtlpfn`).
- `plans/2026-09-04-diagnose-stuck-session-no-error-feedback.md`: plan dibuat (objective self-heal ≤10s→2m, milestones Diagnosis/Feedback/Guard/Observability).

## Decisions

- RPC threshold `2m` (bukan `15m` generating): > `5s` dispatcher abort `handle-telegram-update.ts:125` + `300s` lease `processor.ts:33` tapi < `20m` cron `recovery-production.yml:5`, sehingga black-hole stuck self-heal di sweep berikutnya tanpa ubah `after()` di `src/app/api/jobs/process/route.ts:46`. `after()` tetap per user (trade-off latency vs durability — guard kompensasi).
- `session received|enhancing` guard cukup — tidak perlu `expired` sweep yang hanya jalan `expires_at` 24h `20260828120000_auto_expire...:36`.
- Manual `claim_job('diag-manual-15-55',300)` membuktikan job claimable (`processing attempt 1`) — bukan DB lock, melainkan H1 (dispatcher `idle` vs `claimed` tidak dibedakan) atau H2 (`after` hilang). Dibuktikan `service_role` `has_function_privilege true`, `anon false`.
- Tidak mutasi sesi `45209362` (instruksi investigasi dulu) — sesi akhirnya dipick recovery sweep `09:12` (`succeeded attempt 1`, `prompt_revisions completed`, `prompt_audit enhance_input/output ok`, `provider_requests reasoning succeeded` `826b7e9a...`, `prompt_sessions awaiting_confirmation`). RPC baru saat verifikasi return `[]` wajar.

## Assumptions / risks

- Cron `recovery-production.yml */20` tetap 20m — guard 2m mempersingkat stuck 20m→2m, load `FOR UPDATE SKIP LOCKED` naik tipis (batch 25). Risiko spam user jika pending normal <2m → mitigasi `SKIP LOCKED` + `created_at < now-2m` filter.
- Notifikasi Telegram best-effort: `sendMessageWithKeyboard` gagal → `warn recovery.notify_stuck_received_failed` + sweep idempotent.
- `query_logs` ClickHouse timeout (`Backend error! Retry`) — diagnosis mengandalkan `execute_sql` + manual `claim_job` + `pick` bukti, bukan full log scan.
- Migration dev `20260904150000` belum di-apply via workflow `migrate-development` (secrets `development` kosong — open blocker), tapi prod sudah via MCP `apply_migration` + dev via `recover_stuck_received_sessions_dev` (same body). `migration list` lokal vs remote drift 2 local-only (`20260904090000`, `20260904120000`, `20260904150000`).

## Blockers / unresolved

- `VERCEL_TOKEN` prod kosong (deploy-production 33733536728 gagal), `SUPABASE_ACCESS_TOKEN` dev kosong (migrate-development merah) — both waived per user, deploy manual `vercel --prod` proven.
- `npm run build` lokal: `EPERM symlink ..\\index.func` Windows EPERM (pre-existing, CI Linux ok); `typecheck` + `lint` hijau (2 pre-existing warnings).
- Prod `schema_migrations` versi: `20260904090215` duplicate file not in repo (prod file `20260904090000` timestamp mismatch) — not blocking.
- Sesi `45209362` now `awaiting_confirmation` — user perlu `Generate`/`Revise`/`Batal` next step.

## Verification

- `execute_sql` Q1-Q4: `payload update_id 270972179` + `telegram_updates processed_at null` + `has_function_privilege svc true` + manual `claim_job(diag) → processing 1` then rollback `queued 0` + `age_minutes 54→68` + `edge_logs` existence + job `succeeded 09:12` + revision `completed` + audit `enhance_input/output ok`.
- `apply_migration` prod `recover_stuck_received_sessions` success + dev `recover_stuck_received_sessions_dev` success + `generate_typescript_types` prod → `HAS`.
- `typecheck` `next typegen && tsc` ✓, `lint` 0 errors 2 pre-existing warnings, `build` compile pass (Vercel EPERM ignored), `migration list` local 20260904150000 present.

## Commit proposal

`fix(recovery): self-heal stuck received queued 0 via 2m guard and retry keyboard`

## Related

- Plan: `plans/2026-09-04-diagnose-stuck-session-no-error-feedback.md`
- Prev entry: `2026-09-04/120000-universal-prompt-configurability.md`
- Migration: `supabase/migrations/20260904150000_recover_stuck_received_sessions.sql`
