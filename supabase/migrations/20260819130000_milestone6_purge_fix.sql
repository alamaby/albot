-- Milestone 6 review fix (additive, forward-fix).
--
-- 1. purge_expired_metadata: nulls the session active pointers BEFORE deleting
--    children. prompt_sessions.active_revision_id / active_generation_attempt_id
--    reference prompt_revisions / generation_attempts with on-delete-restrict
--    FKs and were never cleared when a session went terminal, so purging a
--    session that ever generated an image failed with an FK violation.
--    telegram_updates purge is now bounded by p_max_rows per run.
--
-- 2. expire_job_leases: comment-only documentation that lease recovery consumes
--    one attempt_count (sweep +1, then the re-claim +1), which is intentional
--    so crashed jobs cannot hot-loop forever.

-- purge_expired_metadata --------------------------------------------------------
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

  -- Null the session active pointers FIRST: they reference children with
  -- on-delete-restrict FKs, so children cannot be deleted while a session
  -- still points at them. Terminal sessions may lose their pointers at purge.
  update public.prompt_sessions
     set active_revision_id = null,
         active_generation_attempt_id = null
   where id in (select id from _purge_sessions);

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

  -- telegram_updates has no session FK; purge by age only, bounded per run so
  -- a single recovery call never deletes an unbounded number of rows.
  delete from public.telegram_updates
   where id in (select id
                  from public.telegram_updates
                 where received_at < v_cutoff
                 limit p_max_rows);
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

-- expire_job_leases -----------------------------------------------------------
-- Re-queues jobs whose lease has expired. Only touches processing jobs with an
-- expired lease and remaining attempt headroom (attempt_count < max_attempts)
-- so the attempt_count_max check is honored. Returns the recovered rows so the
-- application can record lease_expired job_events.
--
-- NOTE: lease recovery intentionally consumes one attempt_count (this sweep
-- increments it, and the next claim_job increments it again). A job whose
-- worker keeps crashing reaches max_attempts faster — this is deliberate so
-- crashed jobs cannot hot-loop forever.
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
