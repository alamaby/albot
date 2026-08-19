-- Milestone 6: reliability recovery primitives (additive).
--
-- 1. expire_job_leases: releases a lease that outlived its lease_expires_at
--    (worker crash / timeout) back to the queue. attempt_count is incremented
--    so the job is not hot-looped; claim_job still enforces max_attempts.
-- 2. mark_dead_jobs: terminal 'failed' state for jobs that can never be claimed
--    again (attempt_count >= max_attempts) while still queued/retry_scheduled,
--    or processing with an expired lease. Makes dead jobs discoverable.
-- 3. recover_stale_sessions: marks sessions whose expires_at passed as
--    'expired' (terminal), so the partial unique active-session index frees the
--    user slot and sweeps can notify the user.
-- 4. purge_expired_metadata: bounded, child-first deletion of terminal session
--    metadata older than the retention window. bot_users (allowlist) is never
--    deleted.

-- expire_job_leases -----------------------------------------------------------
-- Re-queues jobs whose lease has expired. Only touches processing jobs with an
-- expired lease and remaining attempt headroom (attempt_count < max_attempts)
-- so the attempt_count_max check is honored. Returns the recovered rows so the
-- application can record lease_expired job_events.
create or replace function public.expire_job_leases(
  p_max_jobs integer default 5
)
returns setof public.jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.jobs%rowtype;
  v_count integer := 0;
begin
  if p_max_jobs is null or p_max_jobs < 1 or p_max_jobs > 100 then
    raise exception 'expire_job_leases: max jobs must be between 1 and 100';
  end if;

  for v_job in
    select *
      from public.jobs
     where status = 'processing'
       and lease_expires_at is not null
       and lease_expires_at <= now()
       and attempt_count < max_attempts
     order by lease_expires_at, id
     limit p_max_jobs
     for update skip locked
  loop
    update public.jobs
       set status = 'queued',
           attempt_count = attempt_count + 1,
           available_at = now() + interval '1 minute',
           locked_at = null,
           locked_by = null,
           lease_expires_at = null,
           last_error_code = 'lease_expired',
           updated_at = now()
     where id = v_job.id;

    v_job.status := 'queued';
    v_job.attempt_count := v_job.attempt_count + 1;
    v_job.available_at := now() + interval '1 minute';
    v_job.locked_at := null;
    v_job.locked_by := null;
    v_job.lease_expires_at := null;
    v_job.last_error_code := 'lease_expired';

    return next v_job;
    v_count := v_count + 1;
    exit when v_count >= p_max_jobs;
  end loop;

  return;
end;
$$;

revoke all on function public.expire_job_leases(integer) from public, anon, authenticated;
grant execute on function public.expire_job_leases(integer) to service_role;

-- mark_dead_jobs ----------------------------------------------------------------
-- Terminal failure for jobs that will never be claimed again:
-- - queued/retry_scheduled with attempt_count >= max_attempts, or
-- - processing with an expired lease (no worker owns it anymore).
-- Live processing leases are left alone: the legitimate worker will complete
-- or fail the job. Returns the rows that were marked so the application can
-- record failed job_events.
create or replace function public.mark_dead_jobs(
  p_max_jobs integer default 25
)
returns setof public.jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.jobs%rowtype;
  v_count integer := 0;
begin
  if p_max_jobs is null or p_max_jobs < 1 or p_max_jobs > 500 then
    raise exception 'mark_dead_jobs: max jobs must be between 1 and 500';
  end if;

  for v_job in
    select *
      from public.jobs
     where (status in ('queued', 'retry_scheduled') and attempt_count >= max_attempts)
        or (status = 'processing'
            and lease_expires_at is not null
            and lease_expires_at <= now()
            and attempt_count >= max_attempts)
     order by updated_at, id
     limit p_max_jobs
     for update skip locked
  loop
    update public.jobs
       set status = 'failed',
           locked_at = null,
           locked_by = null,
           lease_expires_at = null,
           last_error_code = 'dead_job',
           last_error_message_redacted = 'max attempts exceeded or unrecoverable',
           completed_at = now(),
           updated_at = now()
     where id = v_job.id;

    v_job.status := 'failed';
    v_job.locked_at := null;
    v_job.locked_by := null;
    v_job.lease_expires_at := null;
    v_job.last_error_code := 'dead_job';
    v_job.last_error_message_redacted := 'max attempts exceeded or unrecoverable';
    v_job.completed_at := now();

    return next v_job;
    v_count := v_count + 1;
    exit when v_count >= p_max_jobs;
  end loop;

  return;
