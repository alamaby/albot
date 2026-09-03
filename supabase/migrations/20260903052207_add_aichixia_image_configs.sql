-- Aichixia image provider (www.aichixia.xyz/api/v1). One provider_config row per
-- model so the Telegram model picker can route by adapter_type (matches the
-- bynara_a20f/a21f/grok/nbn picker pattern). b64_json responses, OpenAI-style
-- request body.
--
-- Priority placement: Pixazo (0/5) -> Aichixia (110-113) -> Pollinations (151)
-- -> Bynara image (160+). Priority is lower-first in the selector.
-- Use WHERE NOT EXISTS (no unique on adapter_type) for idempotency.
--
-- NOTE: this file is named after the version recorded on hosted development
-- by an MCP apply_migration (which records a UTC apply-time version instead of
-- a file timestamp). The DML is idempotent so `supabase db push` can safely
-- re-apply it on a fresh database.

-- Image: aichixia_flux2 -> flux-2-dev
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'aichixia_flux2', 'Aichixia Flux 2 Dev', 'https://www.aichixia.xyz/api/v1', 'flux-2-dev', '{}'::jsonb, 'priority_failover', 110, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'aichixia_flux2' AND model = 'flux-2-dev' AND capability = 'image_generation'
);

-- Image: aichixia_lucid -> lucid-origin
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'aichixia_lucid', 'Aichixia Lucid Origin', 'https://www.aichixia.xyz/api/v1', 'lucid-origin', '{}'::jsonb, 'priority_failover', 111, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'aichixia_lucid' AND model = 'lucid-origin' AND capability = 'image_generation'
);

-- Image: aichixia_phoenix -> phoenix-1.0
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'aichixia_phoenix', 'Aichixia Phoenix 1.0', 'https://www.aichixia.xyz/api/v1', 'phoenix-1.0', '{}'::jsonb, 'priority_failover', 112, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'aichixia_phoenix' AND model = 'phoenix-1.0' AND capability = 'image_generation'
);

-- Image: aichixia_gemini -> gemini-3-pro-image
INSERT INTO provider_configs (capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active)
SELECT 'image_generation', 'aichixia_gemini', 'Aichixia Gemini 3 Pro Image', 'https://www.aichixia.xyz/api/v1', 'gemini-3-pro-image', '{}'::jsonb, 'priority_failover', 113, 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM provider_configs WHERE adapter_type = 'aichixia_gemini' AND model = 'gemini-3-pro-image' AND capability = 'image_generation'
);
