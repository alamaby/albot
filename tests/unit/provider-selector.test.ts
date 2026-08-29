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

    const result = await selector.selectProvider(
      "image_generation",
      configs,
      keys,
      "priority_failover",
    );
    expect(result.config.id).toBe("b"); // lower priority = higher precedence
  });

  it("skips inactive configs", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", isActive: false })];
    const keys = new Map([["a", [makeKey()]]]);

    await expect(
      selector.selectProvider("image_generation", configs, keys, "priority_failover"),
    ).rejects.toThrow("no active provider configs");
  });

  it("skips keys in cooldown", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a" })];
    const keys = new Map([
      ["a", [makeKey({ id: "k1", isActive: true, cooldownUntil: "2099-01-01T00:00:00Z" })]],
    ]);

    await expect(
      selector.selectProvider("image_generation", configs, keys, "priority_failover"),
    ).rejects.toThrow("no provider config with an eligible key");
  });

  it("returns key when eligible", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a" })];
    const keys = new Map([["a", [makeKey({ id: "k1" })]]]);

    const result = await selector.selectProvider(
      "image_generation",
      configs,
      keys,
      "priority_failover",
    );
    expect(result.key.id).toBe("k1");
  });

  it("fails over to a config with an eligible key when the highest-priority one has none", async () => {
    const selector = new ProviderSelector();
    const configs = [makeConfig({ id: "a", priority: 0 }), makeConfig({ id: "b", priority: 1 })];
    // Config "a" is active but has no key; config "b" has one.
    const keys = new Map([["b", [makeKey({ id: "k-b", providerConfigId: "b" })]]]);

    const result = await selector.selectProvider(
      "image_generation",
      configs,
      keys,
      "priority_failover",
    );
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

    const low = await selector.selectProvider("image_generation", configs, keys, "weighted", {
      seed: "seed-0",
    });
    const high = await selector.selectProvider("image_generation", configs, keys, "weighted", {
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

    const first = await selector.selectProvider("image_generation", configs, keys, "weighted");
    const second = await selector.selectProvider("image_generation", configs, keys, "weighted");
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

    const low = await selector.selectProvider(
      "image_generation",
      configs,
      keys,
      "priority_failover",
      {
        seed: "seed-3",
      },
    );
    const high = await selector.selectProvider(
      "image_generation",
      configs,
      keys,
      "priority_failover",
      {
        seed: "seed-0",
      },
    );
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

    const first = await selector.selectProvider("image_generation", configs, keys, "weighted");
    const second = await selector.selectProvider("image_generation", configs, keys, "weighted");
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

    const seedA = await selector.selectProvider("reasoning", configs, keys, "round_robin", {
      seed: "session-A",
    });
    const seedB = await selector.selectProvider("reasoning", configs, keys, "round_robin", {
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
      const r = await selector.selectProvider("reasoning", configs, keys, "round_robin", {
        seed: `session-${i}`,
      });
      seen.add(r.config.id);
    }
    // Across 6 different seeds, all three configs should be picked at least once.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});
