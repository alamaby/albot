-- Auto-expire stale sessions inside create_initial_session.
--
-- RCA (2026-08-28, prod): a session left in `result_ready` whose expires_at
-- passed blocked new prompts with duplicate key on the partial unique index
-- prompt_sessions_one_active_idx. The app guard (session-policy.repository.ts)
-- treats sessions as inactive once expires_at passes, so it allowed the
-- request, but the DB index counts status only (now() cannot appear in an
-- index predicate) and rejected the insert. The recovery sweep expires stale
-- sessions every 20 minutes, leaving a window where creation fails.
--
-- Fix: inside create_initial_session, first expire (status='expired') any
-- non-terminal session of the user whose expires_at has passed — the same
-- transition recover_stale_sessions performs — immediately before the insert.
-- This closes the race window completely for new-prompt creation.
--
-- Additive: create or replace on the newest 6-arg overload (20260826100000).
-- Behavior is unchanged when no stale session exists.

create or replace function public.create_initial_session(
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint,
  p_source_prompt text,
  p_update_id bigint,
  p_job_type text default 'enhance_prompt',
  p_enhanced_prompt text default null
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
  v_expires_at timestamptz := now() + interval '24 hours';
  v_is_direct boolean := p_enhanced_prompt is not null
    and length(btrim(p_enhanced_prompt)) > 0;
begin
  if p_telegram_user_id is null then
    raise exception 'create_initial_session: telegram_user_id required';
  end if;
  if p_telegram_chat_id is null then
    raise exception 'create_initial_session: telegram_chat_id required';
  end if;
  if p_update_id is null then
    raise exception 'create_initial_session: update_id required';
  end if;
  if p_source_prompt is null
     or length(btrim(p_source_prompt)) = 0
     or length(p_source_prompt) > 4000 then
    raise exception 'create_initial_session: source_prompt must be 1..4000 characters';
  end if;
  if p_enhanced_prompt is not null
     and (length(btrim(p_enhanced_prompt)) = 0
          or length(p_enhanced_prompt) > 4000) then
    raise exception 'create_initial_session: enhanced_prompt must be 1..4000 characters';
  end if;
  if p_job_type is null or length(btrim(p_job_type)) = 0 then
    raise exception 'create_initial_session: job_type required';
  end if;

  -- Expire the user's own stale non-terminal sessions (expires_at passed)
  -- so the one-active partial unique index cannot reject the new session
  -- before the 20-minute recovery sweep gets to them. Matches the transition
  -- recover_stale_sessions performs.
  update public.prompt_sessions
     set status = 'expired',
         updated_at = now()
   where telegram_user_id = p_telegram_user_id
     and status not in ('completed', 'cancelled', 'expired',
                        'enhancement_failed', 'generation_failed')
     and expires_at <= now();

  insert into public.prompt_sessions
    (telegram_user_id, telegram_chat_id, status, expires_at)
  values
    (p_telegram_user_id, p_telegram_chat_id,
     case when v_is_direct then 'generating' else 'received' end,
     v_expires_at)
  returning id into v_session_id;

  insert into public.prompt_revisions
    (session_id, revision_number, source_prompt, enhanced_prompt, status, completed_at)
  values
    (v_session_id, 1, p_source_prompt,
     case when v_is_direct then btrim(p_enhanced_prompt) end,
     case when v_is_direct then 'completed' else 'pending' end,
     case when v_is_direct then now() end)
  returning id into v_revision_id;

  update public.prompt_sessions
     set active_revision_id = v_revision_id
   where id = v_session_id;

  insert into public.jobs
    (job_type, prompt_session_id, prompt_revision_id, status, payload)
  values
    (case when v_is_direct then 'generate_image' else p_job_type end,
     v_session_id, v_revision_id, 'queued',
     jsonb_build_object(
       'telegram_user_id', p_telegram_user_id,
       'telegram_chat_id', p_telegram_chat_id,
       'update_id', p_update_id
     ))
  returning id into v_job_id;

  return query select v_session_id, v_revision_id, v_job_id;
end;
$$;

-- Keep function grants consistent (re-assert after create or replace).
revoke all on function public.create_initial_session(bigint, bigint, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.create_initial_session(bigint, bigint, text, bigint, text, text)
  to service_role;
