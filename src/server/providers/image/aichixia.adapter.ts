// Aichixia image generation adapter.
// Endpoint: https://www.aichixia.xyz/api/v1/images/generations
// Request: { model, prompt, image?, size?, steps?, seed?, guidance?, negative_prompt?, response_format?, n? }
// Response: { data: [{ b64_json, url?, revised_prompt? }] } (b64_json is the default response_format).
//
// Model quirks (per upstream docs):
//   - gemini-3-pro-image: `image` (data URL) is required for image-to-image;
//     `size`, `steps`, `seed`, `guidance`, and `negative_prompt` are not used.
//     This adapter sends text-to-image by default and forwards `parameters.image`
//     (a data URL) only for gemini when the caller provides one.
//   - diffusion models (flux-2-dev, lucid-origin, phoenix-1.0): `negative_prompt`
//     is a first-class field (unlike OpenAI-compatible providers that need the
//     "Avoid:" prompt injection).

import type {
  ImageGenerationProvider,
  GenerateImageInput,
  ImageGenerationResult,
} from "@/server/domain/provider";
import { ProviderError, makeErrorFromHttpStatus, makeRetryable, makeNonRetryable } from "../errors";
import { isHttpsUrl, readProviderRequestId } from "../http";
import { logStructured } from "@/server/observability/logger";

export type AichixiaImageConfig = {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
};

// Gemini is the slowest upstream (image model with reasoning); keep it under the
// Vercel maxDuration 60s budget, matching the Bynara grok/nano pattern.
const GEMINI_TIMEOUT_MS = 55_000;
const DEFAULT_TIMEOUT_MS = 40_000;

function isGeminiModel(model: string): boolean {
  return model === "gemini-3-pro-image";
}

export class AichixiaImageAdapter implements ImageGenerationProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    config: AichixiaImageConfig,
    private readonly apiKey: string,
  ) {
    if (!/^https:\/\//i.test(config.baseUrl)) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "aichixia provider base url must use https",
      });
    }
    if (!config.model || typeof config.model !== "string" || config.model.trim().length === 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "aichixia provider model must be a non-empty string",
      });
    }
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "aichixia provider apiKey must be a non-empty string",
      });
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model.trim();
    if (!Number.isFinite(config.timeoutMs as number) && config.timeoutMs !== undefined) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "aichixia timeoutMs must be a finite number",
      });
    }
    this.timeoutMs =
      config.timeoutMs ?? (isGeminiModel(this.model) ? GEMINI_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new ProviderError({
        code: "provider_configuration_invalid",
        retryable: false,
        message: "aichixia timeoutMs must be a positive number",
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
        logStructured("error", "aichixia_upstream_error", {
          httpStatus: response.status,
          body: errorBody.slice(0, 200),
          model: this.model,
          providerRequestId: readProviderRequestId(response),
        });
        throw makeErrorFromHttpStatus(
          response.status,
          `aichixia provider returned ${response.status}: ${errorBody.slice(0, 200)}`,
          { providerRequestId: readProviderRequestId(response) },
        );
      }

      let json: Record<string, unknown>;
      try {
        json = (await response.json()) as Record<string, unknown>;
      } catch (error) {
        throw makeNonRetryable("provider_response_invalid", "aichixia response is not valid JSON", {
          providerRequestId: readProviderRequestId(response),
          cause: error,
        });
      }
      return this.parseResponse(json, readProviderRequestId(response));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if ((error as { name?: string })?.name === "AbortError") {
        throw makeRetryable("provider_timeout", "aichixia request timed out");
      }
      throw makeRetryable("provider_network_failed", `aichixia network error: ${String(error)}`, {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestBody(input: GenerateImageInput): Record<string, unknown> {
    if (!input.prompt || typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
      throw makeNonRetryable(
        "provider_request_invalid",
        "aichixia prompt must be a non-empty string",
      );
    }

    const body: Record<string, unknown> = {
      prompt: input.prompt,
      model: this.model,
      n: 1,
      response_format: "b64_json",
    };

    if (isGeminiModel(this.model)) {
      // Gemini does not use size/steps/seed/guidance/negative_prompt.
      // `image` (data URL) is optional here: text-to-image is the default; the
      // caller can supply `parameters.image` for image-to-image.
      const sourceImage = input.parameters["image"];
      if (sourceImage !== undefined) {
        if (typeof sourceImage !== "string" || !sourceImage.startsWith("data:image/")) {
          throw makeNonRetryable(
            "provider_request_invalid",
            "aichixia gemini image parameter must be a data URL string",
          );
        }
        body["image"] = sourceImage;
      }
      return body;
    }

    // Diffusion models: native negative_prompt field.
    if (input.negativePrompt && input.negativePrompt.trim().length > 0) {
      body["negative_prompt"] = input.negativePrompt.trim();
    }

    const size = this.mapAspectRatio(input.aspectRatio);
    body["size"] = size;

    if (input.parameters["seed"] !== undefined) {
      const rawSeed = input.parameters["seed"];
      const n = Number(rawSeed);
      if (!Number.isInteger(n) || !Number.isFinite(n)) {
        throw makeNonRetryable("provider_request_invalid", "aichixia seed must be an integer");
      }
      body["seed"] = n;
    }

    for (const field of ["steps", "guidance"] as const) {
      const value = input.parameters[field];
      if (value !== undefined) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          throw makeNonRetryable(
            "provider_request_invalid",
            `aichixia ${field} must be a positive number`,
          );
        }
        body[field] = n;
      }
    }

    return body;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
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
      throw makeNonRetryable("provider_response_invalid", "aichixia response missing data array", {
        providerRequestId: requestId,
      });
    }
    const first = data[0] as Record<string, unknown>;
    const b64 = first["b64_json"] as string | undefined;
    const url = first["url"] as string | undefined;

    let imageUrl: string | undefined;
    let imageBytes: Uint8Array | undefined;

    if (typeof b64 === "string" && b64.length > 0) {
      const norm = b64.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/=_-]+$/.test(norm) || norm.length % 4 !== 0) {
        throw makeNonRetryable(
          "provider_response_invalid",
          "aichixia b64_json is not valid base64",
          { providerRequestId: requestId },
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
          "aichixia b64_json is not valid base64",
          { providerRequestId: requestId },
        );
      }
    } else if (typeof url === "string" && url.length > 0) {
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
      } else {
        throw makeNonRetryable(
          "provider_response_invalid",
          "aichixia response url is not a valid https url",
          { providerRequestId: requestId },
        );
      }
    } else {
      throw makeNonRetryable(
        "provider_response_invalid",
        "aichixia response missing valid https url or b64_json in data[0]",
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
