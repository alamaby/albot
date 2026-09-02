-- Prompt configs: DB-driven system-prompt persona (Milestone: prompt tunability without deploy).
--
-- Design:
-- - persona-only editable (JSON shape stays in code, see enhance-prompt.ts)
-- - versioned rows per key; exactly one active per key via partial unique index
-- - audit table + SECURITY DEFINER functions (service_role only) for create/activate
-- - strict-error semantics: callers fail if no active row (seeded v1 covers cold start)
-- - RLS enabled + forced on both tables, no api-role table privileges
-- - updated_at trigger on prompt_configs only (audit is append-only)

-- prompt_configs ------------------------------------------------------------
create table if not exists public.prompt_configs (
  id uuid not null default gen_random_uuid(),
  key text not null,
  body text not null,
  version integer not null,
  is_active boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_configs_pkey primary key (id),
  constraint prompt_configs_key_check check (length(btrim(key)) > 0),
  constraint prompt_configs_body_check check (length(btrim(body)) > 0 and char_length(body) <= 8000),
  constraint prompt_configs_version_check check (version > 0),
  constraint prompt_configs_key_version_key unique (key, version)
);

create unique index if not exists prompt_configs_one_active_idx
  on public.prompt_configs (key) where is_active;

create index if not exists prompt_configs_key_version_idx
  on public.prompt_configs (key, version desc);

-- updated_at trigger (mutable table)
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'prompt_configs_set_updated_at'
       and tgrelid = 'public.prompt_configs'::regclass
  ) then
    create trigger prompt_configs_set_updated_at
      before update on public.prompt_configs
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

-- prompt_configs_audit (append-only) --------------------------------------
create table if not exists public.prompt_configs_audit (
  id uuid not null default gen_random_uuid(),
  key text not null,
  version integer not null,
  action text not null,
  old_body text,
  new_body text,
  actor text,
  created_at timestamptz not null default now(),
  constraint prompt_configs_audit_pkey primary key (id),
  constraint prompt_configs_audit_action_check check (action in ('create', 'activate', 'deactivate', 'rollback'))
);

create index if not exists prompt_configs_audit_key_created_idx
  on public.prompt_configs_audit (key, created_at desc);

-- RLS + grants (service_role only; anon/authenticated denied) --------------
do $$
declare
  t text;
  tables text[] := array['prompt_configs', 'prompt_configs_audit'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end;
$$;

-- get_active_prompt_config: returns active body or null (no exception) -----
create or replace function public.get_active_prompt_config(p_key text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_body text;
begin
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'get_active_prompt_config: p_key must be non-empty';
  end if;
  select body into v_body
    from public.prompt_configs
   where key = p_key and is_active
   limit 1;
  return v_body;
end;
$$;

revoke all on function public.get_active_prompt_config(text) from public, anon, authenticated;
grant execute on function public.get_active_prompt_config(text) to service_role;

-- upsert_prompt_config: create next version, optionally activate -----------
create or replace function public.upsert_prompt_config(
  p_key text,
  p_body text,
  p_actor text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next_version integer;
  v_id uuid;
  v_old_active_id uuid;
  v_old_body text;
begin
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'upsert_prompt_config: p_key must be non-empty';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'upsert_prompt_config: p_body must be non-empty';
  end if;
  if char_length(p_body) > 8000 then
    raise exception 'upsert_prompt_config: p_body exceeds 8000 characters';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.prompt_configs where key = p_key;

  -- capture current active for audit deactivation note
  select id, body into v_old_active_id, v_old_body
    from public.prompt_configs where key = p_key and is_active limit 1;

  insert into public.prompt_configs (key, body, version, is_active, created_by)
  values (p_key, p_body, v_next_version, true, p_actor)
  returning id into v_id;

  -- deactivate previous active (the partial unique index guarantees one active;
  -- update to false on the old row after the new active exists keeps invariant)
  if v_old_active_id is not null then
    update public.prompt_configs set is_active = false where id = v_old_active_id;
    insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
    values (p_key, v_next_version - 1, 'deactivate', v_old_body, null, p_actor);
  end if;

  insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
  values (p_key, v_next_version, 'create', null, p_body, p_actor);

  insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
  values (p_key, v_next_version, 'activate', v_old_body, p_body, p_actor);

  return v_id;
end;
$$;

revoke all on function public.upsert_prompt_config(text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_prompt_config(text, text, text) to service_role;

-- activate_prompt_config: rollback/activate an existing version ------------
create or replace function public.activate_prompt_config(
  p_key text,
  p_version integer,
  p_actor text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target_id uuid;
  v_target_body text;
  v_old_active_id uuid;
  v_old_body text;
  v_old_version integer;
begin
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'activate_prompt_config: p_key must be non-empty';
  end if;
  if p_version is null or p_version < 1 then
    raise exception 'activate_prompt_config: p_version must be >= 1';
  end if;

  select id, body into v_target_id, v_target_body
    from public.prompt_configs where key = p_key and version = p_version limit 1;
  if v_target_id is null then
    raise exception 'activate_prompt_config: version % not found for key %', p_version, p_key;
  end if;

  select id, body, version into v_old_active_id, v_old_body, v_old_version
    from public.prompt_configs where key = p_key and is_active limit 1;

  if v_old_active_id = v_target_id then
    return v_target_id;
  end if;

  -- activate target first, then deactivate old so the partial unique index
  -- only ever sees at most one active during the transaction tail
  update public.prompt_configs set is_active = true where id = v_target_id;

  if v_old_active_id is not null then
    update public.prompt_configs set is_active = false where id = v_old_active_id;
    insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
    values (p_key, v_old_version, 'deactivate', v_old_body, null, p_actor);
  end if;

  insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
  values (p_key, p_version, 'rollback', v_old_body, v_target_body, p_actor);

  insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
  values (p_key, p_version, 'activate', v_old_body, v_target_body, p_actor);

  return v_target_id;
end;
$$;

revoke all on function public.activate_prompt_config(text, integer, text) from public, anon, authenticated;
grant execute on function public.activate_prompt_config(text, integer, text) to service_role;

-- Seed: enhancement_system_persona v1 (persona-only; JSON shape stays in code)
insert into public.prompt_configs (key, body, version, is_active, created_by)
values (
  'enhancement_system_persona',
  'You are a professional prompt engineer for an AI image generation bot.' || chr(10) ||
  'Rewrite the user''s prompt into a detailed, high-quality image generation prompt.',
  1,
  true,
  'system'
)
on conflict (key, version) do nothing;

-- seed audit row only if not already present (idempotent without unique constraint)
insert into public.prompt_configs_audit (key, version, action, old_body, new_body, actor)
select 'enhancement_system_persona', 1, 'create', null, body, 'system'
  from public.prompt_configs
 where key = 'enhancement_system_persona' and version = 1
   and not exists (
     select 1 from public.prompt_configs_audit
      where key = 'enhancement_system_persona' and version = 1 and action = 'create'
   );
