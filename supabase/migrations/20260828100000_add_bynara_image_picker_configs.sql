-- Bynara image picker models: one provider_config row per adapter_type so the
-- Telegram model picker can route by adapter_type (matches pixazo_flux_schnell /
-- pixazo_sdxl pattern). All four reuse the same OpenAI-compatible base URL
-- (api-images.bynara.id/v1) with distinct model values.
-- Use WHERE NOT EXISTS (no unique on adapter_type) for idempotency.

-- Image: bynara_a20f -> agnes-image-2.0-flash
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_a20f', 'Bynara agnes-2.0-flash (picker)', 'https://api-images.bynara.id/v1', 'agnes-image-2.0-flash', '{}'::jsonb, 'priority_failover', 200, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_a20f' AND model = 'agnes-image-2.0-flash' AND capability = 'image_generation'
);

-- Image: bynara_a21f -> agnes-image-2.1-flash
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_a21f', 'Bynara agnes-2.1-flash (picker)', 'https://api-images.bynara.id/v1', 'agnes-image-2.1-flash', '{}'::jsonb, 'priority_failover', 201, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_a21f' AND model = 'agnes-image-2.1-flash' AND capability = 'image_generation'
);

-- Image: bynara_grok -> grok-imagine
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_grok', 'Bynara grok-imagine (picker)', 'https://api-images.bynara.id/v1', 'grok-imagine', '{}'::jsonb, 'priority_failover', 202, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_grok' AND model = 'grok-imagine' AND capability = 'image_generation'
);

-- Image: bynara_nbn -> nano-banana-pro
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_nbn', 'Bynara nano-banana-pro (picker)', 'https://api-images.bynara.id/v1', 'nano-banana-pro', '{}'::jsonb, 'priority_failover', 203, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_nbn' AND model = 'nano-banana-pro' AND capability = 'image_generation'
);