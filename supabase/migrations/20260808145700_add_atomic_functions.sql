-- Atomic functions for albot (Milestone 1)
--
-- Security posture:
-- - `security definer` with fixed search_path, schema-qualified references, and
--   input validation.
-- - Public EXECUTE revoked; only `service_role` may call these RPCs.
-- - Claims are transactional/atomic: `FOR UPDATE SKIP LOCKED` guarantees a single
--   owner per job even under concurrent workers.

-- claim_job ---------------------------------------------------------------------
-- Atomically claim the next deterministic due job for a worker.
-- Returns zero rows when nothing is claimable.
--
-- Contract:
-- - p_worker_id: required, non-blank, <= 128 chars.
-- - p_lease_seconds: lease duration (1..86400). Decision (see plan Notes):
--   bounded integer seconds rather than `interval` for clearer RPC validation.
-- - Claimable = not yet at max_attempts, due (available_at <= now()), no live
--   lease, and status queued/retry_scheduled, or processing with an expired lease.
create or replace function public.claim_job(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.jobs%rowtype;
begin
  if p_worker_id is null or length(btrim(p_worker_id)) = 0 then
    raise exception 'claim_job: worker id must not be blank';
  end if;
  if length(p_worker_id) > 128 then
    raise exception 'claim_job: worker id too long';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 86400 then
    raise exception 'claim_job: lease seconds must be between 1 and 86400';
  end if;

  select *
    into v_job
    from public.jobs
   where attempt_count < max_attempts
     and available_at <= now()
     and (locked_at is null or lease_expires_at <= now())
     and (status in ('queued', 'retry_scheduled')
          or (status = 'processing' and lease_expires_at <= now()))
   order by available_at, created_at, id
   limit 1
   for update skip locked;

  if not found then
    return;
  end if;

  update public.jobs
     set status = 'processing',
         attempt_count = attempt_count + 1,
         locked_at = now(),
         locked_by = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = v_job.id
   returning * into v_job;

  return next v_job;
end;
$$;

revoke all on function public.claim_job(text, integer) from public;
grant execute on function public.claim_job(text, integer) to service_role;

-- transition_prompt_session ------------------------------------------------------
-- Conditional (compare-and-set) transition on prompt_sessions.
-- Returns the updated row; returns zero rows when the expected status is stale
-- or the session is missing, without mutating data.
--
-- Contract:
-- - expected/new statuses must be in the same allowlist enforced by the table.
-- - Transition from a terminal status (completed/cancelled/expired) is rejected.
-- - Active pointer columns are updated only when explicitly supplied.
-- - completed_at is set once when transitioning to 'completed'.
create or replace function public.transition_prompt_session(
  p_session_id uuid,
  p_expected_status text,
  p_new_status text,
  p_active_revision_id uuid default null,
  p_active_generation_attempt_id uuid default null
)
returns setof public.prompt_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_allowed_statuses text[] := array[
    'received',
    'enhancing',
    'awaiting_confirmation',
    'awaiting_revision_input',
    'generating',
    'result_ready',
    'enhancement_failed',
    'generation_failed',
    'completed',
    'cancelled',
    'expired'
  ];
  v_terminal_statuses text[] := array['completed', 'cancelled', 'expired'];
  v_row public.prompt_sessions%rowtype;
begin
  if p_session_id is null then
    raise exception 'transition_prompt_session: session id required';
  end if;
  if p_expected_status is null
     or p_new_status is null
     or p_expected_status <> all (v_allowed_statuses)
     or p_new_status <> all (v_allowed_statuses) then
    raise exception 'transition_prompt_session: invalid status';
  end if;
  if p_expected_status = any (v_terminal_statuses) then
    raise exception 'transition_prompt_session: cannot transition from terminal status %', p_expected_status;
  end if;

  update public.prompt_sessions
     set status = p_new_status,
         active_revision_id = coalesce(p_active_revision_id, active_revision_id),
         active_generation_attempt_id = coalesce(p_active_generation_attempt_id, active_generation_attempt_id),
         completed_at = case
           when p_new_status = 'completed' then coalesce(completed_at, now())
           else completed_at
         end,
         updated_at = now()
   where id = p_session_id
     and status = p_expected_status
   returning * into v_row;

  if not found then
    return;
  end if;

  return next v_row;
end;
$$;

revoke all on function public.transition_prompt_session(uuid, text, text, uuid, uuid) from public;
grant execute on function public.transition_prompt_session(uuid, text, text, uuid, uuid) to service_role;
