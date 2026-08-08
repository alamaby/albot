-- Function hardening and least-privilege grants (Milestone 1 remediation)
--
-- 1. claim_job: decouple lease recovery from available_at. Queued/retry_scheduled
--    jobs require available_at <= now(); a processing job whose lease expired is
--    recoverable based on lease expiry alone (a crashed worker may have scheduled
--    retry in the future and must not block recovery).
-- 2. transition_prompt_session: reject active pointers that do not belong to the
--    session (defense in depth alongside the composite FKs in migration 5).
-- 3. Grants: revoke direct table privileges from `public` as well, and revoke
--    EXECUTE on set_updated_at() from public/anon/authenticated.

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
     and (
       (status in ('queued', 'retry_scheduled') and available_at <= now())
       or (status = 'processing' and lease_expires_at <= now())
     )
     and (locked_at is null or lease_expires_at <= now())
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

revoke all on function public.claim_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_job(text, integer) to service_role;

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

  if p_active_revision_id is not null
     and not exists (
       select 1 from public.prompt_revisions
        where id = p_active_revision_id and session_id = p_session_id
     ) then
    raise exception 'transition_prompt_session: active revision does not belong to session';
  end if;
  if p_active_generation_attempt_id is not null
     and not exists (
       select 1 from public.generation_attempts
        where id = p_active_generation_attempt_id and session_id = p_session_id
     ) then
    raise exception 'transition_prompt_session: active generation attempt does not belong to session';
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

revoke all on function public.transition_prompt_session(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transition_prompt_session(uuid, text, text, uuid, uuid)
  to service_role;

-- set_updated_at is an internal trigger helper; API roles must not execute it
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- Explicitly revoke table privileges from `public` too (defense in depth)
do $$
declare
  t text;
  core_tables text[] := array[
    'bot_users',
    'provider_configs',
    'provider_keys',
    'prompt_sessions',
    'prompt_revisions',
    'generation_attempts',
    'jobs',
    'provider_requests',
    'telegram_updates',
    'callback_events',
    'job_events'
  ];
begin
  foreach t in array core_tables loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end;
$$;
