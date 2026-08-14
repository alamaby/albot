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
