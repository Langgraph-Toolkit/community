# @langgraph-toolkit/community

**Optional intelligence without provider lock-in.** Community is the extension surface for provider drivers, model tiers, routing policies, generic RAG, and contributor-owned use cases. It does not change the framework-neutral Core, MCP, or persistence contracts.

## Install only when you need a provider or built-in composition

```bash
npm install @langgraph-toolkit/core @langgraph-toolkit/community
```

Core remains independently usable. Add Community when the application wants environment-inferred models, tier selection, fallback, load balancing, ensemble responses, or the generic RAG facade.

## Zero-config model selection

`autoModel()` reads explicit options first, then the supported environment variables, and finally uses the deterministic local fallback used by tests. Provider secrets remain outside graph input.

```ts
import { autoModel } from "@langgraph-toolkit/community";

const model = autoModel();
const result = await model.chat([
  { role: "user", content: "Extract the priority from this ticket." },
]);
```

Typical environment variables include `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `HF_API_KEY`, and `HF_MODEL`. A hosted endpoint, a Hugging Face model, a local inference server, or a fine-tuned model can implement the same Core `LLMProvider` contract.

## ModelPool policies

`createModelPool()` keeps tier aliases in one registry and returns providers for common policies. The policy is selected while composing the resource, not repeated in every request.

```ts
import { createModelPool } from "@langgraph-toolkit/community";

const pool = createModelPool({
  tiers: {
    cheap: { driver: "mock", model: "fast" },
    strong: { driver: "mock", model: "accurate" },
  },
});

const routed = pool.routing((tiers, input) =>
  input.messages.length > 4 ? tiers.includes("strong") ? "strong" : tiers[0] : "cheap",
);
const resilient = pool.fallback(["strong", "cheap"]);
const balanced = pool.loadBalance(["cheap", "strong"]);
const ensemble = pool.ensemble(["cheap", "strong"]);
```

The four policies have distinct intent: `routing()` delegates tier selection to a typed application policy, `fallback()` retries the next tier after provider failure, `loadBalance()` rotates through configured tiers, and `ensemble()` asks all tiers and returns either the supplied judge result or the longest response.

## Generic RAG

RAG is provider-neutral and does not assume SQL, a vector vendor, a database schema, or a chat-only application. Inject any retriever that returns documents with a stable `content` field. The same facade can answer directly or become a Core subgraph.

```ts
import { autoModel, createRAG } from "@langgraph-toolkit/community";

const rag = createRAG({
  model: autoModel(),
  retriever: {
    async retrieve(query, options = {}) {
      return searchDocuments(query, options.topK ?? 5);
    },
  },
  name: "knowledge-answer",
});

const answer = await rag.answer("What is the refund policy?");
console.log(answer.answer, answer.documents);

const retrievalGraph = rag.asSubgraph();
```

The default model and empty retriever are deterministic development fallbacks. Production applications should inject a model and retriever that match their latency, privacy, and grounding requirements.

## Optional database convenience

Database-specific helpers belong only to `@langgraph-toolkit/community/database`; they are not part of the Community root and are not required for generic workflows. The root remains suitable for classification, extraction, background tasks, retrieval, multi-agent routing, and any other typed workflow.

## Package boundary

| Boundary | Owns | Does not own |
|---|---|---|
| Core | State, graph topology, execution, events and interrupts | Providers, HTTP frameworks or database SDKs |
| MCP | Server declarations, discovery, tools, resources and lifecycle | Domain-specific agents or framework registration |
| Community | Providers, model policies, RAG and optional compositions | Core execution, transport or persistence drivers |
| Adapters | Host lifecycle, routes and serialization | Prompt policy or database schema |

## Development

```bash
npm install
npm run build
npm test
```

Contributors should add typed contracts, TSDoc, deterministic tests, and an independent example for each public policy or provider extension.

## License

MIT
