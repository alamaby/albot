// Structured prompt parsing for reasoning providers (Milestone 4).
//
// The reasoning adapter returns free-form text. The enhancement system prompt
// instructs the model to answer with a JSON object, and this module parses and
// validates that object so downstream code never consumes unvalidated model
// output. Parsing is tolerant of fenced code blocks; validation is strict
// (unknown fields are rejected) so a drifting model schema fails loudly and is
// retried instead of silently persisting a malformed prompt.

import { z } from "zod";

export const enhancedPromptStructuredSchema = z
  .object({
    prompt: z.string().min(1).max(4000),
    negative_prompt: z.string().max(2000).optional(),
    aspect_ratio: z.string().max(64).optional(),
  })
  .strict();

export type EnhancedPromptStructured = z.infer<typeof enhancedPromptStructuredSchema>;

export class StructuredPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredPromptError";
  }
}

// Extracts the JSON object from a model response. Accepts a raw JSON object,
// a bare JSON string, or a markdown fenced code block containing JSON.
export function parseEnhancedPromptContent(content: string): EnhancedPromptStructured {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new StructuredPromptError("empty model response");
  }

  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new StructuredPromptError(
      `model response is not valid JSON: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const result = enhancedPromptStructuredSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new StructuredPromptError(`model response failed validation: ${detail}`);
  }

  return result.data;
}
