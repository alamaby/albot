-- Milestone 5: generation attempt RPCs and session completion (additive).
--
-- 1. create_generation_attempt: atomically insert the next generation attempt
--    for a session (row-locked monotonic numbering), repoint
--    active_generation_attempt_id, and reject a new attempt while a previous
--    one is still active (queued/processing) — this is the DB-level guard
--    against double-click regenerate.
-- 2. mark_generation_attempt_failed: guard-patched terminal state so a stale
--    worker cannot overwrite a successfully completed attempt.
-- 3. mark_generation_attempt_succeeded: records provider_request_id and the
--    Telegram message id once delivery is confirmed.
-- 4. complete_prompt_session: terminal completion with guard against terminal
--    sources and in-flight generation.

-- create_generation_attempt ---------------------------------------------------
-- Inserts the next attempt for a session. The session row is locked so
-- concurrent callers cannot interleave numbering (same pattern as
-- create_revision). Active pointer is repointed to the new attempt; the session
-- status transition stays with the caller (transition_prompt_session).
create or replace function public.create_generation_attempt(
  p_session_id uuid,
  p_revision_id uuid
)
returns table (attempt_id uuid, attempt_number integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_next integer;
  v_attempt_id uuid;
begin
  if p_session_id is null then
    raise exception 'create_generation_attempt: session id required';
  end if;
  if p_revision_id is null then
    raise exception 'create_generation_attempt: revision id required';
  end if;

  -- Row lock the session so concurrent attempts serialize on numbering.
  perform 1 from public.prompt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'create_generation_attempt: session not found';
  end if;

  -- Reject a new attempt while a previous attempt is still active. The
  -- session must be in a generation-ready state (generating) before this
  -- RPC is called; the caller drives that via transition_prompt_session.
  if exists (
    select 1 from public.generation_attempts
     where session_id = p_session_id
       and status in ('queued', 'processing')
  ) then
    raise exception 'create_generation_attempt: generation already in progress';
  end if;

  -- The revision must belong to the session.
  if not exists (
    select 1 from public.prompt_revisions
     where id = p_revision_id and session_id = p_session_id
  ) then
    raise exception 'create_generation_attempt: revision does not belong to session';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_next
    from public.generation_attempts
   where session_id = p_session_id;

  insert into public.generation_attempts
    (session_id, revision_id, attempt_number, status)
  values
    (p_session_id, p_revision_id, v_next, 'queued')
  returning id into v_attempt_id;

  update public.prompt_sessions
     set active_generation_attempt_id = v_attempt_id
   where id = p_session_id;

  return query select v_attempt_id, v_next;
end;
$$;

revoke all on function public.create_generation_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_generation_attempt(uuid, uuid)
  to service_role;

-- mark_generation_attempt_failed -------------------------------------------------
-- Terminal failure with a processing-state guard (pattern of mark_revision_failed).
create or replace function public.mark_generation_attempt_failed(
  p_attempt_id uuid,
  p_error_code text,
  p_error_message_redacted text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_attempt_id is null then
    raise exception 'mark_generation_attempt_failed: attempt id required';
  end if;

  update public.generation_attempts
     set status = 'failed',
         error_code = p_error_code,
         error_message_redacted = p_error_message_redacted,
         completed_at = now()
   where id = p_attempt_id
     and status = 'processing';

  if not found then
    raise exception 'mark_generation_attempt_failed: attempt is not in processing state';
  end if;
end;
$$;

revoke all on function public.mark_generation_attempt_failed(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_generation_attempt_failed(uuid, text, text)
  to service_role;

-- mark_generation_attempt_succeeded ------------------------------------------------
-- Records a successful generation once Telegram delivery outcome is known.
create or replace function public.mark_generation_attempt_succeeded(
  p_attempt_id uuid,
  p_provider_request_id text,
  p_telegram_message_id bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_attempt_id is null then
    raise exception 'mark_generation_attempt_succeeded: attempt id required';
  end if;

  update public.generation_attempts
     set status = 'succeeded',
         provider_request_id = p_provider_request_id,
         telegram_message_id = p_telegram_message_id,
         completed_at = now()
   where id = p_attempt_id
     and status = 'processing';

  if not found then
    raise exception 'mark_generation_attempt_succeeded: attempt is not in processing state';
  end if;
end;
$$;

revoke all on function public.mark_generation_attempt_succeeded(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.mark_generation_attempt_succeeded(uuid, text, bigint)
  to service_role;

-- complete_prompt_session -----------------------------------------------------------
-- Terminal completion. Rejects completion from a terminal state or while a
-- generation attempt is still in flight so a stale result-action callback
-- cannot close a session that is mid-generation.
create or replace function public.complete_prompt_session(
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_terminal_statuses text[] := array['completed', 'cancelled', 'expired'];
begin
  if p_session_id is null then
    raise exception 'complete_prompt_session: session id required';
  end if;

  select status into v_status from public.prompt_sessions where id = p_session_id;
  if not found then
    raise exception 'complete_prompt_session: session not found';
  end if;

  if v_status = any (v_terminal_statuses) then
    raise exception 'complete_prompt_session: cannot complete from terminal status %', v_status;
  end if;

  if exists (
    select 1 from public.generation_attempts
     where session_id = p_session_id
       and status in ('queued', 'processing')
  ) then
    raise exception 'complete_prompt_session: generation still in progress';
  end if;

  update public.prompt_sessions
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         updated_at = now()
   where id = p_session_id;
end;
$$;

revoke all on function public.complete_prompt_session(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_prompt_session(uuid)
  to service_role;
