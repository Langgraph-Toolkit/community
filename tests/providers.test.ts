import { describe, expect, it } from "vitest";
import {
  createCommunityModelRegistry,
  createHuggingFaceProvider,
  providerConfigFromEnv,
} from "../src/index.js";

describe("community provider presets", () => {
  it("resolves Hugging Face credentials from an injected environment", () => {
    const config = providerConfigFromEnv(
      { driver: "huggingface", model: "Qwen/Qwen3-8B", tokenEnv: "HF_TOKEN" },
      { HF_TOKEN: "test-token" },
    );

    expect(config).toEqual({
      driver: "huggingface",
      model: "Qwen/Qwen3-8B",
      apiKey: "test-token",
      provider: "auto",
      maxTokens: undefined,
      temperature: undefined,
    });
  });

  it("constructs a provider without starting a network request", () => {
    const provider = createHuggingFaceProvider(
      { driver: "huggingface", model: "Qwen/Qwen3-8B" },
      {},
    );

    expect(provider.name).toBe("huggingface:Qwen/Qwen3-8B");
  });

  it("keeps tier aliases stable while profiles change", () => {
    const registry = createCommunityModelRegistry({
      tiers: {
        cheap: { driver: "huggingface", model: "Qwen/Qwen3-8B" },
        local: {
          driver: "openai-compatible",
          model: "my-lora-adapter",
          baseURL: "http://localhost:11434/v1",
        },
      },
      environment: {},
    });

    expect(registry.tier("cheap").name).toBe("huggingface:Qwen/Qwen3-8B");
    expect(registry.tier("local").name).toBe("openai-compatible:my-lora-adapter");
  });
});
