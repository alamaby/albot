-- Bynara providers: reasoning router laguna-s-2.1 & nemotron-3-ultra, image
-- generation agnes-image-2.0-flash & agnes-image-2.1-flash & grok-imagine &
-- nano-banana-pro. OpenAI-compatible endpoints (base_url without the action
-- suffix appended by the adapters).
-- Use WHERE NOT EXISTS (no unique on adapter_type) for idempotency.

-- Reasoning: bynara laguna-s-2.1
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'reasoning', 'bynara', 'Bynara laguna-s-2.1', 'https://router.bynara.id/v1', 'laguna-s-2.1', '{}'::jsonb, 'priority_failover', 160, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara' AND model = 'laguna-s-2.1' AND capability = 'reasoning'
);

-- Reasoning: bynara nemotron-3-ultra
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'reasoning', 'bynara', 'Bynara nemotron-3-ultra', 'https://router.bynara.id/v1', 'nemotron-3-ultra', '{}'::jsonb, 'priority_failover', 161, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara' AND model = 'nemotron-3-ultra' AND capability = 'reasoning'
);

-- Image: bynara agnes-image-2.0-flash
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_image', 'Bynara agnes-image-2.0-flash', 'https://api-images.bynara.id/v1', 'agnes-image-2.0-flash', '{}'::jsonb, 'priority_failover', 160, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_image' AND model = 'agnes-image-2.0-flash' AND capability = 'image_generation'
);

-- Image: bynara agnes-image-2.1-flash
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_image', 'Bynara agnes-image-2.1-flash', 'https://api-images.bynara.id/v1', 'agnes-image-2.1-flash', '{}'::jsonb, 'priority_failover', 161, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_image' AND model = 'agnes-image-2.1-flash' AND capability = 'image_generation'
);

-- Image: bynara grok-imagine
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_image', 'Bynara grok-imagine', 'https://api-images.bynara.id/v1', 'grok-imagine', '{}'::jsonb, 'priority_failover', 162, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_image' AND model = 'grok-imagine' AND capability = 'image_generation'
);

-- Image: bynara nano-banana-pro
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'bynara_image', 'Bynara nano-banana-pro', 'https://api-images.bynara.id/v1', 'nano-banana-pro', '{}'::jsonb, 'priority_failover', 163, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'bynara_image' AND model = 'nano-banana-pro' AND capability = 'image_generation'
);