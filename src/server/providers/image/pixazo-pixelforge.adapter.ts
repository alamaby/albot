// Pixazo PixelForge v2 image generation adapter.
// Endpoint: https://gateway.pixazo.ai/pixelforge-image-v2/v1/text-to-image
// Request: { text, type, seed, size } — response: { results: [{url, caption, key}], type, seed, size, total }
// type is configurable via `provider_configs.settings.type` (Opsi 2), default "tags,caption".
// Negative prompt and aspect ratio are NOT supported (dropped per plan).

import type {
  ImageGenerationProvider,
  GenerateImageInput,
  ImageGenerationResult,
} from "@/server/domain/provider";
import { ProviderError, makeErrorFromHttpStatus, makeRetryable, makeNonRetryable } from "../errors";
import { isHttpsUrl, readProviderRequestId } from "../http";
import { logStructured } from "@/server/observability/logger";

export const PIXAZO_PIXELFORGE_ALLOWED_TYPES = ["tags", "caption", "tags,caption"] as const;
export type PixazoPixelforgeType = (typeof PIXAZO_PIXELFORGE_ALLOWED_TYPES)[number];

export type PixazoPixelforgeConfig = {
  baseUrl: string;
  model: string;
  type?: unknown;
  size?: unknown;
  timeoutMs?: number;
};

function normalizeType(raw: unknown): string {
  const value = String(raw ?? "tags,caption").trim();
  // Allow comma-separated with optional spaces; normalize to comma without spaces, lowercased
  const normalized = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
  if (!PIXAZO_PIXELFORGE_ALLOWED_TYPES.includes(normalized as PixazoPixelforgeType)) {
    throw new ProviderError({
      code: "provider_configuration_invalid",
      retryable: false,
      message: `pixazo pixelforge type must be one of: ${PIXAZO_PIXELFORGE_ALLOWED_TYPES.join(", ")}`,
    });
  }
  return normalized;
}

function normalizeSize(raw: unknown): number {
  const size = raw === undefined || raw === null ? 10 : Number(raw);
  if (!Number.isInteger(size) || size <= 0 || size > 10) {
    throw new ProviderError({
      code: "provider_configuration_invalid",
      retryable: false,
      message: "pixazo pixelforge size must be an integer between 1 and 10",
    });
  }
  return size;
}

export class PixazoPixelforgeAdapter implements ImageGenerationProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly type: string;
  private readonly size: number;
  private readonly timeoutMs: number;

  constructor(
    config: PixazoPixelforgeConfig,
    private readonly apiKey: string,
  ) {
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pixazo pixelforge provider base url must use https",
      });
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.type = normalizeType(config.type);
    this.size = normalizeSize(config.size);
    if (!Number.isFinite(config.timeoutMs) && config.timeoutMs !== undefined) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pixazo pixelforge timeoutMs must be a finite positive number",
      });
    }
    this.timeoutMs = config.timeoutMs ?? 120000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pixazo pixelforge timeoutMs must be a positive number",
      });
    }
    if (!/^https:\/\/.+\..+/.test(config.baseUrl)) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pixazo pixelforge base url must be a valid https url",
      });
    }
  }

  async generateImage(input: GenerateImageInput): Promise<ImageGenerationResult> {
    const url = this.baseUrl;
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
        let errorBody: string;
        try {
          errorBody = await response.text();
        } catch {
          errorBody = "unable to read response body";
        }
        logStructured("error", "pixazo_pixelforge_upstream_error", {
          httpStatus: response.status,
          body: errorBody.slice(0, 500),
        });
        throw makeErrorFromHttpStatus(
          response.status,
          `pixazo pixelforge provider returned ${response.status}: ${errorBody.slice(0, 200)}`,
          { providerRequestId: readProviderRequestId(response) },
        );
      }

      let json: Record<string, unknown>;
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch (error) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pixazo pixelforge response is not valid JSON",
          {
            providerRequestId: readProviderRequestId(response),
            cause: error,
          },
        );
      }
      return this.parseResponse(json, readProviderRequestId(response));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if ((error as { name?: string })?.name === "AbortError") {
        throw makeRetryable("provider_timeout", "pixazo pixelforge request timed out");
      }
      throw makeRetryable(
        "provider_network_failed",
        `pixazo pixelforge network error: ${String(error)}`,
        {
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestBody(input: GenerateImageInput): Record<string, unknown> {
    // Dropped: negativePrompt, aspectRatio — not supported by PixelForge
    const rawSeed = input.parameters["seed"] as unknown;
    let seed: number | undefined;
    if (rawSeed !== undefined) {
      const n = Number(rawSeed);
      if (!Number.isInteger(n) || !Number.isFinite(n)) {
        throw makeNonRetryable(
          "provider_request_invalid",
          "pixazo pixelforge seed must be an integer",
        );
      }
      seed = n;
    }
    return {
      text: input.prompt,
      type: this.type,
      ...(seed !== undefined ? { seed } : {}),
      size: this.size,
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": this.apiKey,
    };
  }

  private parseResponse(json: Record<string, unknown>, requestId?: string): ImageGenerationResult {
    const results = json["results"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(results) || results.length === 0) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pixazo pixelforge response missing results array",
        { providerRequestId: requestId },
      );
    }
    const first = results[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pixazo pixelforge response results[0] is not an object",
        { providerRequestId: requestId },
      );
    }
    const url = (first as Record<string, unknown>)["url"] as string | undefined;
    if (!url || typeof url !== "string" || !isHttpsUrl(url)) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pixazo pixelforge response missing valid https url in results[0]",
        { providerRequestId: requestId },
      );
    }
    const caption = (first as Record<string, unknown>)["caption"] as string | undefined;
    const providerRequestId = this.readBodyRequestId(json, requestId);
    return {
      status: "completed",
      imageUrl: url,
      mimeType: "image/png",
      providerRequestId,
      metadata: {
        model: this.model,
        ...(typeof caption === "string" && caption.length > 0 ? { caption } : {}),
        ...(providerRequestId ? { providerRequestId } : {}),
      },
    };
  }

  private readBodyRequestId(
    json: Record<string, unknown>,
    headerRequestId?: string,
  ): string | undefined {
    const bodyRequestId =
      (json["request_id"] as string | undefined) ??
      (json["id"] as string | undefined) ??
      (json["requestId"] as string | undefined);
    return bodyRequestId ?? headerRequestId;
  }
}
