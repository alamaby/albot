import { describe, expect, it } from "vitest";
import { assertHostedOrSkip } from "../helpers/hosted";

const skip = assertHostedOrSkip();

describe.skipIf(skip)("ProviderConfigRepository", () => {
  it("can instantiate repository", async () => {
    // Repository requires env vars to be set; just verify it can be imported
    const mod = await import("@/server/repositories/provider-config.repository");
    expect(mod.ProviderConfigRepository).toBeDefined();
  });
});
