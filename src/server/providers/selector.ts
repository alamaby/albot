// Provider and key selector.
// Selects the best provider config and key for a given capability and request.
// Selection is deterministic and does not depend on process-local random state.

import type { ProviderCapability } from "@/server/domain/provider";
import type { ProviderConfigSafe } from "@/server/repositories/provider-config.repository";
import type { ProviderKeySafe } from "@/server/repositories/provider-key.repository";
import { ProviderError, makeRetryable, makeNonRetryable } from "./errors";

export type SelectionStrategy = "priority_failover" | "weighted";

export type SelectedProvider = {
  config: ProviderConfigSafe;
  key: ProviderKeySafe;
};

export class ProviderSelector {
  private readonly now: () => number; // injectable for testing

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  async selectProvider(
    capability: ProviderCapability,
    configs: ProviderConfigSafe[],
    keysByConfig: Map<string, ProviderKeySafe[]>,
    strategy: SelectionStrategy,
  ): Promise<SelectedProvider> {
    const active = configs.filter((c) => c.isActive);

    if (active.length === 0) {
      throw makeNonRetryable(
        "provider_key_unavailable",
        "no active provider configs for capability",
      );
    }

    let selected: ProviderConfigSafe;

    if (strategy === "priority_failover") {
      // Sort by priority ascending (lower = higher priority), then by id for stability.
      const sorted = [...active].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id);
      });
      selected = sorted[0];
    } else {
      // Weighted selection: deterministic hash-based selection across active configs.
      selected = this.selectWeighted(active);
    }

    const keys = keysByConfig.get(selected.id) ?? [];
    const eligible = keys.filter((k) => this.isKeyEligible(k));

    if (eligible.length === 0) {
      throw makeNonRetryable("provider_key_unavailable", "no eligible keys for selected provider");
    }

    const key = this.selectKey(eligible, selected.selectionStrategy);
    return { config: selected, key };
  }

  private isKeyEligible(key: ProviderKeySafe): boolean {
    if (!key.isActive) return false;
    if (key.cooldownUntil) {
      const nowMs = this.now();
      const cooldownMs = new Date(key.cooldownUntil).getTime();
      if (cooldownMs > nowMs) return false;
    }
    return true;
  }

  private selectKey(keys: ProviderKeySafe[], strategy: string): ProviderKeySafe {
    if (strategy === "weighted_round_robin") {
      // Deterministic weighted selection based on key weight.
      const totalWeight = keys.reduce((sum, k) => sum + k.weight, 0);
      if (totalWeight === 0) return keys[0];
      // Use a stable hash of the provider config id to pick deterministically.
      const hash = this.hashString(keys[0].providerConfigId);
      const idx = hash % keys.length;
      return keys[idx];
    }
    // Default: round-robin by insertion order (first eligible key).
    return keys[0];
  }

  private selectWeighted(configs: ProviderConfigSafe[]): ProviderConfigSafe {
    const totalWeight = configs.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight === 0) return configs[0];
    const hash = this.hashString(configs[0].id);
    const idx = hash % configs.length;
    return configs[idx];
  }

  private hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }
}
