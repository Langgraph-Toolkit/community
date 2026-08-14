# @langgraph-toolkit/community

**Optional intelligence, no mandatory provider lock-in.** Community is the extension surface for model providers, built-in functions, use-case presets, and contributor-owned integrations. It adds provider inference without changing the framework-agnostic Core or MCP contracts.

## Install when a provider is needed

```bash
npm install @langgraph-toolkit/core @langgraph-toolkit/mcp @langgraph-toolkit/community
```

Core and MCP remain useful without this package. Add Community when the application wants provider selection, model tiers, fallback behavior, or a maintained use-case preset.

## Provider inference keeps resources short

The community provider layer checks explicit provider options first, then environment variables, and finally a deterministic fallback. Database workflows remain an explicit optional subpath, so the Community root stays focused on providers and contributor-owned generic use cases.

```ts
import { createDatabaseAgent } from "@langgraph-toolkit/community/database";

const agent = await createDatabaseAgent({
  mcp: databaseGateway,
});

const answer = await agent.run({
  question: "How many users are there?",
});
```

Typical environment variables include `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `HF_API_KEY`, and `HF_MODEL`. Provider secrets stay in the environment or a secret manager. They are never placed in graph input.

## Swap providers without rewriting graph code

| Requirement | Community surface | Graph change |
|---|---|---|
| Hosted DeepSeek or another OpenAI-compatible endpoint | Environment inference or explicit resolver | None |
| Hugging Face inference | `HF_API_KEY`, `HF_MODEL`, or an application registry | None |
| Free and Pro model tiers | Tier aliases and model registry | Bind a tier to a node only when needed |
| Local deterministic tests | Mock fallback provider | None |
| LoRA or fine-tuned model | Application-owned endpoint or registry entry | None if the endpoint keeps the contract |

The package does not force a vendor, transport, HTTP framework, or checkpoint driver. Contributors can add a provider by implementing a typed resolver, documenting environment variables, adding deterministic mock coverage, and preserving the agent contract.

## Package boundary

```text
core
└── mcp
    └── community
        ├── provider inference
        ├── model and tier registry helpers
        └── contributor-owned use cases
```

Community depends on Core and MCP. It does not own MCP transport, generic graph execution, HTTP routes, framework lifecycle, or persistence. Database, retrieval, or provider presets are convenience compositions and must remain replaceable by application-owned graphs.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
