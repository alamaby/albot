// OpenAI-compatible reasoning adapter.
// Translates domain requests to OpenAI-compatible API format.

import type {
  ReasoningProvider,
  EnhancePromptInput,
  EnhancedPrompt,
} from "@/server/domain/provider";
import { ProviderError, makeErrorFromHttpStatus, makeRetryable, makeNonRetryable } from "../errors";
import { readProviderRequestId } from "../http";
import { getAppIdentity } from "../app-identity";
import { logStructured } from "@/server/observability/logger";

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
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "openai-compatible provider apiKey must be a non-empty string",
      });
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model.trim();
    if (
      config.timeoutMs !== undefined &&
      (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
    ) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "openai-compatible provider timeoutMs must be a positive finite number",
      });
    }
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
        // The message carries a truncated snippet too (parity with the Bynara
        // image adapter) so terminal failures name the upstream cause in audit
        // rows and user-facing diagnostics; secrets are stripped at display
        // time via redactSensitive.
        let errorBody = "";
        try {
          errorBody = (await response.text()).slice(0, 500);
        } catch {
          errorBody = "unable to read body";
        }
        try {
          logStructured("warn", "reasoning.upstream_error", {
            httpStatus: response.status,
            detail: errorBody,
          });
        } catch {
          // ignore body read failure
        }
        throw makeErrorFromHttpStatus(
          response.status,
          `openai-compatible provider returned ${response.status}: ${errorBody.slice(0, 200)}`,
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

  protected buildRequestBody(input: EnhancePromptInput): Record<string, unknown> {
    const messages: Record<string, string>[] = [{ role: "system", content: input.systemPrompt }];

    if (input.previousPrompt) {
      messages.push({
        role: "system",
        content:
          "This is a revision of a previous prompt. Apply the user's instruction while preserving the original structure and style unless explicitly asked to change them.",
      });
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

  // Exposed for audit capture: the messages array as it was sent to the
  // provider (caller is responsible for redacting secrets before persisting).
  buildMessagesForAudit(input: EnhancePromptInput): Array<{ role: string; content: string }> {
    const body = this.buildRequestBody(input);
    const messages = body["messages"];
    if (!Array.isArray(messages)) return [];
    return messages.map((m) => {
      const record = m as Record<string, unknown>;
      return {
        role: typeof record["role"] === "string" ? (record["role"] as string) : "user",
        content: typeof record["content"] === "string" ? (record["content"] as string) : "",
      };
    });
  }

  protected buildHeaders(): Record<string, string> {
    const { appUrl, appName } = getAppIdentity();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      // OpenRouter (and several OpenAI-compatible gateways) use these to
      // identify the app; some free-tier routes require them to be present.
      "HTTP-Referer": appUrl,
      "X-Title": appName,
    };
  }

  protected parseResponse(json: Record<string, unknown>, requestId?: string): EnhancedPrompt {
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
