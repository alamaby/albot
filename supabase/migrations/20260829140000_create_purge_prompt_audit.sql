-- Cross-purge prompt audit table (180-day retention).
--
-- Independent of purge_expired_metadata (which only handles the 30-day
-- transactional tables). Captures per-stage prompt + provider_used so we
-- can investigate cross-purge events (after the 30-day window).
--
-- The table itself is created in <ts>_create_prompt_audit.sql; this
-- migration only adds the sweep function + grant + schedule hook.

create or replace function public.purge_prompt_audit(
  p_retention_days integer default 180,
  p_max_rows integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer := 0;
begin
  if p_retention_days is null or p_retention_days < 1 or p_retention_days > 3650 then
    raise exception 'purge_prompt_audit: retention_days must be between 1 and 3650';
  end if;
  if p_max_rows is null or p_max_rows < 1 or p_max_rows > 100000 then
    raise exception 'purge_prompt_audit: max_rows must be between 1 and 100000';
  end if;

  with del as (
    select id
    from public.prompt_audit
    where created_at < now() - make_interval(days => p_retention_days)
    order by created_at
    limit p_max_rows
    for update skip locked
  )
  delete from public.prompt_audit
   where id in (select id from del);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_prompt_audit(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_prompt_audit(integer, integer) to service_role;
