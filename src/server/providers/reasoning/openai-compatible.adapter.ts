// OpenAI-compatible reasoning adapter.
// Translates domain requests to OpenAI-compatible API format.

import type {
  ReasoningProvider,
  EnhancePromptInput,
  EnhancedPrompt,
} from "@/server/domain/provider";
import { ProviderError, makeErrorFromHttpStatus, makeRetryable, makeNonRetryable } from "../errors";
import { readProviderRequestId } from "../http";

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
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "openai-compatible provider base url must use https",
      });
    }
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

      if (!response.ok) {
        // Log the upstream error detail (truncated, never the key) so runtime
        // failures like Cloudflare/OpenRouter 401s are diagnosable from logs.
        try {
          const errorBody = (await response.text()).slice(0, 500);
          console.error(`openai-compatible provider error ${response.status}: ${errorBody}`);
        } catch {
          // ignore body read failure
        }
        throw makeErrorFromHttpStatus(
          response.status,
          `openai-compatible provider returned ${response.status}`,
          { providerRequestId: readProviderRequestId(response) },
        );
      }

      const json = (await response.json()) as Record<string, unknown>;
      return this.parseResponse(json, readProviderRequestId(response));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw makeRetryable("provider_timeout", "openai-compatible request timed out");
      }
      throw makeRetryable(
        "provider_network_failed",
        `openai-compatible network error: ${String(error)}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
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
      // Caller-provided options win over defaults. response_format may be passed
      // here to request JSON mode from OpenAI-compatible providers.
      ...input.options,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      // OpenRouter (and several OpenAI-compatible gateways) use these to
      // identify the app; some free-tier routes require them to be present.
      "HTTP-Referer": "https://albot-ten.vercel.app",
      "X-Title": "albot",
    };
  }

  private parseResponse(json: Record<string, unknown>, requestId?: string): EnhancedPrompt {
    const choices = json["choices"] as { message: { content: string } }[] | undefined;
    if (!choices?.[0]?.message?.content) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "openai-compatible response missing choices[0].message.content",
        { providerRequestId: requestId },
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
        ...(requestId ? { providerRequestId: requestId } : {}),
        ...(reasoningContent ? { reasoningContent } : {}),
      },
    };
  }
}
