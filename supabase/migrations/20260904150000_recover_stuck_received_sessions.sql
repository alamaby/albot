-- Recover stuck received/enhancing sessions where the enhancement job never got claimed.
-- Moves orphaned `received` + `queued attempt 0` into terminal `enhancement_failed`
-- so the user gets a retry path without waiting for expires_at (24h) or manual SQL.
-- Called by recovery cron. Threshold 2m > dispatch timeout (5s) but < cron 20m so
-- a black-hole stuck is self-healed on the next sweep. Mirrors
-- recover_stuck_generating_sessions (20260902085338) but for the enhancement lane.
-- Batch 25 sufficient — matches other stuck guards.

create or replace function public.recover_stuck_received_sessions(
  p_max_sessions integer default 25,
  p_stuck_minutes integer default 2
)
returns setof public.prompt_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  rec record;
  v_sessions public.prompt_sessions%rowtype;
begin
  if p_max_sessions is null or p_max_sessions < 1 or p_max_sessions > 100 then
    raise exception 'p_max_sessions must be between 1 and 100';
  end if;
  if p_stuck_minutes is null or p_stuck_minutes < 1 or p_stuck_minutes > 1440 then
    raise exception 'p_stuck_minutes must be between 1 and 1440';
  end if;

  for rec in
    select
      s.id as session_id,
      s.telegram_chat_id,
      j.id as job_id,
      r.id as revision_id
    from public.prompt_sessions s
    join public.jobs j
      on j.prompt_session_id = s.id
     and j.status = 'queued'
     and j.attempt_count = 0
     and j.job_type = 'enhance_prompt'
    join public.prompt_revisions r
      on r.session_id = s.id
     and r.id = s.active_revision_id
     and r.status = 'pending'
    where s.status in ('received', 'enhancing')
      and s.expires_at > now()
      and s.created_at < now() - (p_stuck_minutes || ' minutes')::interval
    order by s.created_at asc
    limit p_max_sessions
    for update of s skip locked
  loop
    -- Best-effort: mark revision failed if still pending (no guard RPC — pending
    -- cannot be marked via mark_revision_failed which requires processing).
    begin
      update public.prompt_revisions
         set status = 'failed',
             completed_at = coalesce(completed_at, now())
       where id = rec.revision_id
         and status = 'pending';
    exception when others then
      null;
    end;

    begin
      update public.jobs
         set status = 'failed',
             last_error_code = 'stuck_received_timeout',
             last_error_message_redacted = 'recovery: received queued > ' || p_stuck_minutes || 'm',
             updated_at = now(),
             completed_at = coalesce(completed_at, now())
       where id = rec.job_id
         and status = 'queued';
    exception when others then
      null;
    end;

    update public.prompt_sessions
       set status = 'enhancement_failed',
           updated_at = now()
     where id = rec.session_id
       and status in ('received', 'enhancing')
    returning * into v_sessions;

    if found then
      return next v_sessions;
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.recover_stuck_received_sessions(integer, integer) from public, anon, authenticated;
grant execute on function public.recover_stuck_received_sessions(integer, integer) to service_role;
