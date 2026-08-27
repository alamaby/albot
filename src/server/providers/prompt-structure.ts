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

export type StructuredPromptReason = "refusal" | "malformed";

// Distinguishes a content-policy refusal from a malformed/invalid model output.
// A refusal means the provider declined to produce a prompt (content policy),
// which is terminal and should not be retried with the same input; malformed
// means the model returned something that failed parsing/validation.
export class StructuredPromptError extends Error {
  readonly reason: StructuredPromptReason;

  constructor(message: string, reason: StructuredPromptReason = "malformed") {
    super(message);
    this.name = "StructuredPromptError";
    this.reason = reason;
  }
}

// Heuristic refusal markers: natural-language decline the model emits instead
// of the requested JSON when content policy blocks the request. Only used to
// classify an output that already failed JSON/schema parsing, so a legitimate
// prompt that happens to contain such words is not mislabelled.
const REFUSAL_MARKERS = [
  "refus",
  "i can't",
  "i cannot",
  "i am not able",
  "not able to",
  "content policy",
  "nsfw",
  "against our",
  "guidelines",
  "safeguards",
  "cannot generate",
  "can't generate",
  "cannot create",
  "policy",
];

function looksLikeRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return REFUSAL_MARKERS.some((marker) => lower.includes(marker));
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
    // Non-JSON output. If it reads like a content-policy refusal, classify it
    // as refusal (terminal) rather than malformed so the user is told the
    // prompt was declined instead of being offered a pointless retry.
    const detail = error instanceof Error ? error.message : "unknown";
    if (looksLikeRefusal(candidate)) {
      throw new StructuredPromptError("model refused the request (content policy)", "refusal");
    }
    throw new StructuredPromptError(`model response is not valid JSON: ${detail}`);
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
