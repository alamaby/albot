-- Forward-fix for create_revision (Milestone 4).
--
-- The original create_revision used an output parameter named `revision_number`
-- which collides with the table column of the same name inside the INSERT,
-- producing "column reference revision_number is ambiguous" (42702). Re-create
-- the function with `#variable_conflict use_column` so the INSERT resolves
-- `revision_number` to the table column while `v_next` keeps its own name.

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
