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

/** Zero-config model, memory, persistence, and cross-cutting defaults. */
export {
  autoModel,
  createModelPool,
  autoMemory,
  autoCheckpoint,
  autoGuardrails,
  autoReliability,
  autoObservability,
  autoEvaluation,
  autoRag,
  autoCache,
} from "./zero-config.js";

export type {
  AutoModelOptions,
  ModelPool,
  AutoMemory,
  GuardrailResult,
  Guardrails,
  Reliability,
  Observability,
  EvaluationResult,
  Rag,
  Cache,
} from "./zero-config.js";
