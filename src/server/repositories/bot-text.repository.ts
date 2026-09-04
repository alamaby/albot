// Bot-text repository: DB-driven user-facing strings with safe fallbacks.
//
// Unlike the enhancement persona (strict-error), bot messages/keyboards fall
// back to hardcoded defaults when the DB is unreachable or a key is missing:
// a stale message is strictly better than a silent bot. Every fallback is
// logged as a warning so misconfiguration is visible in logs.
//
// Bodies for bot_messages / bot_keyboards / bot_templates are JSON objects
// (string -> string). reasoning_revision_helper is plain text and
// reasoning_sampling is JSON {temperature, max_tokens} — both strict-error
// like the enhancement persona.

import { z } from "zod";
import { logStructured } from "@/server/observability/logger";
import { ProviderError } from "@/server/providers/errors";
import { PromptConfigRepository } from "./prompt-config.repository";

export const BOT_TEXT_KEY_MESSAGES = "bot_messages";
export const BOT_TEXT_KEY_KEYBOARDS = "bot_keyboards";
export const BOT_TEXT_KEY_TEMPLATES = "bot_templates";
export const BOT_TEXT_KEY_REVISION_HELPER = "reasoning_revision_helper";
export const BOT_TEXT_KEY_SAMPLING = "reasoning_sampling";

const stringMapSchema = z.record(z.string(), z.string());

const samplingSchema = z.object({
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().int().min(1).max(8192),
});

export type ReasoningSampling = z.infer<typeof samplingSchema>;

type CacheEntry = { value: Record<string, string>; fetchedAt: number };

const TTL_MS = 60_000;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Record<string, string>>>();

export function resetBotTextCache(): void {
  cache.clear();
  inflight.clear();
}

function isCacheValid(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < TTL_MS;
}

export class BotTextRepository {
  private readonly promptConfigs: PromptConfigRepository;

  constructor(promptConfigs?: PromptConfigRepository) {
    this.promptConfigs = promptConfigs ?? new PromptConfigRepository();
  }

  // JSON map getters with fallback to {} (callers merge over defaults).
  async getMessageOverrides(): Promise<Record<string, string>> {
    return this.getMap(BOT_TEXT_KEY_MESSAGES);
  }

  async getKeyboardOverrides(): Promise<Record<string, string>> {
    return this.getMap(BOT_TEXT_KEY_KEYBOARDS);
  }

  async getTemplateOverrides(): Promise<Record<string, string>> {
    return this.getMap(BOT_TEXT_KEY_TEMPLATES);
  }

  async getKeyboardLabels(): Promise<Record<string, string>> {
    return this.getMap(BOT_TEXT_KEY_KEYBOARDS);
  }

  // Strict getters for reasoning instruction keys (no fallback).
  async getRevisionHelper(): Promise<string> {
    return this.promptConfigs.getActivePersona(BOT_TEXT_KEY_REVISION_HELPER);
  }

  async getSampling(): Promise<ReasoningSampling> {
    const body = await this.promptConfigs.getActivePersona(BOT_TEXT_KEY_SAMPLING);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: `prompt config ${BOT_TEXT_KEY_SAMPLING} is not valid JSON`,
        cause: error,
      });
    }
    const result = samplingSchema.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: `prompt config ${BOT_TEXT_KEY_SAMPLING} failed validation: ${detail}`,
      });
    }
    return result.data;
  }

  private async getMap(key: string): Promise<Record<string, string>> {
    const cached = cache.get(key);
    if (cached && isCacheValid(cached)) return cached.value;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = this.fetchMap(key)
      .then((value) => {
        cache.set(key, { value, fetchedAt: Date.now() });
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  private async fetchMap(key: string): Promise<Record<string, string>> {
    let body: string;
    try {
      body = await this.promptConfigs.getActivePersona(key);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "bot_text.fallback_default", { key, detail });
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      logStructured("warn", "bot_text.invalid_json_fallback", { key, detail });
      return {};
    }
    const result = stringMapSchema.safeParse(parsed);
    if (!result.success) {
      logStructured("warn", "bot_text.invalid_shape_fallback", {
        key,
        detail: result.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; "),
      });
      return {};
    }
    return result.data;
  }
}
