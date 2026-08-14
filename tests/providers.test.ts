import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  createModelRegistry,
  createHuggingFace,
  configFromEnv,
} from "../src/index.js";
import {
  HuggingFaceProvider,
  OpenAiCompatibleProvider,
  ToolkitModelRegistry,
} from "../src/provider-drivers.js";

describe("community provider presets", () => {
  it("resolves Hugging Face credentials from an injected environment", () => {
    const config = configFromEnv(
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
    const provider = createHuggingFace(
      { driver: "huggingface", model: "Qwen/Qwen3-8B" },
      {},
    );

    expect(provider.name).toBe("huggingface:Qwen/Qwen3-8B");
  });

  it("keeps tier aliases stable while profiles change", () => {
    const registry = createModelRegistry({
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

  it("keeps the registry and provider capabilities in Community", async () => {
    const registry = new ToolkitModelRegistry({
      tiers: {
        strong: { driver: "mock", model: "m-strong" },
        cheap: { driver: "mock", model: "m-cheap" },
      },
    });
    const result = await registry.tier("strong").chat([{ role: "user", content: "hi" }]);
    expect(result.content).toContain("m-strong");
    registry.recordUsage("strong", { input: 10, output: 5 });
    expect(registry.tokenUsage.get("strong")).toEqual({ input: 10, output: 5 });
    registry.reconfigure({ strong: { driver: "mock", model: "m-next" } });
    expect(registry.tier("strong").name).toBe("mock:m-next");
  });

  it("constructs the optional provider drivers without network access", () => {
    expect(() => new OpenAiCompatibleProvider({ baseURL: "http://x", model: "m" })).not.toThrow();
    expect(() => new HuggingFaceProvider({ model: "mistralai/Mistral-7B-Instruct-v0.3", provider: "auto" })).not.toThrow();
  });

  it("forwards typed tool and structured-output capabilities", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: readonly { type: string }[];
        tool_choice?: { type: string; function: { name: string } };
        response_format?: { type: string };
      };
      expect(body.tools).toEqual([{ type: "function", function: { name: "lookup", description: "Look up a record", parameters: { type: "object" } } }]);
      expect(body.tool_choice).toEqual({ type: "function", function: { name: "lookup" } });
      expect(body.response_format).toEqual({ type: "json_object" });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "", tool_calls: [{ id: "call-1", function: { name: "lookup", arguments: '{"id":"1"}' } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await new OpenAiCompatibleProvider({ baseURL: "http://provider.test", model: "m" }).chat(
        [{ role: "user", content: "find it" }],
        {
          tools: [{ name: "lookup", description: "Look up a record", parameters: { type: "object" } }],
          toolChoice: { name: "lookup" },
          responseFormat: { type: "json_object" },
        },
      );
      expect(result.toolCalls).toEqual([{ id: "call-1", name: "lookup", arguments: { id: "1" } }]);
      expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("streams reasoning, tokens, tool calls and usage", async () => {
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "plan" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "lookup", arguments: "{}" } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 4, completion_tokens: 3 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    try {
      const chunks: Array<{ readonly type: string }> = [];
      for await (const chunk of new OpenAiCompatibleProvider({ baseURL: "http://provider.test", model: "m" }).streamDetailed(
        [{ role: "user", content: "run" }],
      )) chunks.push(chunk);
      expect(chunks.map((chunk) => chunk.type)).toEqual(["reasoning", "token", "tool_call", "usage"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
