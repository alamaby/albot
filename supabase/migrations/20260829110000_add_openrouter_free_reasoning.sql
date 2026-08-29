-- Add 4 OpenRouter Free reasoning models (excludes openrouter_m3, added in
-- a separate migration to keep file sizes small for review).
--
-- Strategy: round_robin so sessions distribute across the 4 free models
-- instead of hitting the same one every time (free tiers rate-limit).
-- All 4 share the same OPENROUTER_API_KEY (single env var, single key
-- in provider_keys rows, multiple adapter_types).
--
-- Additive and idempotent: WHERE NOT EXISTS on (adapter_type, model, capability).

do $$
begin
  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'openrouter_free' and model = 'openrouter/free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'openrouter_free', 'OpenRouter Free Router', 'https://openrouter.ai/api/v1', 'openrouter/free', '{}'::jsonb, 'round_robin', 200, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'openrouter_ing' and model = 'inclusionai/ling-3.0-flash-fin:free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'openrouter_ing', 'OpenRouter Ling 3.0 Flash Fin (free)', 'https://openrouter.ai/api/v1', 'inclusionai/ling-3.0-flash-fin:free', '{}'::jsonb, 'round_robin', 201, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'openrouter_laguna' and model = 'poolside/laguna-s-2.1:free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'openrouter_laguna', 'OpenRouter Laguna S 2.1 (free)', 'https://openrouter.ai/api/v1', 'poolside/laguna-s-2.1:free', '{}'::jsonb, 'round_robin', 202, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'openrouter_glm' and model = 'z-ai/glm-5.2:free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'openrouter_glm', 'OpenRouter GLM 5.2 (free)', 'https://openrouter.ai/api/v1', 'z-ai/glm-5.2:free', '{}'::jsonb, 'round_robin', 203, 1, true);
  end if;
end;
$$;
