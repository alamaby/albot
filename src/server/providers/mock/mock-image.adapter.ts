// Mock image adapter for testing.

import type {
  ImageGenerationProvider,
  GenerateImageInput,
  ImageGenerationResult,
} from "@/server/domain/provider";
import { makeNonRetryable } from "../errors";

export class MockImageAdapter implements ImageGenerationProvider {
  constructor(
    private readonly generateImageFn: (
      input: GenerateImageInput,
    ) => Promise<ImageGenerationResult> | ImageGenerationResult,
  ) {}

  async generateImage(input: GenerateImageInput): Promise<ImageGenerationResult> {
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw makeNonRetryable("provider_request_invalid", "prompt is required");
    }
    return this.generateImageFn(input);
  }
}

export function createMockImageProvider(
  fn: (input: GenerateImageInput) => Promise<ImageGenerationResult> | ImageGenerationResult,
): ImageGenerationProvider {
  return new MockImageAdapter(fn);
}

export function createDefaultMockImageProvider(): ImageGenerationProvider {
  return new MockImageAdapter(async () => ({
    status: "completed",
    imageUrl: `https://mock.example.com/${Date.now()}.png`,
    mimeType: "image/png",
    metadata: { mock: true },
  }));
}