end;
$$;

revoke all on function public.mark_dead_jobs(integer) from public, anon, authenticated;
grant execute on function public.mark_dead_jobs(integer) to service_role;

-- recover_stale_sessions ---------------------------------------------------------
-- Marks non-terminal sessions whose expires_at has passed as 'expired'.
-- 'expired' is terminal, so the partial unique index
-- prompt_sessions_one_active_idx no longer counts the session as active.
create or replace function public.recover_stale_sessions(
  p_max_sessions integer default 100
)
returns setof public.prompt_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.prompt_sessions%rowtype;
  v_count integer := 0;
begin
  if p_max_sessions is null or p_max_sessions < 1 or p_max_sessions > 1000 then
    raise exception 'recover_stale_sessions: max sessions must be between 1 and 1000';
  end if;

  for v_session in
    select *
      from public.prompt_sessions
     where status not in ('completed', 'cancelled', 'expired')
       and expires_at <= now()
     order by expires_at, id
     limit p_max_sessions
     for update skip locked
  loop
    update public.prompt_sessions
       set status = 'expired',
           updated_at = now()
     where id = v_session.id;

    v_session.status := 'expired';

    return next v_session;
    v_count := v_count + 1;
    exit when v_count >= p_max_sessions;
  end loop;

  return;
end;
$$;

revoke all on function public.recover_stale_sessions(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_sessions(integer) to service_role;

-- purge_expired_metadata ----------------------------------------------------------
-- Deletes terminal session metadata older than the retention window, child-first
-- so FK constraints (all on delete restrict) are satisfied. Each DELETE is
-- bounded by p_max_rows so a single recovery run never blocks the database.
-- bot_users is never touched (permanent allowlist).
create or replace function public.purge_expired_metadata(
  p_retention_days integer default 30,
  p_max_rows integer default 1000
)
returns table (purged_rows bigint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cutoff timestamptz;
  v_total bigint := 0;
  v_deleted bigint;
begin
  if p_retention_days is null or p_retention_days < 1 or p_retention_days > 3650 then
    raise exception 'purge_expired_metadata: retention days must be between 1 and 3650';
  end if;
  if p_max_rows is null or p_max_rows < 1 or p_max_rows > 10000 then
    raise exception 'purge_expired_metadata: max rows must be between 1 and 10000';
  end if;

  v_cutoff := now() - make_interval(days => p_retention_days);

  -- Terminal sessions eligible for purge (their whole lineage goes with them).
  create temp table _purge_sessions on commit drop as
    select id
      from public.prompt_sessions
     where status in ('completed', 'cancelled', 'expired')
       and created_at < v_cutoff
     limit p_max_rows;

  delete from public.job_events
   where prompt_session_id in (select id from _purge_sessions)
      or job_id in (select id from public.jobs
                     where prompt_session_id in (select id from _purge_sessions));
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.provider_requests
   where job_id in (select id from public.jobs
                     where prompt_session_id in (select id from _purge_sessions));
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.jobs
   where prompt_session_id in (select id from _purge_sessions);
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.generation_attempts
   where session_id in (select id from _purge_sessions);
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.prompt_revisions
   where session_id in (select id from _purge_sessions);
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.callback_events
   where prompt_session_id in (select id from _purge_sessions);
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  -- telegram_updates has no session FK; purge by age only. Safe: update
  -- dedupe only needs rows around the delivery window (Telegram retries stop
  -- long before the retention cutoff).
  delete from public.telegram_updates
   where received_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.prompt_sessions
   where id in (select id from _purge_sessions);
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return query select v_total;
end;
$$;

revoke all on function public.purge_expired_metadata(integer, integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_metadata(integer, integer)
  to service_role;
