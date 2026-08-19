import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
  if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
}

const url = env.SUPABASE_URL_DEV ?? env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? env.SUPABASE_SERVICE_ROLE_KEY;
const c = createClient(url, key, { auth: { persistSession: false } });

// Deactivate leftover contract-test mock configs (adapter mock_image_generation_contract).
const { data: mocks } = await c
  .from("provider_configs")
  .select("id,adapter_type,is_active")
  .eq("adapter_type", "mock_image_generation_contract")
  .eq("is_active", true);
console.log("mock configs to deactivate:", mocks?.length ?? 0);
for (const m of mocks ?? []) {
  await c.from("provider_configs").update({ is_active: false }).eq("id", m.id);
}

// List active image configs after cleanup.
const { data: active } = await c
  .from("provider_configs")
  .select("id,adapter_type,name,is_active,priority")
  .eq("capability", "image_generation")
  .eq("is_active", true);
console.log("active image configs:", JSON.stringify(active, null, 2));

// Check keys for the Pixazo config.
const { data: keys } = await c
  .from("provider_keys")
  .select("id,provider_config_id,is_active,failure_count,cooldown_until,label")
  .eq("provider_config_id", "fcbf7bb8-c730-4d40-b7fc-0269975e6089");
console.log("pixazo keys:", JSON.stringify(keys, null, 2));
