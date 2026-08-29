// Provider and key selector.
// Selects the best provider config and key for a given capability and request.
// Selection is deterministic and does not depend on process-local random state.
// Weighted selection uses a cumulative-prefix draw over total weight, driven by
// a stable hash of the selection seed (see C5).

import type {
  ProviderCapability,
  ProviderSelectionStrategy,
  ProviderKeySelectionStrategy,
  ProviderStrategy,
} from "@/server/domain/provider";
import type { ProviderConfigSafe } from "@/server/repositories/provider-config.repository";
import type { ProviderKeySafe } from "@/server/repositories/provider-key.repository";
import { makeNonRetryable } from "./errors";

export type SelectionStrategy = ProviderSelectionStrategy;
export type KeySelectionStrategy = ProviderKeySelectionStrategy;

export type SelectionOptions = {
  // Optional per-request seed (e.g. job/session id) that makes weighted draws
  // deterministic yet distributed across requests. Omit for a stable default.
  seed?: string;
};

export type SelectedProvider = {
  config: ProviderConfigSafe;
  key: ProviderKeySafe;
};

export class ProviderSelector {
  private readonly now: () => number; // injectable for testing

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  // Selects the provider config and key for a request.
  //
  // Two strategy dimensions are intentionally independent:
  // - `strategy` (caller-supplied) drives CONFIG selection: it picks among the
  //   active configs for the requested capability (`priority_failover` sorts by
  //   priority, `weighted` draws by config weight).
  // - `selected.selectionStrategy` (read from the DB row) drives KEY selection
  //   for the chosen config: `weighted` draws keys by their own weight, while
  //   `priority_failover` picks the least-recently-used eligible key.
  //
  // They may differ (e.g. a caller passing `priority_failover` can select a
  // config row whose `selection_strategy` is `weighted`). This is by design so
  // the DB row is the source of truth for how keys within a config are rotated.
  async selectProvider(
    capability: ProviderCapability,
    configs: ProviderConfigSafe[],
    keysByConfig: Map<string, ProviderKeySafe[]>,
    strategy: SelectionStrategy,
    options?: SelectionOptions,
  ): Promise<SelectedProvider> {
    const active = configs.filter((c) => c.isActive);

    if (active.length === 0) {
      throw makeNonRetryable(
        "provider_key_unavailable",
        "no active provider configs for capability",
      );
    }

    let selected: ProviderConfigSafe;
    let keys: ProviderKeySafe[] = [];
    const picked = this.pickConfigWithKey(active, keysByConfig, strategy, options?.seed);
    if (picked) {
      selected = picked.config;
      keys = picked.keys;
    } else {
      throw makeNonRetryable("provider_key_unavailable", "no provider config with an eligible key");
    }

    const eligible = keys.filter((k) => this.isKeyEligible(k));

    const key = this.selectKey(
      eligible,
      selected.selectionStrategy,
      this.keySeed(selected, options?.seed),
    );
    return { config: selected, key };
  }

  // Picks the first provider config that has at least one eligible key.
  // For priority_failover the order is priority then id (deterministic);
  // for weighted the drawn config comes first, then the remaining configs in
  // priority order as fallback. Returns null when no config has an eligible
  // key, so an active config without keys never blocks one that does.
  private pickConfigWithKey(
    active: ProviderConfigSafe[],
    keysByConfig: Map<string, ProviderKeySafe[]>,
    strategy: SelectionStrategy,
    seed?: string,
  ): { config: ProviderConfigSafe; keys: ProviderKeySafe[] } | null {
    const priorityOrdered = [...active].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    });

    const order =
      strategy === "priority_failover"
        ? priorityOrdered
        : strategy === "round_robin"
          ? this.roundRobinOrder(active, seed)
          : (() => {
              const drawn = this.selectWeighted(active, this.configSeed(active, seed));
              return [drawn, ...priorityOrdered.filter((c) => c.id !== drawn.id)];
            })();

    for (const candidate of order) {
      const candidateKeys = keysByConfig.get(candidate.id) ?? [];
      if (candidateKeys.some((k) => this.isKeyEligible(k))) {
        return { config: candidate, keys: candidateKeys };
      }
    }
    return null;
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

  // Key selection honors the config-level strategy that is reachable from a DB
  // row: `weighted` draws keys by their own `weight` (cumulative prefix), while
  // `priority_failover` picks the least-recently-used eligible key. The
  // `weighted_round_robin` branch is kept for explicit key-level strategy use.
  private selectKey(
    keys: ProviderKeySafe[],
    strategy: ProviderStrategy,
    seed: string,
  ): ProviderKeySafe {
    if (strategy === "weighted" || strategy === "weighted_round_robin") {
      const totalWeight = keys.reduce((sum, k) => sum + k.weight, 0);
      if (totalWeight <= 0) return keys[0];
      const point = Math.abs(this.hashString(seed)) % totalWeight;
      let cumulative = 0;
      for (const key of keys) {
        cumulative += key.weight;
        if (point < cumulative) return key;
      }
      return keys[keys.length - 1];
    }
    // Priority failover / round-robin by last use: first eligible key.
    return keys[0];
  }

  private selectWeighted(configs: ProviderConfigSafe[], seed: string): ProviderConfigSafe {
    const totalWeight = configs.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight <= 0) return configs[0];
    const point = Math.abs(this.hashString(seed)) % totalWeight;
    let cumulative = 0;
    for (const config of configs) {
      cumulative += config.weight;
      if (point < cumulative) return config;
    }
    return configs[configs.length - 1];
  }

  // Deterministic per-seed round-robin: hash the seed to pick a starting index
  // then walk the priority-ordered list cyclically. Same seed = same first
  // config (stable per session/user). Different seeds = different starting
  // positions = load spread across configs (no global counter needed).
  private roundRobinOrder(configs: ProviderConfigSafe[], seed?: string): ProviderConfigSafe[] {
    if (configs.length <= 1) return [...configs];
    const order = [...configs].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    });
    const start = seed ? Math.abs(this.hashString(seed)) % order.length : this.now() % order.length;
    return [...order.slice(start), ...order.slice(0, start)];
  }

  // Stable seed for config selection: request seed when provided, otherwise a
  // deterministic composite of the participating config ids so selection is
  // stable across serverless instances.
  private configSeed(configs: ProviderConfigSafe[], seed?: string): string {
    if (seed) return seed;
    const ids = [...configs.map((c) => c.id)].sort().join(":");
    return `albot/config/${ids}`;
  }

  // Stable seed for key selection scoped to the selected config so different
  // configs draw keys independently.
  private keySeed(config: ProviderConfigSafe, seed?: string): string {
    if (seed) return `${config.id}:${seed}`;
    return `albot/key/${config.id}`;
  }

  private hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h;
  }
}
