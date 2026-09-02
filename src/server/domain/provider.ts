// Provider domain contracts (reasoning and image generation).
// These interfaces are adapter-agnostic and must not import any provider-specific code.

export type ProviderCapability = "reasoning" | "image_generation";

export type ProviderSelectionStrategy = "priority_failover" | "weighted" | "round_robin";
// Per-config key-level strategy (provider_configs.key_selection_strategy).
// Overrides the key-selection behaviour that would otherwise be derived from
// the config-level selection_strategy. Null = inherit (see selector.ts).
//   - "priority"    : keys ordered by priority ASC then last_used_at ASC
//                     (priority failover: backup key chosen after the primary
//                      enters cooldown; threshold stays 3 via existing RPC)
//   - "round_robin" : keys ordered by last_used_at ASC (LRU rotation; a
//                     successful call bumps last_used_at, rotating the key to
//                     the back of the queue on the next selection)
export type ProviderKeySelectionStrategy = "priority" | "round_robin";
export type ProviderStrategy = ProviderSelectionStrategy | ProviderKeySelectionStrategy;

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
