import { describe, expect, it, vi } from "vitest";
import { PromptAuditRepository } from "@/server/repositories/prompt-audit.repository";

const insertMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock("@/server/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

describe("PromptAuditRepository", () => {
  it("inserts an enhance_input record without throwing", async () => {
    const repo = new PromptAuditRepository();
    await expect(
      repo.insert({
        telegramUserId: 1n,
        telegramChatId: 2n,
        stage: "enhance_input",
        sourcePrompt: "a red dragon",
        status: "ok",
      }),
    ).resolves.toBeUndefined();
    expect(insertMock).toHaveBeenCalledOnce();
  });

  it("does not throw when insert returns an error (best-effort)", async () => {
    insertMock.mockRejectedValueOnce(new Error("db down"));
    const repo = new PromptAuditRepository();
    await expect(
      repo.insert({
        telegramUserId: 1n,
        telegramChatId: 2n,
        stage: "enhance_output",
        enhancedPrompt: "A fierce red dragon in flight",
        status: "ok",
      }),
    ).resolves.toBeUndefined();
  });
});
