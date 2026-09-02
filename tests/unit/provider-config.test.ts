import { describe, expect, it } from "vitest";
import { validateProviderConfigInput } from "@/server/providers/config";

const validInput = {
  capability: "image_generation",
  adapterType: "pixazo_flux_schnell",
  name: "Pixazo Flux",
  baseUrl: "https://gateway.pixazo.ai/flux-1-schnell/v1/getData",
  model: "flux-1-schnell",
  settings: { timeout_ms: 120000 },
  selectionStrategy: "priority_failover",
  priority: 100,
  weight: 1,
  isActive: true,
};

describe("validateProviderConfigInput", () => {
  it("accepts a valid provider config", () => {
    const parsed = validateProviderConfigInput(validInput);
    expect(parsed.capability).toBe("image_generation");
    expect(parsed.baseUrl).toBe("https://gateway.pixazo.ai/flux-1-schnell/v1/getData");
  });

  it("rejects an invalid capability", () => {
    expect(() => validateProviderConfigInput({ ...validInput, capability: "chat" })).toThrow();
  });

  it("rejects an invalid selection strategy", () => {
    expect(() =>
      validateProviderConfigInput({ ...validInput, selectionStrategy: "random" }),
    ).toThrow();
  });

  it("rejects a non-https base url", () => {
    expect(() =>
      validateProviderConfigInput({ ...validInput, baseUrl: "http://insecure.example.com" }),
    ).toThrow("https");
  });

  it("rejects a non-positive weight", () => {
    expect(() => validateProviderConfigInput({ ...validInput, weight: 0 })).toThrow();
  });

  it("rejects a negative priority", () => {
    expect(() => validateProviderConfigInput({ ...validInput, priority: -1 })).toThrow();
  });

  it("accepts a null key selection strategy (inherit)", () => {
    const parsed = validateProviderConfigInput({ ...validInput, keySelectionStrategy: null });
    expect(parsed.keySelectionStrategy).toBeNull();
  });

  it("accepts explicit key selection strategies", () => {
    for (const strategy of ["priority", "round_robin"] as const) {
      const parsed = validateProviderConfigInput({ ...validInput, keySelectionStrategy: strategy });
      expect(parsed.keySelectionStrategy).toBe(strategy);
    }
  });

  it("rejects an invalid key selection strategy", () => {
    expect(() =>
      validateProviderConfigInput({ ...validInput, keySelectionStrategy: "weighted_round_robin" }),
    ).toThrow();
  });
});
