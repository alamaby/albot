-- Forward-fix: create_revision accepts an explicit instruction_kind so the
-- caller can mark a revision as 'revision' (revision-input flow) or leave
-- default 'source' (first prompt).
--
-- Why this matters: the revision-input use case currently writes the
-- user instruction into p_source_prompt and leaves p_revision_instruction
-- null, which is the same shape as a first prompt. instruction_kind makes
-- the lineage explicit and lets the audit / admin view distinguish them
-- without relying on revision_number.

create or replace function public.create_revision(
  p_session_id uuid,
  p_source_prompt text,
  p_previous_prompt text,
  p_revision_instruction text,
  p_instruction_kind text default 'source'
)
returns table (revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
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
  if p_instruction_kind is null
     or p_instruction_kind not in ('source', 'revision') then
    raise exception 'create_revision: instruction_kind must be source or revision';
  end if;

  perform 1 from public.prompt_sessions where id = p_session_id for update;
  if not found then
    raise exception 'create_revision: session not found';
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next
    from public.prompt_revisions
   where session_id = p_session_id;

  insert into public.prompt_revisions
    (session_id, revision_number, source_prompt, previous_prompt, revision_instruction, status, instruction_kind)
  values
    (p_session_id, v_next, p_source_prompt, p_previous_prompt, p_revision_instruction, 'pending', p_instruction_kind)
  returning id into v_revision_id;

  update public.prompt_sessions
     set active_revision_id = v_revision_id
   where id = p_session_id;

  return query select v_revision_id, v_next;
end;
$$;

-- Old 4-arg signature still callable for rolling-deploy safety (creates an
-- overload with default p_instruction_kind = 'source' for legacy callers).
-- The new 5-arg version above is the one the TypeScript repo will use.

revoke all on function public.create_revision(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_revision(uuid, text, text, text, text) to service_role;

-- The original 4-arg overload remains (different signature), so nothing breaks
-- for any pre-deploy caller. Post-deploy, future migrations may drop the
-- legacy 4-arg version once a code search confirms no callers remain.
