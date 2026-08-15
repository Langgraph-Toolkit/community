# @langgraph-toolkit/community

**Optional, explicit integrations for Langgraph-Toolkit.** Community supplies provider drivers, caller-owned model tiers and generic RAG. It does not select a vendor, model, credential, fallback, database schema or application workflow for you.

## Install only when you need an optional integration

```bash
npm install @langgraph-toolkit/core @langgraph-toolkit/community
```

Use Core alone for state, graphs, tools and execution. Add Community only when an application explicitly needs an open-source or OpenAI-compatible provider, a model pool or generic RAG.

## Declare model configuration in the application

The application owns provider selection. Put credentials in the host application's environment and declare the driver, model and endpoint in its config module. Community validates the declaration during bootstrap and fails before a request is handled when a required value is absent.

```ts
import { createModelRegistry } from "@langgraph-toolkit/community";

export const models = createModelRegistry({
  tiers: {
    chat: {
      driver: "openai-compatible",
      model: process.env.MODEL_NAME!,
      tokenEnv: "MODEL_API_KEY",
      baseUrlEnv: "MODEL_BASE_URL",
      temperature: 0.1,
    },
  },
});
```

The snippet does **not** name a default vendor or model. An application can configure DeepSeek, Ollama, vLLM, TGI, LiteLLM or another compatible endpoint by setting its own `MODEL_*` variables. Missing `MODEL_NAME`, `MODEL_API_KEY` or `MODEL_BASE_URL` throws during composition rather than silently selecting a fallback.

## Use an explicit provider without a registry

```ts
import { createOpenAICompatible } from "@langgraph-toolkit/community";

const model = createOpenAICompatible({
  driver: "openai-compatible",
  model: process.env.MODEL_NAME!,
  tokenEnv: "MODEL_API_KEY",
  baseUrlEnv: "MODEL_BASE_URL",
});
```

For Hugging Face, use `createHuggingFace()` with `driver: "huggingface"`, an explicit `model` and `tokenEnv`. Both factories accept an optional environment reader so workers and tests can inject configuration without mutating process globals.

## ModelPool policies

`createModelPool()` accepts caller-owned tiers and exposes typed policy helpers. Selection remains in the application resource, where a developer can inspect or replace it.

```ts
import { createModelPool } from "@langgraph-toolkit/community";

const pool = createModelPool({
  tiers: {
    fast: modelConfigFast,
    careful: modelConfigCareful,
  },
});

const selected = pool.routing((tiers, input) =>
  input.messages.length > 4 && tiers.includes("careful") ? "careful" : "fast",
);
```

`routing()` delegates a tier decision to application code. `fallback()`, `loadBalance()` and `ensemble()` operate only on the explicitly named tiers. None creates a provider or model implicitly.

## Generic RAG

RAG is provider-neutral. Supply both the model and retriever. Community does not assume SQL, a vector vendor, a database row type or a chat-only workflow.

```ts
import { createRAG } from "@langgraph-toolkit/community";

const rag = createRAG({
  model,
  retriever: {
    async retrieve(query, options = {}) {
      return searchDocuments(query, options.topK ?? 5);
    },
  },
  name: "knowledge-answer",
});
```

## Package boundary

| Boundary | Owns | Does not own |
| --- | --- | --- |
| Core | State, graph topology, execution, events, interrupts and generic tool contracts | Providers, transports, database schema or product workflow |
| MCP | Server declarations, discovery, typed tools, resources and connection lifecycle | Domain-specific agents, database rows or framework routes |
| Community | Provider drivers, model policies and generic RAG | Default model selection, application workflows, Core execution or HTTP transport |
| Application example | Prompting, state, node, edge, routing, MCP tool policy and business response | Hidden package convention that prevents customization |
| Adapters | Host lifecycle, HTTP routes and serialization | Prompt policy, model selection, MCP server selection or domain schema |

## Development

```bash
npm install
npm run build
npm test
```

Contributors should add typed contracts, TSDoc and deterministic tests for each public provider, model policy or generic RAG capability. Do not add a domain workflow, default provider, model fallback or credential guessing to this package.

## License

MIT
