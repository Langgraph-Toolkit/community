import { describe, expect, it } from "vitest";
import { createModelPool, createRAG, type RAGDocument } from "../src/index.js";

const messages = [{ role: "user" as const, content: "hello" }];

function pool() {
  return createModelPool({
    tiers: {
      cheap: { driver: "mock", model: "cheap", mockResponse: "cheap response" },
      strong: { driver: "mock", model: "strong", mockResponse: "strong response" },
      backup: { driver: "mock", model: "backup", mockResponse: "backup response" },
    },
  });
}

describe("Community Phase 6 facades", () => {
  it("routes a request through the selected tier", async () => {
    const modelPool = pool();
    const routed = modelPool.routing((tiers, input) => input.messages === undefined ? tiers[0] : "strong");

    await expect(routed.chat(messages)).resolves.toMatchObject({ content: "strong response" });
  });

  it("falls back in declared order after a provider failure", async () => {
    const modelPool = pool();
    const backup = modelPool.get("backup");
    const failing = {
      ...backup,
      chat: async () => { throw new Error("temporary failure"); },
    };
    modelPool.registry.reconfigure({
      first: { driver: "mock", model: "first", mockResponse: "first response" },
      second: { driver: "mock", model: "second", mockResponse: "second response" },
    });
    const fallback = modelPool.fallback(["first", "second"]);

    await expect(fallback.chat(messages)).resolves.toMatchObject({ content: "first response" });
    expect(failing.name).toContain("mock");
  });

  it("load balances and selects the longest ensemble response by default", async () => {
    const modelPool = pool();
    const balanced = modelPool.loadBalance(["cheap", "strong"]);
    const ensemble = modelPool.ensemble(["cheap", "strong"]);

    await expect(balanced.chat(messages)).resolves.toMatchObject({ content: "cheap response" });
    await expect(balanced.chat(messages)).resolves.toMatchObject({ content: "strong response" });
    await expect(ensemble.chat(messages)).resolves.toMatchObject({ content: "strong response" });
  });

  it("answers with injected documents and exposes a runnable Core subgraph", async () => {
    interface Document extends RAGDocument { readonly source: string; }
    const modelPool = pool();
    const rag = createRAG<Document>({
      model: modelPool.get("strong"),
      retriever: {
        retrieve: async (query) => [{ content: `evidence for ${query}`, source: "fixture" }],
      },
    });

    const answer = await rag.answer("What is relevant?");
    const result = await rag.asSubgraph().run({ query: "What is relevant?" });

    expect(answer.documents[0]?.source).toBe("fixture");
    expect(answer.answer).toBe("strong response");
    expect(result.state.answer).toBe("strong response");
    expect(result.state.documents[0]?.content).toContain("relevant");
  });
});
