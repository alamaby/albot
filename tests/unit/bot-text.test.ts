import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOT_MESSAGES,
  DEFAULT_BOT_TEMPLATES,
  buildBotMessage,
} from "@/server/telegram/messages";
import { DEFAULT_KEYBOARD_LABELS } from "@/server/telegram/keyboards";
import { BotTextRepository, resetBotTextCache } from "@/server/repositories/bot-text.repository";
import type { PromptConfigRepository } from "@/server/repositories/prompt-config.repository";
import { OpenAICompatibleReasoningAdapter } from "@/server/providers/reasoning/openai-compatible.adapter";

function mockConfigs(bodies: Record<string, string>): PromptConfigRepository {
  return {
    getActivePersona: async (key: string) => {
      if (!(key in bodies)) throw new Error(`missing ${key}`);
      return bodies[key];
    },
  } as unknown as PromptConfigRepository;
}

describe("bot text defaults", () => {
  it("keeps the historical Indonesian strings", () => {
    expect(DEFAULT_BOT_MESSAGES["access_denied"]).toBe(
      "Akses ditolak. Akun Telegram Anda belum terdaftar.",
    );
    expect(DEFAULT_BOT_MESSAGES["enhancement_failed"]).toBe(
      "Gagal memproses prompt. Silakan coba lagi.",
    );
    expect(DEFAULT_BOT_TEMPLATES["confirmation_footer"]).toBe(
      "Pilih aksi di bawah untuk melanjutkan.",
    );
    expect(DEFAULT_KEYBOARD_LABELS["generate"]).toBe("Generate");
  });

  it("renders placeholders from defaults", () => {
    expect(buildBotMessage("prompt_too_long", { maxPromptLength: 4000 })).toBe(
      "Prompt terlalu panjang. Maksimal 4000 karakter.",
    );
    expect(buildBotMessage("rate_limited", { rateLimitMax: 5, rateLimitWindowMinutes: 10 })).toBe(
      "Terlalu banyak permintaan. Maksimal 5 prompt per 10 menit.",
    );
  });

  it("honors explicit overrides without DB access", () => {
    expect(
      buildBotMessage("prompt_received", {
        overrides: { messages: { prompt_received: "Queued!" } },
      }),
    ).toBe("Queued!");
  });
});

describe("BotTextRepository", () => {
  it("returns overrides from prompt_configs", async () => {
    resetBotTextCache();
    const repo = new BotTextRepository(
      mockConfigs({ bot_messages: '{"prompt_received":"Queued!"}' }),
    );
    await expect(repo.getMessageOverrides()).resolves.toEqual({
      prompt_received: "Queued!",
    });
  });

  it("falls back to {} when the DB is unreachable", async () => {
    resetBotTextCache();
    const failing = {
      getActivePersona: async () => {
        throw new Error("db down");
      },
    } as unknown as PromptConfigRepository;
    const repo = new BotTextRepository(failing);
    await expect(repo.getMessageOverrides()).resolves.toEqual({});
    await expect(repo.getKeyboardLabels()).resolves.toEqual({});
  });

  it("falls back to {} on invalid JSON", async () => {
    resetBotTextCache();
    const repo = new BotTextRepository(mockConfigs({ bot_messages: "not-json" }));
    await expect(repo.getMessageOverrides()).resolves.toEqual({});
  });

  it("parses reasoning_sampling strictly", async () => {
    const repo = new BotTextRepository(
      mockConfigs({
        reasoning_sampling: '{"temperature":0.5,"max_tokens":512}',
        reasoning_revision_helper: "helper text",
      }),
    );
    await expect(repo.getSampling()).resolves.toEqual({
      temperature: 0.5,
      max_tokens: 512,
    });
    await expect(repo.getRevisionHelper()).resolves.toBe("helper text");
  });

  it("rejects out-of-range sampling", async () => {
    const repo = new BotTextRepository(
      mockConfigs({ reasoning_sampling: '{"temperature":9,"max_tokens":512}' }),
    );
    await expect(repo.getSampling()).rejects.toThrow(/failed validation/);
  });
});

describe("reasoning adapter options", () => {
  const adapter = new OpenAICompatibleReasoningAdapter(
    { baseUrl: "https://example.com", model: "m" },
    "k",
  );

  it("uses DB-driven revision helper and sampling when provided", () => {
    const messages = adapter.buildMessagesForAudit({
      sourcePrompt: "a cat",
      previousPrompt: "old",
      systemPrompt: "sys",
      options: {
        revision_helper: "Custom helper",
        temperature: 0.5,
        max_tokens: 512,
      },
    });
    expect(messages[1].content).toBe("Custom helper");
  });

  it("falls back to historical defaults without options", () => {
    const messages = adapter.buildMessagesForAudit({
      sourcePrompt: "a cat",
      previousPrompt: "old",
      systemPrompt: "sys",
      options: {},
    });
    expect(messages[1].content).toContain("This is a revision of a previous prompt");
  });

  it("does not leak revision_helper into the provider body", () => {
    const exposed = adapter as unknown as {
      buildRequestBody(input: {
        sourcePrompt: string;
        systemPrompt: string;
        options: Record<string, unknown>;
      }): Record<string, unknown>;
    };
    const body = exposed.buildRequestBody({
      sourcePrompt: "a cat",
      systemPrompt: "sys",
      options: { revision_helper: "Custom helper", temperature: 0.5, max_tokens: 512 },
    });
    expect(body["revision_helper"]).toBeUndefined();
    expect(body["temperature"]).toBe(0.5);
    expect(body["max_tokens"]).toBe(512);
  });
});
