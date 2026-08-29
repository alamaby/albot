-- Add OpenRouter MiniMax M3 Free (1M context) reasoning model.
--
-- Split out from the other 4 OpenRouter free models to keep migration files
-- small and to allow per-model rollout. Same round_robin strategy.

do $$
begin
  if not exists (
    select 1 from public.provider_configs
    where adapter_type = 'openrouter_m3' and model = 'minimax/minimax-m3:free' and capability = 'reasoning'
  ) then
    insert into public.provider_configs
      (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
    values
      ('reasoning', 'openrouter_m3', 'OpenRouter MiniMax M3 (free)', 'https://openrouter.ai/api/v1', 'minimax/minimax-m3:free', '{}'::jsonb, 'round_robin', 230, 1, true);
  end if;
end;
$$;
