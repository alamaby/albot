-- Recover stuck generating sessions where the active attempt has been processing > p_stuck_minutes.
-- Moves generation from orphaned `generating` + `processing` into terminal `generation_failed`
-- so the user can retry via Regenerate without manual SQL. Called by recovery cron every 20m.
-- Threshold 15m > 3x job lease (5m) to avoid false positives for slow providers.
-- Batch 25 is sufficient for production (max 3 claims per recovery run).

create or replace function public.recover_stuck_generating_sessions(
  p_max_sessions integer default 25,
  p_stuck_minutes integer default 15
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
      s.telegram_status_message_id,
      ga.id as attempt_id,
      ga.started_at
    from public.prompt_sessions s
    join public.generation_attempts ga
      on ga.session_id = s.id
     and ga.status = 'processing'
     and ga.started_at is not null
     and ga.started_at < now() - (p_stuck_minutes || ' minutes')::interval
    where s.status = 'generating'
      and s.expires_at > now()
    order by ga.started_at asc
    limit p_max_sessions
    for update of s skip locked
  loop
    -- Best-effort: mark the stale processing attempt as failed. Guarded RPC
    -- raises if not in processing; we swallow that and continue to session transition.
    begin
      perform public.mark_generation_attempt_failed(rec.attempt_id, 'stuck_processing_timeout', 'recovery: processing > ' || p_stuck_minutes || 'm');
    exception when others then
      -- already cleaned by concurrent recovery or callback cleanup; continue
      null;
    end;

    update public.prompt_sessions
       set status = 'generation_failed',
           updated_at = now()
     where id = rec.session_id
       and status = 'generating'
    returning * into v_sessions;

    if found then
      return next v_sessions;
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.recover_stuck_generating_sessions(integer, integer) from public, anon, authenticated;
grant execute on function public.recover_stuck_generating_sessions(integer, integer) to service_role;
