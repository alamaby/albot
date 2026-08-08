// Mock reasoning adapter for testing.

import type {
  ReasoningProvider,
  EnhancePromptInput,
  EnhancedPrompt,
} from "@/server/domain/provider";
import { ProviderError, makeNonRetryable } from "../errors";

export class MockReasoningAdapter implements ReasoningProvider {
  constructor(
    private readonly enhancePromptFn: (
      input: EnhancePromptInput,
    ) => Promise<EnhancedPrompt> | EnhancedPrompt,
  ) {}

  async enhancePrompt(input: EnhancePromptInput): Promise<EnhancedPrompt> {
    // Simulate some validation.
    if (!input.sourcePrompt || input.sourcePrompt.trim().length === 0) {
      throw makeNonRetryable("provider_request_invalid", "source prompt is required");
    }
    return this.enhancePromptFn(input);
  }
}

export function createMockReasoningProvider(
  fn: (input: EnhancePromptInput) => Promise<EnhancedPrompt> | EnhancedPrompt,
): ReasoningProvider {
  return new MockReasoningAdapter(fn);
}

export function createDefaultMockReasoningProvider(): ReasoningProvider {
  return new MockReasoningAdapter(async (input) => ({
    prompt: `[enhanced] ${input.sourcePrompt}`,
    metadata: { mock: true },
  }));
}
