-- Remove Pixazo PixelForge v2 provider config and dependents.
-- This provider never reached production and is intentionally removed per product decision.
-- All dependent rows are cleaned in dependency order to satisfy ON DELETE RESTRICT.
-- Pattern mirrors 20260820110000_remove_mock_image_generation_contract_configs.sql
-- to satisfy db:lint (destructive DML only inside a DO block).

do $$
declare
  v_config_ids uuid[];
begin
  select array_agg(id) into v_config_ids
    from public.provider_configs
   where adapter_type = 'pixazo_pixelforge_v2';

  if v_config_ids is null or array_length(v_config_ids, 1) = 0 then
    raise notice 'no pixazo_pixelforge_v2 configs to remove';
    return;
  end if;

  delete from public.user_image_preferences
   where preferred_provider_config_id = any (v_config_ids);

  update public.prompt_sessions
     set preferred_image_provider_config_id = null
   where preferred_image_provider_config_id = any (v_config_ids);

  update public.generation_attempts
     set image_provider_config_id = null
   where image_provider_config_id = any (v_config_ids);

  delete from public.provider_requests
   where provider_config_id = any (v_config_ids);

  delete from public.provider_keys
   where provider_config_id = any (v_config_ids);

  delete from public.provider_configs
   where id = any (v_config_ids);

  raise notice 'removed pixazo_pixelforge_v2 configs: %', array_length(v_config_ids, 1);
end;
$$;
