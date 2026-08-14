/**
 * Optional database workflow preset.
 *
 * This explicit subpath keeps database-specific state, tools, and workflow
 * contracts out of the Community root. The preset is layered on Core and the
 * generic MCP connector; it is not required for other graph workloads.
 */
export { createDatabaseAgent } from "./database-agent.js";
export type { CommunityDatabaseAgentOptions } from "./database-agent.js";

export { createDatabaseTools, createMemoryGateway } from "./database/tools.js";
export type {
  McpDatabaseRow,
  McpDatabaseSchema,
  McpDatabaseSchemaColumn,
  McpDatabaseSchemaTable,
  McpDatabaseQueryResult,
  McpDatabaseToolOptions,
  McpDatabaseSchemaArgs,
  McpDatabaseQueryArgs,
  MemoryDatabaseMcpOptions,
} from "./database/tools.js";

export { defineDatabaseGraph } from "./database/agent.js";
export type {
  DatabaseMcpAgent,
  DatabaseMcpAgentOptions,
  DatabaseMcpAnswer,
  DatabaseMcpApprovalRequest,
  DatabaseMcpAudit,
  DatabaseMcpClarificationRequest,
  DatabaseMcpContracts,
  DatabaseMcpError,
  DatabaseMcpGlobal,
  DatabaseMcpHumanAnswer,
  DatabaseMcpInput,
  DatabaseMcpIntent,
  DatabaseMcpIntentDetails,
  DatabaseMcpInterrupt,
  DatabaseMcpPermission,
  DatabaseMcpPlan,
  DatabaseMcpState,
  DatabaseMcpThinking,
  DatabaseMcpToolCall,
  DatabaseMcpValidation,
} from "./database/agent.js";
