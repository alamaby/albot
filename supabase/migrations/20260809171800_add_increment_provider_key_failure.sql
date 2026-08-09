-- Forward-fix migration (Milestone 2 review remediation, C4)
--
-- Atomic provider-key failure accounting.
-- Prior behavior in the server repository updated failure_count to a constant 1
-- and never set cooldown_until, so repeated failures could not be distinguished
-- from a single failure and failing keys were never cooled down.
--
-- This function atomically increments failure_count (single UPDATE, no
-- read-modify-write race), and once the count reaches the caller-supplied
-- threshold it sets cooldown_until with exponential backoff:
--   cooldown_minutes = 2^(failure_count - threshold), capped at 60.
--
-- Design note: failure_count is intentionally NOT reset to 0 on threshold hit so
-- the backoff escalates across consecutive failure cycles. A successful call
-- resets failure_count to 0 and clears cooldown (markSuccess contract).

create or replace function public.increment_provider_key_failure(
  p_provider_config_id uuid,
  p_key_id uuid,
  p_threshold integer
)
returns setof public.provider_keys
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_new_count integer;
begin
  if p_provider_config_id is null then
    raise exception 'increment_provider_key_failure: provider config id required';
  end if;
  if p_key_id is null then
    raise exception 'increment_provider_key_failure: key id required';
  end if;
  if p_threshold is null or p_threshold < 1 or p_threshold > 100 then
    raise exception 'increment_provider_key_failure: threshold must be between 1 and 100';
  end if;

  update public.provider_keys
     set failure_count = failure_count + 1
   where id = p_key_id
     and provider_config_id = p_provider_config_id
   returning failure_count into v_new_count;

  if not found then
    raise exception 'increment_provider_key_failure: key not found for provider config';
  end if;

  if v_new_count >= p_threshold then
    update public.provider_keys
       set cooldown_until = now() + make_interval(mins => least(power(2, v_new_count - p_threshold), 60)::int)
     where id = p_key_id
       and provider_config_id = p_provider_config_id;
  end if;

  return query
  select *
    from public.provider_keys
   where id = p_key_id
     and provider_config_id = p_provider_config_id;
end;
$$;

revoke all on function public.increment_provider_key_failure(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.increment_provider_key_failure(uuid, uuid, integer)
  to service_role;
