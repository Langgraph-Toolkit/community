/**
 * Optional provider presets for open-source model deployments.
 *
 * This package intentionally depends on the framework-neutral core contracts.
 * It does not import a web framework or force a vendor SDK into applications.
 */
export {
  createModelRegistry,
  createHuggingFace,
  createOpenAICompatible,
  configFromEnv,
} from "./providers.js";

export type {
  CommunityModelProfile,
  CommunityRegistryOptions,
  EnvReader,
  HuggingFaceProfile,
  OpenAICompatibleProfile,
  ProviderEnvironment,
} from "./providers.js";
export type { ToolkitModelRegistry } from "./provider-drivers.js";

/** Community-owned model pool and RAG defaults. Core owns the generic auto facades. */
export {
  createModelPool,
  autoRag,
} from "./zero-config.js";

export type {
  ModelPool,
  Rag,
} from "./zero-config.js";

/** Convenience re-exports for applications that install Community alongside Core. */
export { autoModel, autoMemory, autoCache, autoGuardrails, autoReliability, autoObservability, autoEvaluation } from "@langgraph-toolkit/core";
export type { AutoModelOptions } from "@langgraph-toolkit/core";

/** Generic retrieval-augmented generation facade. */
export { createRAG } from "./rag.js";

export type {
  RAG,
  RAGAnswer,
  RAGAnswerOptions,
  RAGDocument,
  RAGOptions,
  RAGRetrieveOptions,
  RAGRetriever,
  RAGState,
} from "./rag.js";
