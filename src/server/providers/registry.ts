// Provider registry: maps (capability, adapter_type) to factory functions.
// Registry must not import Telegram modules or vendor-specific code beyond
// the adapters it registers.
// Unknown adapter types fail with a normalized ProviderError, and capability
// mismatches are rejected before any HTTP call (C7, H1).

import type {
  ReasoningProvider,
  ImageGenerationProvider,
  ProviderCapability,
} from "@/server/domain/provider";
import { ProviderError } from "./errors";

type ReasoningFactory = (config: Record<string, unknown>, apiKey: string) => ReasoningProvider;
type ImageFactory = (config: Record<string, unknown>, apiKey: string) => ImageGenerationProvider;
type AnyProvider = ReasoningProvider | ImageGenerationProvider;

export type ProviderConfigRef = {
  capability: ProviderCapability;
  adapterType: string;
};

interface RegistryEntry {
  capability: ProviderCapability;
  factory: (config: Record<string, unknown>, apiKey: string) => AnyProvider;
}

export class ProviderRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  registerReasoning(adapterType: string, factory: ReasoningFactory): void {
    this.register(adapterType, "reasoning", factory);
  }

  registerImage(adapterType: string, factory: ImageFactory): void {
    this.register(adapterType, "image_generation", factory);
  }

  private register(
    adapterType: string,
    capability: ProviderCapability,
    factory: (config: Record<string, unknown>, apiKey: string) => AnyProvider,
  ): void {
    if (this.entries.has(adapterType)) {
      throw new Error(`provider adapter type already registered: ${adapterType}`);
    }
    this.entries.set(adapterType, { capability, factory });
  }

  createReasoningProvider(
    adapterType: string,
    config: Record<string, unknown>,
    apiKey: string,
  ): ReasoningProvider {
    const entry = this.requireEntry(adapterType);
    if (entry.capability !== "reasoning") {
      throw new ProviderError({
        code: "provider_capability_mismatch",
        retryable: false,
        message: `adapter type ${adapterType} is not a reasoning adapter`,
      });
    }
    return entry.factory(config, apiKey) as ReasoningProvider;
  }

  createImageProvider(
    adapterType: string,
    config: Record<string, unknown>,
    apiKey: string,
  ): ImageGenerationProvider {
    const entry = this.requireEntry(adapterType);
    if (entry.capability !== "image_generation") {
      throw new ProviderError({
        code: "provider_capability_mismatch",
        retryable: false,
        message: `adapter type ${adapterType} is not an image generation adapter`,
      });
    }
    return entry.factory(config, apiKey) as ImageGenerationProvider;
  }

  // Creates a provider for a DB-backed config row, enforcing that the row's
  // capability matches the registered adapter type (C7).
  createProviderForConfig(
    config: ProviderConfigRef,
    configData: Record<string, unknown>,
    apiKey: string,
  ): AnyProvider {
    const entry = this.requireEntry(config.adapterType);
    if (entry.capability !== config.capability) {
      throw new ProviderError({
        code: "provider_capability_mismatch",
        retryable: false,
        message: `adapter type ${config.adapterType} is not compatible with capability ${config.capability}`,
      });
    }
    return entry.factory(configData, apiKey);
  }

  getCapability(adapterType: string): ProviderCapability | null {
    return this.entries.get(adapterType)?.capability ?? null;
  }

  getRegisteredTypes(capability: ProviderCapability): string[] {
    return Array.from(this.entries.entries())
      .filter(([, entry]) => entry.capability === capability)
      .map(([adapterType]) => adapterType);
  }

  private requireEntry(adapterType: string): RegistryEntry {
    const entry = this.entries.get(adapterType);
    if (!entry) {
      throw new ProviderError({
        code: "provider_adapter_unknown",
        retryable: false,
        message: `unknown provider adapter type: ${adapterType}`,
      });
    }
    return entry;
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
