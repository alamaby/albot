// Provider config validation (H10).
// Validates provider config input before it reaches the repository so invalid
// capability/adapter/settings combinations fail fast at the application layer
// instead of surfacing as opaque database errors.

import { z } from "zod";

export const providerConfigInputSchema = z.object({
  capability: z.enum(["reasoning", "image_generation"]),
  adapterType: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z
    .string()
    .url()
    .refine((value) => /^https:\/\//i.test(value), "baseUrl must use https"),
  model: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()),
  selectionStrategy: z.enum(["priority_failover", "weighted", "round_robin"]),
  priority: z.number().int().min(0),
  weight: z.number().int().positive(),
  isActive: z.boolean(),
});

export type ProviderConfigValidatedInput = z.infer<typeof providerConfigInputSchema>;

export function validateProviderConfigInput(input: unknown): ProviderConfigValidatedInput {
  return providerConfigInputSchema.parse(input);
}
