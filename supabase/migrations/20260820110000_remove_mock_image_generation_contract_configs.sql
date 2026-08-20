-- Development-only cleanup (Milestone 5 residue).
--
-- The M5 generation contract test registers a test-only adapter type
-- `mock_image_generation_contract` and leaves an active config row in the
-- development database (priority 0, no key). The selector can pick it and
-- fail with provider_key_unavailable instead of failing over to a real
-- provider (plan 2026-08-19-milestone-5-closure, item 4).
--
-- This migration removes those config rows from dev only. Production has no
-- such adapter type, so the delete is a safe no-op there; the migration is
-- applied to development via the normal migrate-development workflow.
--
-- provider_configs is referenced with on-delete-restrict FKs from
-- provider_keys, provider_requests, generation_attempts
-- (image_provider_config_id) and prompt_revisions
-- (reasoning_provider_config_id), so child references are cleared first.

do $$
declare
  v_config_ids uuid[];
begin
  select array_agg(id) into v_config_ids
    from public.provider_configs
   where adapter_type = 'mock_image_generation_contract';

  if v_config_ids is null or array_length(v_config_ids, 1) = 0 then
    raise notice 'no mock_image_generation_contract configs to remove';
    return;
  end if;

  delete from public.provider_keys
   where provider_config_id = any (v_config_ids);

  delete from public.provider_requests
   where provider_config_id = any (v_config_ids);

  update public.generation_attempts
     set image_provider_config_id = null
   where image_provider_config_id = any (v_config_ids);

  update public.prompt_revisions
     set reasoning_provider_config_id = null
   where reasoning_provider_config_id = any (v_config_ids);

  delete from public.provider_configs
   where id = any (v_config_ids);

  raise notice 'removed mock_image_generation_contract configs: %', array_length(v_config_ids, 1);
end;
$$;
