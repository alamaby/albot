// Provider registry: maps (capability, adapter_type) to factory functions.
// Registry must not import Telegram modules or vendor-specific code beyond
// the adapters it registers.

import type {
  ReasoningProvider,
  ImageGenerationProvider,
  ProviderCapability,
} from "@/server/domain/provider";

type ReasoningFactory = (config: Record<string, unknown>, apiKey: string) => ReasoningProvider;
type ImageFactory = (config: Record<string, unknown>, apiKey: string) => ImageGenerationProvider;

interface RegistryEntry {
  capability: ProviderCapability;
  adapterType: string;
}

export class ProviderRegistry {
  private readonly reasoningFactories = new Map<string, ReasoningFactory>();
  private readonly imageFactories = new Map<string, ImageFactory>();

  registerReasoning(adapterType: string, factory: ReasoningFactory): void {
    if (this.reasoningFactories.has(adapterType)) {
      throw new Error(`reasoning adapter type already registered: ${adapterType}`);
    }
    this.reasoningFactories.set(adapterType, factory);
  }

  registerImage(adapterType: string, factory: ImageFactory): void {
    if (this.imageFactories.has(adapterType)) {
      throw new Error(`image adapter type already registered: ${adapterType}`);
    }
    this.imageFactories.set(adapterType, factory);
  }

  createReasoningProvider(
    adapterType: string,
    config: Record<string, unknown>,
    apiKey: string,
  ): ReasoningProvider {
    const factory = this.reasoningFactories.get(adapterType);
    if (!factory) {
      throw new Error(`unknown reasoning adapter type: ${adapterType}`);
    }
    return factory(config, apiKey);
  }

  createImageProvider(
    adapterType: string,
    config: Record<string, unknown>,
    apiKey: string,
  ): ImageGenerationProvider {
    const factory = this.imageFactories.get(adapterType);
    if (!factory) {
      throw new Error(`unknown image adapter type: ${adapterType}`);
    }
    return factory(config, apiKey);
  }

  getRegisteredTypes(capability: ProviderCapability): string[] {
    if (capability === "reasoning") {
      return Array.from(this.reasoningFactories.keys());
    }
    if (capability === "image_generation") {
      return Array.from(this.imageFactories.keys());
    }
    return [];
  }
}

// Singleton registry instance, populated by adapter modules at import time.
let _registry: ProviderRegistry | undefined;

export function getProviderRegistry(): ProviderRegistry {
  if (!_registry) {
    _registry = new ProviderRegistry();
  }
  return _registry;
}
