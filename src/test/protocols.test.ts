import { describe, expect, it } from "vitest";
import { upstreamUrl } from "../../functions/protocols";

describe("upstreamUrl", () => {
  it("appends the OpenAI endpoint when base has no /v1", () => {
    expect(upstreamUrl("https://api.openai.com", "openai", false)).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });

  it("does not duplicate /v1 when base already includes it", () => {
    expect(upstreamUrl("https://api-inference.modelscope.cn/v1", "openai", false)).toBe(
      "https://api-inference.modelscope.cn/v1/chat/completions"
    );
    expect(upstreamUrl("https://api.anthropic.com/v1/", "anthropic", false)).toBe(
      "https://api.anthropic.com/v1/messages"
    );
  });

  it("keeps a non-/v1 path prefix intact", () => {
    expect(upstreamUrl("https://host/api/v1", "openai", false)).toBe(
      "https://host/api/v1/chat/completions"
    );
  });

  it("accepts a fully-qualified endpoint", () => {
    expect(upstreamUrl("https://host/v1/chat/completions", "openai", false)).toBe(
      "https://host/v1/chat/completions"
    );
  });
});
