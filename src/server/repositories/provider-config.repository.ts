// Server-only provider config repository.
// All methods operate with the Supabase service role.
// Safe projections never include sensitive columns.

import { getSupabaseAdmin } from "@/server/supabase/admin";
import type { Database } from "@/server/supabase/database.types";

type Supabase = Database["public"]["Tables"];

export type ProviderConfigInput = {
  capability: "reasoning" | "image_generation";
  adapterType: string;
  name: string;
  baseUrl: string;
  model: string;
  settings: Record<string, unknown>;
  selectionStrategy: "priority_failover" | "weighted";
  priority: number;
  weight: number;
  isActive: boolean;
};

export type ProviderConfigSafe = {
  id: string;
  capability: string;
  adapterType: string;
  name: string;
  baseUrl: string;
  model: string;
  settings: Record<string, unknown>;
  selectionStrategy: string;
  priority: number;
  weight: number;
  isActive: boolean;
  configVersion: number;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderConfigRow = Supabase["provider_configs"]["Row"];
export type ProviderConfigInsert = Supabase["provider_configs"]["Insert"];

function mapRow(row: ProviderConfigRow): ProviderConfigSafe {
  return {
    id: row.id,
    capability: row.capability,
    adapterType: row.adapter_type,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model ?? "",
    settings: row.settings as Record<string, unknown>,
    selectionStrategy: row.selection_strategy,
    priority: row.priority,
    weight: row.weight,
    isActive: row.is_active,
    configVersion: row.config_version,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProviderConfigRepository {
  async listActive(capability: string): Promise<ProviderConfigSafe[]> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_configs")
      .select(
        "id, capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active, config_version, activated_at, created_at, updated_at",
      )
      .eq("capability", capability)
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(`provider config list failed: ${error.message}`);
    return (data ?? []).map(mapRow);
  }

  async getById(id: string): Promise<ProviderConfigSafe | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_configs")
      .select(
        "id, capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active, config_version, activated_at, created_at, updated_at",
      )
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw new Error(`provider config get failed: ${error.message}`);
    }
    return data ? mapRow(data) : null;
  }

  async insert(input: ProviderConfigInput): Promise<ProviderConfigSafe> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_configs")
      .insert({
        capability: input.capability,
        adapter_type: input.adapterType,
        name: input.name,
        base_url: input.baseUrl,
        model: input.model,
        settings: input.settings,
        selection_strategy: input.selectionStrategy,
        priority: input.priority,
        weight: input.weight,
        is_active: input.isActive,
      } as ProviderConfigInsert)
      .select(
        "id, capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active, config_version, activated_at, created_at, updated_at",
      )
      .single();

    if (error) throw new Error(`provider config insert failed: ${error.message}`);
    return mapRow(data!);
  }

  async activate(id: string): Promise<ProviderConfigSafe> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_configs")
      .update({ is_active: true })
      .eq("id", id)
      .select(
        "id, capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active, config_version, activated_at, created_at, updated_at",
      )
      .single();

    if (error) throw new Error(`provider config activate failed: ${error.message}`);
    return mapRow(data!);
  }

  async deactivate(id: string): Promise<ProviderConfigSafe> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("provider_configs")
      .update({ is_active: false })
      .eq("id", id)
      .select(
        "id, capability, adapter_type, name, base_url, model, settings, selection_strategy, priority, weight, is_active, config_version, activated_at, created_at, updated_at",
      )
      .single();

    if (error) throw new Error(`provider config deactivate failed: ${error.message}`);
    return mapRow(data!);
  }
}
