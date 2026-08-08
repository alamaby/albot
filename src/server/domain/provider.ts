// Provider domain contracts (reasoning and image generation).
// These interfaces are adapter-agnostic and must not import any provider-specific code.

export type ProviderCapability = "reasoning" | "image_generation";

export interface ReasoningProvider {
  enhancePrompt(input: EnhancePromptInput): Promise<EnhancedPrompt>;
}

export type EnhancePromptInput = {
  sourcePrompt: string;
  previousPrompt?: string;
  revisionInstruction?: string;
  systemPrompt: string;
  options: Record<string, unknown>;
};

export type EnhancedPrompt = {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  metadata: Record<string, unknown>;
};

export interface ImageGenerationProvider {
  generateImage(input: GenerateImageInput): Promise<ImageGenerationResult>;
  getResult?(providerRequestId: string): Promise<ImageGenerationResult>;
}

export type GenerateImageInput = {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  parameters: Record<string, unknown>;
};

export type ImageGenerationResult =
  | {
      status: "completed";
      imageUrl?: string;
      imageBytes?: Uint8Array;
      mimeType?: string;
      providerRequestId?: string;
      metadata: Record<string, unknown>;
    }
  | {
      status: "pending";
      providerRequestId: string;
      pollAfterMs: number;
      imageUrl?: string;
      metadata: Record<string, unknown>;
    };
