import { describe, expect, it } from "vitest";
import { bigintToDb } from "@/server/application/bigint-helper";

describe("bigintToDb", () => {
  it("converts a bigint to its decimal string at runtime", () => {
    expect(bigintToDb(42n)).toBe("42");
    expect(bigintToDb(0n)).toBe("0");
    expect(bigintToDb(-7n)).toBe("-7");
  });

  it("preserves precision beyond Number.MAX_SAFE_INTEGER", () => {
    // 2^53 + 1 cannot be represented exactly as a JS number, but the runtime
    // value is a decimal string, so precision survives.
    expect(bigintToDb(9007199254740993n)).toBe("9007199254740993");
  });

  it("is typed as number for the generated supabase-js API", () => {
    // The helper satisfies supabase-js filters/inserts that model bigint as
    // number; the runtime value is still a decimal string.
    const value: number = bigintToDb(123456789n);
    expect(typeof value).toBe("string");
  });
});
