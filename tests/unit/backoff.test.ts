import { describe, expect, it } from "vitest";
import { computeBackoffCapMs, computeBackoffDelayMs } from "@/server/jobs/backoff";

describe("computeBackoffCapMs", () => {
  it("doubles the base per attempt and caps at the maximum", () => {
    expect(computeBackoffCapMs(1, 60_000, 480_000)).toBe(60_000);
    expect(computeBackoffCapMs(2, 60_000, 480_000)).toBe(120_000);
    expect(computeBackoffCapMs(3, 60_000, 480_000)).toBe(240_000);
    expect(computeBackoffCapMs(4, 60_000, 480_000)).toBe(480_000);
    expect(computeBackoffCapMs(10, 60_000, 480_000)).toBe(480_000);
  });
});

describe("computeBackoffDelayMs (full jitter)", () => {
  it("returns 0 when the injected random returns the lower bound", () => {
    expect(computeBackoffDelayMs(1, { random: () => 0 })).toBe(0);
  });

  it("returns the full cap when the injected random returns the upper bound", () => {
    // random(min, max) returns [min, max); a draw near max approaches the cap
    // but stays below it.
    expect(computeBackoffDelayMs(2, { random: (_min, max) => max * 0.999999 })).toBe(119_999);
    expect(computeBackoffDelayMs(1, { random: (_min, max) => max * 0.999999 })).toBe(59_999);
  });

  it("returns half the cap for a midpoint draw", () => {
    expect(computeBackoffDelayMs(1, { random: (_min, max) => max * 0.5 })).toBe(30_000);
    expect(computeBackoffDelayMs(3, { random: (_min, max) => max * 0.5 })).toBe(120_000);
  });

  it("stays within [0, cap] for any draw", () => {
    const cap = computeBackoffCapMs(4, 60_000, 480_000); // 480_000
    for (let i = 0; i < 100; i++) {
      const delay = computeBackoffDelayMs(4, { random: (_min, max) => (max * i) / 100 });
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(cap);
    }
  });

  it("never exceeds the exponential cap regardless of attempt count", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = computeBackoffDelayMs(attempt, {
        random: (_min, max) => max * 0.999999,
      });
      expect(delay).toBeLessThanOrEqual(computeBackoffCapMs(attempt, 60_000, 480_000));
    }
  });
});
