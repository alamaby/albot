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

export const PIXAZO_PIXELFORGE_ALLOWED_TYPES = ["tags", "caption", "tags,caption"] as const;
export type PixazoPixelforgeType = (typeof PIXAZO_PIXELFORGE_ALLOWED_TYPES)[number];

export type PixazoPixelforgeConfig = {
  baseUrl: string;
  model: string;
  type?: string;
  size?: number;
  timeoutMs?: number;
};

function normalizeType(raw: string | undefined): string {
  const value = (raw ?? "tags,caption").trim();
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

function normalizeSize(raw: number | undefined): number {
  const size = raw ?? 1;
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
    this.timeoutMs = config.timeoutMs ?? 120000;
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
        throw makeErrorFromHttpStatus(
          response.status,
          `pixazo pixelforge provider returned ${response.status}`,
          { providerRequestId: readProviderRequestId(response) },
        );
      }

      const json = (await response.json()) as Record<string, unknown>;
      return this.parseResponse(json, readProviderRequestId(response));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
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
    const seed = input.parameters["seed"] as number | undefined;
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
    const url = first["url"] as string | undefined;
    if (!url || typeof url !== "string" || !isHttpsUrl(url)) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pixazo pixelforge response missing valid https url in results[0]",
        { providerRequestId: requestId },
      );
    }
    const caption = first["caption"] as string | undefined;
    return {
      status: "completed",
      imageUrl: url,
      mimeType: "image/png",
      providerRequestId: this.readBodyRequestId(json, requestId),
      metadata: {
        model: this.model,
        ...(typeof caption === "string" && caption.length > 0 ? { caption } : {}),
        ...(requestId ? { providerRequestId: requestId } : {}),
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
