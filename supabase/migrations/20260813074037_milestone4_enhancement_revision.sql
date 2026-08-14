-- Milestone 4: enhancement + revision RPCs and session invariants (additive).
--
-- 1. mark_revision_failed: guard-patched terminal state on prompt_revisions so a
--    stale worker cannot overwrite a successfully completed revision.
-- 2. create_revision: atomically insert the next immutable revision for a
--    session (row-locked monotonic numbering) and repoint active_revision_id.
--    The caller drives the session status transition via transition_prompt_session.
-- 3. prompt_sessions_one_active_idx: enforce at most one non-terminal session per
--    user at the database level (complements the application-level guard).
-- 4. prompt_sessions_status_idx: supports status sweeps/recovery (M6).

-- mark_revision_failed ---------------------------------------------------------
create or replace function public.mark_revision_failed(
  p_revision_id uuid,
  p_error_code text,
  p_error_message_redacted text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_revision_id is null then
    raise exception 'mark_revision_failed: revision id required';
  end if;

  update public.prompt_revisions
     set status = 'failed',
         completed_at = now()
   where id = p_revision_id
     and status = 'processing';

  if not found then
    raise exception 'mark_revision_failed: revision is not in processing state';
  end if;
end;
$$;

revoke all on function public.mark_revision_failed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_revision_failed(uuid, text, text) to service_role;

-- create_revision ---------------------------------------------------------------
-- Inserts the next immutable revision for a session. The session row is locked
-- so concurrent callers cannot interleave numbering. Active pointer is repointed
-- to the new revision; the session status is intentionally left to the caller
-- (transition_prompt_session) so the RPC stays a single-purpose primitive.
create or replace function public.create_revision(
  p_session_id uuid,
  p_source_prompt text,
  p_previous_prompt text,
  p_revision_instruction text
)
returns table (revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next integer;
  v_revision_id uuid;
begin
  if p_session_id is null then
    raise exception 'create_revision: session id required';
  end if;
  if p_source_prompt is null or length(btrim(p_source_prompt)) = 0
     or length(p_source_prompt) > 4000 then
    raise exception 'create_revision: source prompt invalid length';
  end if;

  -- Row lock the session so concurrent revisions serialize on numbering.
  perform 1 from public.prompt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'create_revision: session not found';
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next
    from public.prompt_revisions
   where session_id = p_session_id;

  insert into public.prompt_revisions
    (session_id, revision_number, source_prompt, previous_prompt, revision_instruction, status)
  values
    (p_session_id, v_next, p_source_prompt, p_previous_prompt, p_revision_instruction, 'pending')
  returning id into v_revision_id;

  update public.prompt_sessions
     set active_revision_id = v_revision_id
   where id = p_session_id;

  return query select v_revision_id, v_next;
end;
$$;

revoke all on function public.create_revision(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_revision(uuid, text, text, text) to service_role;

-- Invariants -------------------------------------------------------------------
create unique index prompt_sessions_one_active_idx
  on public.prompt_sessions (telegram_user_id)
  where status not in ('completed', 'cancelled', 'expired');

create index prompt_sessions_status_idx
  on public.prompt_sessions (status, updated_at desc);
