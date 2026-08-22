-- Pollinations fallback providers: reasoning gpt-oss priority 150, image flux priority 151
-- Use WHERE NOT EXISTS (no unique on adapter_type) for idempotency.

-- Reasoning: pollinations gpt-oss
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'reasoning', 'pollinations', 'Pollinations gpt-oss', 'https://gen.pollinations.ai/v1', 'gpt-oss', '{}'::jsonb, 'priority_failover', 150, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'pollinations' AND model = 'gpt-oss' AND capability = 'reasoning'
);

-- Image: pollinations flux
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'pollinations_image', 'Pollinations flux', 'https://gen.pollinations.ai/v1', 'flux', '{}'::jsonb, 'priority_failover', 151, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'pollinations_image' AND model = 'flux' AND capability = 'image_generation'
);
