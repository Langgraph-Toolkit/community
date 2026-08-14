import { createDatabaseAgent as buildDatabaseAgent } from "./database/agent.js";
import type { DatabaseMcpAgent, DatabaseMcpAgentOptions } from "./database/agent.js";
import { createModelRegistry } from "./providers.js";
import type { CommunityRegistryOptions } from "./providers.js";

/** Options for the community database MCP use case. Provider details are inferred from the environment. */
export interface CommunityDatabaseAgentOptions extends Omit<DatabaseMcpAgentOptions, "modelRegistry"> {
  readonly model?: Omit<CommunityRegistryOptions, "fallback">;
}

const fallbackIntent = JSON.stringify({
  kind: "lookup",
  entities: [],
  metrics: [],
  dimensions: [],
  timeRange: null,
  datasource: null,
  tableHint: null,
  confidence: 0.5,
  language: "en",
  needsClarification: false,
});

/**
 * Compose the database MCP use case with community provider inference.
 * DeepSeek is preferred when configured, then Hugging Face, then a deterministic mock.
 */
export async function createDatabaseAgent(
  options: CommunityDatabaseAgentOptions = {},
): Promise<DatabaseMcpAgent> {
  const modelRegistry = createModelRegistry({
    ...options.model,
    fallback: { driver: "mock", model: "community-database-agent", mockResponse: fallbackIntent },
  });
  const { model: _model, ...agentOptions } = options;
  return buildDatabaseAgent({ ...agentOptions, modelRegistry });
}
