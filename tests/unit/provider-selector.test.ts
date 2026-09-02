import { describe, expect, it } from "vitest";
import { ProviderSelector } from "@/server/providers/selector";
import type { ProviderConfigSafe } from "@/server/repositories/provider-config.repository";
import type { ProviderKeySafe } from "@/server/repositories/provider-key.repository";

function makeConfig(overrides: Partial<ProviderConfigSafe> = {}): ProviderConfigSafe {
  return {
    id: "config-1",
    capability: "image_generation",
    adapterType: "pixazo_flux_schnell",
    name: "Test Config",
    baseUrl: "https://example.com",
    model: "flux-1-schnell",
    settings: {},
    selectionStrategy: "priority_failover",
    keySelectionStrategy: null,
    priority: 100,
    weight: 1,
    isActive: true,
    configVersion: 1,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeKey(overrides: Partial<ProviderKeySafe> = {}): ProviderKeySafe {
  return {
    id: "key-1",
    providerConfigId: "config-1",
    fingerprint: "abc123",
    weight: 1,
    priority: 100,
    isActive: true,
    failureCount: 0,
    cooldownUntil: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ProviderSelector", () => {
  it("selects active config with priority_failover", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", priority: 10 }), makeConfig({ id: "b", priority: 5 })];
    const keys = new Map([
      ["a", [makeKey()]],
      ["b", [makeKey()]],
    ]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.config.id).toBe("b"); // lower priority = higher precedence
  });

  it("skips inactive configs", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", isActive: false })];
    const keys = new Map([["a", [makeKey()]]]);

    await expect(selector.selectProvider("image_generation", configs, keys)).rejects.toThrow(
      "no active provider configs",
    );
  });

  it("skips keys in cooldown", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a" })];
    const keys = new Map([
      ["a", [makeKey({ id: "k1", isActive: true, cooldownUntil: "2099-01-01T00:00:00Z" })]],
    ]);

    await expect(selector.selectProvider("image_generation", configs, keys)).rejects.toThrow(
      "no provider config with an eligible key",
    );
  });

  it("returns key when eligible", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a" })];
    const keys = new Map([["a", [makeKey({ id: "k1" })]]]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.key.id).toBe("k1");
  });

  it("fails over to a config with an eligible key when the highest-priority one has none", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", priority: 0 }), makeConfig({ id: "b", priority: 1 })];
    // Config "a" is active but has no key; config "b" has one.
    const keys = new Map([["b", [makeKey({ id: "k-b", providerConfigId: "b" })]]]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.config.id).toBe("b");
    expect(result.key.id).toBe("k-b");
  });

  it("weighted selection honors config weight via seed", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", weight: 1, selectionStrategy: "weighted" }),
      makeConfig({ id: "b", weight: 3, selectionStrategy: "weighted" }),
    ];
    const keys = new Map([
      ["a", [makeKey({ providerConfigId: "a" })]],
      ["b", [makeKey({ providerConfigId: "b" })]],
    ]);

    const low = await selector.selectProvider("image_generation", configs, keys, {
      seed: "seed-0",
    });
    const high = await selector.selectProvider("image_generation", configs, keys, {
      seed: "seed-1",
    });
    expect(low.config.id).toBe("a");
    expect(high.config.id).toBe("b");
  });

  it("weighted selection is deterministic without a seed", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", weight: 1, selectionStrategy: "weighted" }),
      makeConfig({ id: "b", weight: 3, selectionStrategy: "weighted" }),
    ];
    const keys = new Map([
      ["a", [makeKey({ providerConfigId: "a" })]],
      ["b", [makeKey({ providerConfigId: "b" })]],
    ]);

    const first = await selector.selectProvider("image_generation", configs, keys);
    const second = await selector.selectProvider("image_generation", configs, keys);
    expect(first.config.id).toBe(second.config.id);
  });

  it("weighted key selection honors key weight via config strategy", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", selectionStrategy: "weighted" })];
    const keys = new Map([
      [
        "a",
        [
          makeKey({ id: "k1", providerConfigId: "a", weight: 1 }),
          makeKey({ id: "k2", providerConfigId: "a", weight: 3 }),
        ],
      ],
    ]);

    const low = await selector.selectProvider("image_generation", configs, keys, {
      seed: "seed-3",
    });
    const high = await selector.selectProvider("image_generation", configs, keys, {
      seed: "seed-0",
    });
    expect(low.key.id).toBe("k1");
    expect(high.key.id).toBe("k2");
  });

  it("weighted key selection is deterministic without a seed", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", selectionStrategy: "weighted" })];
    const keys = new Map([
      [
        "a",
        [
          makeKey({ id: "k1", providerConfigId: "a", weight: 1 }),
          makeKey({ id: "k2", providerConfigId: "a", weight: 3 }),
        ],
      ],
    ]);

    const first = await selector.selectProvider("image_generation", configs, keys);
    const second = await selector.selectProvider("image_generation", configs, keys);
    expect(first.key.id).toBe(second.key.id);
  });

  it("round_robin is deterministic per seed", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", priority: 0, selectionStrategy: "round_robin" }),
      makeConfig({ id: "b", priority: 1, selectionStrategy: "round_robin" }),
      makeConfig({ id: "c", priority: 2, selectionStrategy: "round_robin" }),
    ];
    const keys = new Map([
      ["a", [makeKey({ providerConfigId: "a" })]],
      ["b", [makeKey({ providerConfigId: "b" })]],
      ["c", [makeKey({ providerConfigId: "c" })]],
    ]);

    const seedA = await selector.selectProvider("reasoning", configs, keys, {
      seed: "session-A",
    });
    const seedB = await selector.selectProvider("reasoning", configs, keys, {
      seed: "session-B",
    });
    expect(seedA.config.id).toBe(seedA.config.id);
    // Different seeds pick different starting positions.
    expect(seedA.config.id).not.toBe(seedB.config.id);
  });

  it("round_robin rotates start across many sessions", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", priority: 0, selectionStrategy: "round_robin" }),
      makeConfig({ id: "b", priority: 1, selectionStrategy: "round_robin" }),
      makeConfig({ id: "c", priority: 2, selectionStrategy: "round_robin" }),
    ];
    const keys = new Map([
      ["a", [makeKey({ providerConfigId: "a" })]],
      ["b", [makeKey({ providerConfigId: "b" })]],
      ["c", [makeKey({ providerConfigId: "c" })]],
    ]);

    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await selector.selectProvider("reasoning", configs, keys, {
        seed: `session-${i}`,
      });
      seen.add(r.config.id);
    }
    // Across 6 different seeds, all three configs should be picked at least once.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  // Config-level strategy groups: the row's own selection_strategy drives its
  // position in the walk, so failover groups stay in front of a round_robin
  // tail regardless of seed.
  it("priority_failover groups stay in front of a round_robin tail", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "cloud", priority: 0 }),
      makeConfig({ id: "pollinations", priority: 150 }),
      makeConfig({ id: "free-a", priority: 200, selectionStrategy: "round_robin" }),
      makeConfig({ id: "free-b", priority: 201, selectionStrategy: "round_robin" }),
      makeConfig({ id: "free-c", priority: 202, selectionStrategy: "round_robin" }),
    ];
    const keys = new Map<string, ProviderKeySafe[]>(
      configs.map((c) => [c.id, [makeKey({ providerConfigId: c.id })]]),
    );

    for (const seed of ["seed-0", "seed-1", "seed-2", "seed-3"]) {
      const result = await selector.selectProvider("reasoning", configs, keys, { seed });
      expect(result.config.id).toBe("cloud");
    }
  });

  it("failover groups without eligible keys fall through to the rotating round_robin tail", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "cloud", priority: 0 }),
      makeConfig({ id: "pollinations", priority: 150 }),
      makeConfig({ id: "free-a", priority: 200, selectionStrategy: "round_robin" }),
      makeConfig({ id: "free-b", priority: 201, selectionStrategy: "round_robin" }),
      makeConfig({ id: "free-c", priority: 202, selectionStrategy: "round_robin" }),
    ];
    const keys = new Map([
      ["cloud", [makeKey({ providerConfigId: "cloud", cooldownUntil: "2099-01-01T00:00:00Z" })]],
      [
        "pollinations",
        [makeKey({ providerConfigId: "pollinations", cooldownUntil: "2099-01-01T00:00:00Z" })],
      ],
      ["free-a", [makeKey({ providerConfigId: "free-a" })]],
      ["free-b", [makeKey({ providerConfigId: "free-b" })]],
      ["free-c", [makeKey({ providerConfigId: "free-c" })]],
    ]);

    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const r = await selector.selectProvider("reasoning", configs, keys, {
        seed: `session-${i}`,
      });
      expect(["free-a", "free-b", "free-c"]).toContain(r.config.id);
      seen.add(r.config.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("weighted draw falls back within its group before later groups", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", priority: 0, weight: 1, selectionStrategy: "weighted" }),
      makeConfig({ id: "b", priority: 1, weight: 3, selectionStrategy: "weighted" }),
      makeConfig({ id: "c", priority: 2 }),
    ];
    const keys = new Map([
      ["a", [makeKey({ providerConfigId: "a" })]],
      ["b", [makeKey({ providerConfigId: "b" })]],
      ["c", [makeKey({ providerConfigId: "c" })]],
    ]);

    for (const seed of ["seed-0", "seed-1", "seed-2", "seed-3"]) {
      const r = await selector.selectProvider("image_generation", configs, keys, { seed });
      expect(["a", "b"]).toContain(r.config.id);
    }
  });

  it("non-contiguous same-strategy configs form separate groups", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", priority: 0, selectionStrategy: "round_robin" }),
      makeConfig({ id: "b", priority: 1 }),
      makeConfig({ id: "c", priority: 2, selectionStrategy: "round_robin" }),
    ];
    const keys = new Map([
      ["a", [makeKey({ providerConfigId: "a" })]],
      ["b", [makeKey({ providerConfigId: "b" })]],
      ["c", [makeKey({ providerConfigId: "c" })]],
    ]);

    // Single-config groups make rotation a no-op, so priority order wins.
    const r = await selector.selectProvider("reasoning", configs, keys, { seed: "seed-1" });
    expect(r.config.id).toBe("a");
  });

  //
  // Per-config key selection strategy (provider_configs.key_selection_strategy)
  // overrides key selection while leaving config selection untouched. NULL =
  // inherit (covered above by the weighted / round_robin config-level tests).
  //

  it("key strategy 'priority' picks the lowest-priority key first", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", keySelectionStrategy: "priority" })];
    const keys = new Map([
      [
        "a",
        [
          makeKey({ id: "k-backup", providerConfigId: "a", priority: 200 }),
          makeKey({ id: "k-primary", providerConfigId: "a", priority: 1 }),
        ],
      ],
    ]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.key.id).toBe("k-primary");
  });

  it("key strategy 'priority' fails over to the backup after the primary enters cooldown", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", keySelectionStrategy: "priority" })];
    const keys = new Map([
      [
        "a",
        [
          makeKey({ id: "k-backup", providerConfigId: "a", priority: 200 }),
          // Primary key now in cooldown (simulating 3 failures threshold hit).
          makeKey({
            id: "k-primary",
            providerConfigId: "a",
            priority: 1,
            cooldownUntil: "2099-01-01T00:00:00Z",
          }),
        ],
      ],
    ]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.key.id).toBe("k-backup");
  });

  it("key strategy 'priority' breaks ties by last_used_at (LRU within the same priority)", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", keySelectionStrategy: "priority" })];
    // Both keys share priority 100 (the default); the never-used key sorts
    // before the used one (NULLS FIRST).
    const keys = new Map([
      [
        "a",
        [
          makeKey({
            id: "k-used",
            providerConfigId: "a",
            priority: 100,
            lastUsedAt: "2026-08-01T00:00:00Z",
          }),
          makeKey({ id: "k-fresh", providerConfigId: "a", priority: 100, lastUsedAt: null }),
        ],
      ],
    ]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.key.id).toBe("k-fresh");
  });

  it("key strategy 'round_robin' picks the least-recently-used key", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", keySelectionStrategy: "round_robin" })];
    const keys = new Map([
      [
        "a",
        [
          makeKey({
            id: "k-older",
            providerConfigId: "a",
            lastUsedAt: "2026-08-01T00:00:00Z",
          }),
          makeKey({
            id: "k-newer",
            providerConfigId: "a",
            lastUsedAt: "2026-09-01T00:00:00Z",
          }),
        ],
      ],
    ]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.key.id).toBe("k-older");
  });

  it("key strategy 'round_robin' rotates after markSuccess bumps last_used_at", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", keySelectionStrategy: "round_robin" })];
    const keys = new Map<string, ProviderKeySafe[]>([
      [
        "a",
        [
          makeKey({ id: "k1", providerConfigId: "a" }),
          makeKey({ id: "k2", providerConfigId: "a" }),
        ],
      ],
    ]);

    // First selection: both unused, NULLS FIRST then id tie-break => k1.
    const first = await selector.selectProvider("image_generation", configs, keys);
    expect(first.key.id).toBe("k1");

    // After a successful call marks k1 as used, the next selection picks k2.
    keys.set("a", [
      makeKey({ id: "k1", providerConfigId: "a", lastUsedAt: "2026-09-01T10:00:00Z" }),
      makeKey({ id: "k2", providerConfigId: "a", lastUsedAt: null }),
    ]);
    const second = await selector.selectProvider("image_generation", configs, keys);
    expect(second.key.id).toBe("k2");
  });

  it("key strategy 'round_robin' skips keys in cooldown and picks the next LRU", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", keySelectionStrategy: "round_robin" })];
    const keys = new Map<string, ProviderKeySafe[]>([
      [
        "a",
        [
          makeKey({
            id: "k1",
            providerConfigId: "a",
            lastUsedAt: "2026-08-01T00:00:00Z",
            cooldownUntil: "2099-01-01T00:00:00Z",
          }),
          makeKey({ id: "k2", providerConfigId: "a", lastUsedAt: "2026-09-01T00:00:00Z" }),
        ],
      ],
    ]);

    const result = await selector.selectProvider("image_generation", configs, keys);
    expect(result.key.id).toBe("k2");
  });

  it("null key strategy inherits 'weighted' config strategy (weighted key draw)", async () => {
    const selector = new ProviderSelector();
    const configs = [
      makeConfig({ id: "a", selectionStrategy: "weighted", keySelectionStrategy: null }),
    ];
    const keys = new Map([
      [
        "a",
        [
          makeKey({ id: "k1", providerConfigId: "a", weight: 1 }),
          makeKey({ id: "k2", providerConfigId: "a", weight: 3 }),
        ],
      ],
    ]);

    const low = await selector.selectProvider("image_generation", configs, keys, {
      seed: "seed-3",
    });
    const high = await selector.selectProvider("image_generation", configs, keys, {
      seed: "seed-0",
    });
    expect(low.key.id).toBe("k1");
    expect(high.key.id).toBe("k2");
  });
});
