# @langgraph-toolkit/community

Community-maintained providers and use-case composition for Langgraph-Toolkit. The package adds provider inference to the framework-agnostic MCP database agent without changing the core runtime.

## Install

```bash
npm install @langgraph-toolkit/community @langgraph-toolkit/mcp
```

## Database agent with provider inference

The wrapper checks explicit provider options first, then environment variables, and finally the configured fallback. This keeps an example resource small while allowing DeepSeek, Hugging Face, or an application-owned OpenAI-compatible endpoint.

```ts
import { createCommunityDatabaseMcpAgent } from "@langgraph-toolkit/community";

const agent = await createCommunityDatabaseMcpAgent({
  mcp: databaseGateway,
});

const answer = await agent.run({
  question: "How many users are there?",
});
```

Typical environment variables are `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `HF_API_KEY`, and `HF_MODEL`. Keep provider secrets in the process environment or a secret manager. They must not be placed in graph input.

## Boundary

Community depends on MCP and core. It does not own MCP transport, HTTP routes, framework lifecycle, or checkpoint drivers. Use the MCP package directly when provider inference is not needed.

## Development

```bash
npm install
npm run build
npm test
```

New providers should expose a typed resolver, document environment variables, add deterministic mock coverage, and preserve the MCP agent contract.

## License

MIT
