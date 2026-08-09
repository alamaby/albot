// Pixazo image generation adapter.
// Supports Flux 1 Schnell and Stable Diffusion XL models.
// Model behavior is selected via the explicit `responseKind` discriminator,
// never by string-matching the model name.

import type {
  ImageGenerationProvider,
  GenerateImageInput,
  ImageGenerationResult,
} from "@/server/domain/provider";
import { ProviderError, makeErrorFromHttpStatus, makeRetryable, makeNonRetryable } from "../errors";

export type PixazoResponseKind = "flux" | "sdxl";

export type PixazoConfig = {
  baseUrl: string;
  model: string;
  responseKind: PixazoResponseKind;
  timeoutMs?: number;
};

export class PixazoImageAdapter implements ImageGenerationProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly responseKind: PixazoResponseKind;
  private readonly timeoutMs: number;

  constructor(
    config: PixazoConfig,
    private readonly apiKey: string,
  ) {
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "pixazo provider base url must use https",
      });
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.responseKind = config.responseKind;
    this.timeoutMs = config.timeoutMs ?? 120000;
  }

  async generateImage(input: GenerateImageInput): Promise<ImageGenerationResult> {
    const url = `${this.baseUrl}`;
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
          `pixazo provider returned ${response.status}`,
          {
            providerRequestId: readRequestId(response),
          },
        );
      }

      const json = (await response.json()) as Record<string, unknown>;
      return this.parseResponse(json, readRequestId(response));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw makeRetryable("provider_timeout", "pixazo request timed out");
      }
      throw makeRetryable("provider_network_failed", `pixazo network error: ${String(error)}`, {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestBody(input: GenerateImageInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      prompt: input.prompt,
    };

    if (input.negativePrompt) {
      body["negative_prompt"] = input.negativePrompt;
    }

    // Map aspect ratio to width/height if provided.
    if (input.aspectRatio) {
      const ratio = this.parseAspectRatio(input.aspectRatio);
      if (ratio) {
        body["width"] = ratio.width;
        body["height"] = ratio.height;
      }
    }

    // Add model-specific parameters.
    if (this.responseKind === "flux") {
      body["num_steps"] = (input.parameters["num_steps"] as number) ?? 4;
      body["seed"] = input.parameters["seed"] as number | undefined;
      // Flux uses 512 as default.
      if (!body["width"]) body["width"] = 512;
      if (!body["height"]) body["height"] = 512;
    } else {
      body["num_steps"] = (input.parameters["num_steps"] as number) ?? 20;
      body["guidance_scale"] = (input.parameters["guidance_scale"] as number) ?? 5;
      body["seed"] = input.parameters["seed"] as number | undefined;
      // SDXL defaults to 1024.
      if (!body["width"]) body["width"] = 1024;
      if (!body["height"]) body["height"] = 1024;
    }

    return body;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": this.apiKey,
    };
  }

  private parseAspectRatio(ratio: string): { width: number; height: number } | null {
    const map: Record<string, { width: number; height: number }> = {
      "1:1": { width: 1024, height: 1024 },
      "16:9": { width: 1344, height: 768 },
      "9:16": { width: 768, height: 1344 },
      "4:3": { width: 1152, height: 896 },
      "3:4": { width: 896, height: 1152 },
    };
    return map[ratio] ?? null;
  }

  private parseResponse(json: Record<string, unknown>, requestId?: string): ImageGenerationResult {
    if (this.responseKind === "flux") {
      // Flux Schnell returns { "output": "https://..." }
      const output = json["output"] as string | undefined;
      if (!output || typeof output !== "string" || !output.startsWith("http")) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pixazo flux response missing valid output URL",
          {
            providerRequestId: requestId,
          },
        );
      }
      return {
        status: "completed",
        imageUrl: output,
        mimeType: "image/png",
        providerRequestId: (json["request_id"] as string | undefined) ?? requestId,
        metadata: {},
      };
    }

    // SDXL returns { "imageUrl": "https://..." }
    const imageUrl = json["imageUrl"] as string | undefined;
    if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
      throw makeNonRetryable(
        "provider_response_invalid",
        "pixazo sdxl response missing valid imageUrl",
        {
          providerRequestId: requestId,
        },
      );
    }
    return {
      status: "completed",
      imageUrl,
      mimeType: "image/png",
      providerRequestId: (json["id"] as string | undefined) ?? requestId,
      metadata: {},
    };
  }
}

// Reads the provider request id from response headers where available.
function readRequestId(response: Response): string | undefined {
  const headerId = response.headers.get("x-request-id");
  if (headerId) return headerId;
  const requestId = response.headers.get("x-request-trace-id");
  return requestId ?? undefined;
}
