import { describe, expect, it } from "vitest";
import { ProviderSelector, type SelectionStrategy } from "@/server/providers/selector";
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
    ).rejects.toThrow("no eligible keys");
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
});
