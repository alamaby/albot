// Pixazo image generation adapter.
// Supports Flux 1 Schnell and Stable Diffusion XL models.

import type {
  ImageGenerationProvider,
  GenerateImageInput,
  ImageGenerationResult,
} from "@/server/domain/provider";
import {
  ProviderError,
  makeRetryable,
  makeNonRetryable,
  classificationFromHttpStatus,
} from "../errors";

export type PixazoConfig = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

export class PixazoImageAdapter implements ImageGenerationProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    config: PixazoConfig,
    private readonly apiKey: string,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
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

      clearTimeout(timeout);

      if (!response.ok) {
        const status = response.status;
        const code = classificationFromHttpStatus(status);
        const retryable = status === 429 || status >= 500;
        throw makeRetryable(code, `pixazo provider returned ${status}`, {
          httpStatus: status,
        });
      }

      const json = (await response.json()) as Record<string, unknown>;
      return this.parseResponse(json, this.model);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw makeRetryable("provider_timeout", "pixazo request timed out");
      }
      throw makeRetryable("provider_network_failed", `pixazo network error: ${String(error)}`, {
        cause: error,
      });
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
    if (this.model.includes("flux")) {
      body["num_steps"] = (input.parameters["num_steps"] as number) ?? 4;
      body["seed"] = input.parameters["seed"] as number | undefined;
      // Flux uses 512 as default.
      if (!body["width"]) body["width"] = 512;
      if (!body["height"]) body["height"] = 512;
    } else if (this.model.includes("sdxl")) {
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

  private parseResponse(json: Record<string, unknown>, model: string): ImageGenerationResult {
    // Flux Schnell returns { "output": "https://..." }
    if (model.includes("flux")) {
      const output = json["output"] as string | undefined;
      if (!output || typeof output !== "string" || !output.startsWith("http")) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pixazo flux response missing valid output URL",
        );
      }
      return {
        status: "completed",
        imageUrl: output,
        mimeType: "image/png",
        providerRequestId: json["request_id"] as string | undefined,
        metadata: {},
      };
    }

    // SDXL returns { "imageUrl": "https://..." }
    if (model.includes("sdxl")) {
      const imageUrl = json["imageUrl"] as string | undefined;
      if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "pixazo sdxl response missing valid imageUrl",
        );
      }
      return {
        status: "completed",
        imageUrl,
        mimeType: "image/png",
        providerRequestId: json["id"] as string | undefined,
        metadata: {},
      };
    }

    throw makeNonRetryable("provider_response_invalid", `unknown pixazo model: ${model}`);
  }
}
