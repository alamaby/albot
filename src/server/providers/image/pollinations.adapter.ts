// Pollinations image generation adapter.
// Endpoint: https://gen.pollinations.ai/v1/images/generations (OpenAI-compatible)
// Request: { prompt, model, n, size, response_format } -> Response: { created, data: [{ url, revised_prompt, b64_json }] }
// Negative prompt injected into prompt as " Avoid: {negativePrompt}" (OpenAI API has no negative_prompt field).
// Aspect ratio mapped to size: 1:1->1024x1024, 16:9->1792x1024, 9:16->1024x1792, 4:3->1152x896, 3:4->896x1152.
// SVG tunda: always return image/png.

import type {
  ImageGenerationProvider,
  GenerateImageInput,
  ImageGenerationResult,
} from "@/server/domain/provider";
import { ProviderError, makeErrorFromHttpStatus, makeRetryable, makeNonRetryable } from "../errors";
import { isHttpsUrl, readProviderRequestId } from "../http";
import { getAppIdentity } from "../app-identity";
import { logStructured } from "@/server/observability/logger";

export type PollinationsImageConfig = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

export class PollinationsImageAdapter implements ImageGenerationProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    config: PollinationsImageConfig,
    private readonly apiKey: string,
  ) {
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pollinations provider base url must use https",
      });
    }
    if (!config.model || typeof config.model !== "string" || config.model.trim().length === 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pollinations provider model must be a non-empty string",
      });
    }
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pollinations provider apiKey must be a non-empty string",
      });
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model.trim();
    if (!Number.isFinite(config.timeoutMs as number) && config.timeoutMs !== undefined) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pollinations timeoutMs must be a finite number",
      });
    }
    this.timeoutMs = config.timeoutMs ?? 120000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pollinations timeoutMs must be a positive number",
      });
    }
  }

  async generateImage(input: GenerateImageInput): Promise<ImageGenerationResult> {
    const url = `${this.baseUrl}/images/generations`;
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
        let errorBody = "";
        try {
          errorBody = (await response.text()).slice(0, 500);
        } catch {
          errorBody = "unable to read body";
        }
        logStructured("error", "pollinations_upstream_error", {
          httpStatus: response.status,
          body: errorBody.slice(0, 200),
          model: this.model,
          providerRequestId: readProviderRequestId(response),
        });
        throw makeErrorFromHttpStatus(
          response.status,
          `pollinations provider returned ${response.status}: ${errorBody.slice(0, 200)}`,
          { providerRequestId: readProviderRequestId(response) },
        );
      }

      let json: Record<string, unknown>;
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch (error) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pollinations response is not valid JSON",
          { providerRequestId: readProviderRequestId(response), cause: error },
        );
      }
      return this.parseResponse(json, readProviderRequestId(response));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if ((error as { name?: string })?.name === "AbortError") {
        throw makeRetryable("provider_timeout", "pollinations request timed out");
      }
      throw makeRetryable(
        "provider_network_failed",
        `pollinations network error: ${String(error)}`,
        {
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestBody(input: GenerateImageInput): Record<string, unknown> {
    if (!input.prompt || typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      throw makeNonRetryable(
        "provider_request_invalid",
        "pollinations prompt must be a non-empty string",
      );
    }
    let prompt = input.prompt;
    if (input.negativePrompt && input.negativePrompt.trim().length > 0) {
      prompt = `${prompt} Avoid: ${input.negativePrompt.trim()}`;
    }

    const size = this.mapAspectRatio(input.aspectRatio);

    const body: Record<string, unknown> = {
      prompt,
      model: this.model,
      n: 1,
      size,
      response_format: "url",
    };

    if (input.parameters["seed"] !== undefined) {
      const rawSeed = input.parameters["seed"];
      const n = Number(rawSeed);
      if (!Number.isInteger(n) || !Number.isFinite(n)) {
        throw makeNonRetryable("provider_request_invalid", "pollinations seed must be an integer");
      }
      body["seed"] = n;
    }

    return body;
  }

  private buildHeaders(): Record<string, string> {
    const { appUrl, appName } = getAppIdentity();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer": appUrl,
      "X-Title": appName,
    };
  }

  private mapAspectRatio(ratio?: string): string {
    const map: Record<string, string> = {
      "1:1": "1024x1024",
      "16:9": "1792x1024",
      "9:16": "1024x1792",
      "4:3": "1152x896",
      "3:4": "896x1152",
    };
    if (!ratio) return "1024x1024";
    return map[ratio] ?? "1024x1024";
  }

  private parseResponse(json: Record<string, unknown>, requestId?: string): ImageGenerationResult {
    const data = json["data"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(data) || data.length === 0) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pollinations response missing data array",
        {
          providerRequestId: requestId,
        },
      );
    }
    const first = data[0] as Record<string, unknown>;
    const url = first["url"] as string | undefined;
    const b64 = first["b64_json"] as string | undefined;

    let imageUrl: string | undefined;
    let imageBytes: Uint8Array | undefined;

    if (typeof url === "string" && url.length > 0) {
      let candidate = url;
      if (candidate.startsWith("/")) {
        try {
          candidate = new URL(candidate, this.baseUrl).toString();
        } catch {
          // keep original
        }
      }
      if (isHttpsUrl(candidate)) {
        imageUrl = candidate;
      }
    }
    if (!imageUrl && typeof b64 === "string" && b64.length > 0) {
      const norm = b64.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+\/=_-]+$/.test(norm) || norm.length % 4 !== 0) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pollinations b64_json is not valid base64",
          {
            providerRequestId: requestId,
          },
        );
      }
      try {
        const buf =
          typeof Buffer !== "undefined"
            ? Buffer.from(norm, "base64")
            : Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
        imageBytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      } catch {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pollinations b64_json is not valid base64",
          {
            providerRequestId: requestId,
          },
        );
      }
    }
    if (!imageUrl && !imageBytes) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pollinations response missing valid https url or b64_json in data[0]",
        { providerRequestId: requestId },
      );
    }

    const revisedPrompt = first["revised_prompt"] as string | undefined;
    const providerRequestId = this.readBodyRequestId(json, requestId);

    return {
      status: "completed",
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageBytes ? { imageBytes } : {}),
      mimeType: "image/png",
      providerRequestId,
      metadata: {
        model: this.model,
        ...(typeof revisedPrompt === "string" && revisedPrompt.length > 0 ? { revisedPrompt } : {}),
        ...(providerRequestId ? { providerRequestId } : {}),
      },
    };
  }

  private readBodyRequestId(json: Record<string, unknown>, headerId?: string): string | undefined {
    const bodyId =
      (json["id"] as string | undefined) ??
      (json["request_id"] as string | undefined) ??
      (json["requestId"] as string | undefined);
    return bodyId ?? headerId;
  }
}
