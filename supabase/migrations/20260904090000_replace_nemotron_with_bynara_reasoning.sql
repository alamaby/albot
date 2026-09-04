-- Replace Bynara nemotron-3-ultra reasoning (HTTP 400: model no longer
-- available on the router) with 5 new Bynara router reasoning models.
--
-- One adapter_type per model so the Telegram reasoning picker can resolve each
-- entry individually (the picker matches by adapter_type to the highest-
-- priority active config). All join the single round_robin reasoning group.
--
-- Additive and idempotent: DO block with WHERE NOT EXISTS on
-- (adapter_type, model, capability). Physical delete of nemotron is blocked by
-- FK (provider_keys, provider_requests, prompt_revisions), so it is
-- deactivated instead; audit history stays intact.

do $$
begin
  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'bynara_ag25' and model = 'agnes-2.5-flash' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'bynara_ag25', 'Bynara Agnes 2.5 Flash', 'https://router.bynara.id/v1', 'agnes-2.5-flash', '{}'::jsonb, 'round_robin', 162, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'bynara_mm3f' and model = 'minimax-m3-free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'bynara_mm3f', 'Bynara MiniMax M3 Free', 'https://router.bynara.id/v1', 'minimax-m3-free', '{}'::jsonb, 'round_robin', 163, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'bynara_mm35' and model = 'mistral-medium-3-5' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'bynara_mm35', 'Bynara Mistral Medium 3.5', 'https://router.bynara.id/v1', 'mistral-medium-3-5', '{}'::jsonb, 'round_robin', 164, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'bynara_ms12' and model = 'muse-spark-1.2-contributor-free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'bynara_ms12', 'Bynara Muse Spark 1.2', 'https://router.bynara.id/v1', 'muse-spark-1.2-contributor-free', '{}'::jsonb, 'round_robin', 165, 1, true);
  end if;

  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'bynara_qw38' and model = 'qwen3.8-27b' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'bynara_qw38', 'Bynara Qwen 3.8 27B', 'https://router.bynara.id/v1', 'qwen3.8-27b', '{}'::jsonb, 'round_robin', 166, 1, true);
  end if;

  -- Deactivate nemotron-3-ultra (model removed from the router; every call
  -- returns terminal HTTP 400). Kept as a row for FK-referenced audit history.
  update public.provider_configs
     set is_active = false,
         updated_at = now()
   where capability = 'reasoning'
     and adapter_type = 'bynara'
     and model = 'nemotron-3-ultra'
     and is_active;
end;
$$;
