import { describe, expect, it } from "vitest";
import {
  parseEnhancedPromptContent,
  StructuredPromptError,
} from "@/server/providers/prompt-structure";

describe("parseEnhancedPromptContent", () => {
  it("parses a bare JSON object", () => {
    const result = parseEnhancedPromptContent(
      '{"prompt": "a cozy cabin", "negative_prompt": "blurry", "aspect_ratio": "16:9"}',
    );
    expect(result).toEqual({
      prompt: "a cozy cabin",
      negative_prompt: "blurry",
      aspect_ratio: "16:9",
    });
  });

  it("parses a JSON object inside a fenced code block", () => {
    const content = '```json\n{"prompt": "a cat"}\n```';
    const result = parseEnhancedPromptContent(content);
    expect(result.prompt).toBe("a cat");
  });

  it("parses minimal output with only prompt", () => {
    const result = parseEnhancedPromptContent('{"prompt": "just a prompt"}');
    expect(result).toEqual({ prompt: "just a prompt" });
  });

  it("rejects empty content", () => {
    expect(() => parseEnhancedPromptContent("   ")).toThrow(StructuredPromptError);
  });

  it("rejects non-JSON content", () => {
    expect(() => parseEnhancedPromptContent("this is not json")).toThrow(StructuredPromptError);
  });

  it("classifies a content-policy refusal as refusal (keyword + non-JSON)", () => {
    const content = "I can't generate this request because it violates our content policy.";
    try {
      parseEnhancedPromptContent(content);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredPromptError);
      expect((error as StructuredPromptError).reason).toBe("refusal");
    }
  });

  it("classifies valid JSON that schema-fails as malformed even when a refusal word appears", () => {
    // A legitimate structured output that happens to mention "policy" but is
    // still valid JSON must NOT be mislabelled as a refusal.
    try {
      parseEnhancedPromptContent('{"policy_notes": "x"}'); // schema-fail (no prompt)
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredPromptError);
      expect((error as StructuredPromptError).reason).toBe("malformed");
    }
  });

  it("rejects invalid shapes (missing prompt)", () => {
    expect(() => parseEnhancedPromptContent('{"negative_prompt": "x"}')).toThrow(
      StructuredPromptError,
    );
  });

  it("rejects unknown fields (strict schema)", () => {
    expect(() => parseEnhancedPromptContent('{"prompt": "ok", "extra_field": "nope"}')).toThrow(
      StructuredPromptError,
    );
  });

  it("rejects an over-length prompt", () => {
    expect(() => parseEnhancedPromptContent(JSON.stringify({ prompt: "x".repeat(4001) }))).toThrow(
      StructuredPromptError,
    );
  });
});
