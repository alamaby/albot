// OpenAI-compatible reasoning adapter.
// Translates domain requests to OpenAI-compatible API format.

import type {
  ReasoningProvider,
  EnhancePromptInput,
  EnhancedPrompt,
} from "@/server/domain/provider";
import {
  ProviderError,
  makeRetryable,
  makeNonRetryable,
  classificationFromHttpStatus,
} from "../errors";

export type OpenAICompatibleConfig = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAICompatibleReasoningAdapter implements ReasoningProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    config: OpenAICompatibleConfig,
    private readonly apiKey: string,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  async enhancePrompt(input: EnhancePromptInput): Promise<EnhancedPrompt> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = this.buildRequestBody(input);
    const headers = this.buildHeaders();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const status = response.status;
        const code = classificationFromHttpStatus(status);
        const retryable = status === 429 || status >= 500;
        throw makeRetryable(code, `openai-compatible provider returned ${status}`, {
          httpStatus: status,
        });
      }

      const json = (await response.json()) as Record<string, unknown>;
      return this.parseResponse(json);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw makeRetryable("provider_timeout", "openai-compatible request timed out");
      }
      throw makeRetryable(
        "provider_network_failed",
        `openai-compatible network error: ${String(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  private buildRequestBody(input: EnhancePromptInput): Record<string, unknown> {
    const messages: Record<string, string>[] = [{ role: "system", content: input.systemPrompt }];

    if (input.previousPrompt) {
      messages.push({ role: "user", content: `Previous prompt: ${input.previousPrompt}` });
    }
    if (input.revisionInstruction) {
      messages.push({
        role: "user",
        content: `Revision instruction: ${input.revisionInstruction}`,
      });
    }
    messages.push({ role: "user", content: input.sourcePrompt });

    return {
      model: this.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      ...input.options,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private parseResponse(json: Record<string, unknown>): EnhancedPrompt {
    const choices = json["choices"] as { message: { content: string } }[] | undefined;
    if (!choices?.[0]?.message?.content) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "openai-compatible response missing choices[0].message.content",
      );
    }

    const content = choices[0].message.content;
    const prompt = content.trim();

    // Extract optional fields from metadata if present.
    const message = choices[0].message as Record<string, unknown>;
    const reasoningContent = message["reasoning_content"] as string | undefined;

    return {
      prompt,
      metadata: {
        model: json["model"] as string,
        usage: json["usage"] as Record<string, unknown>,
        ...(reasoningContent ? { reasoningContent } : {}),
      },
    };
  }
}
