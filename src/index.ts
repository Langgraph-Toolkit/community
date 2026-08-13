/**
 * Optional provider presets for open-source model deployments.
 *
 * This package intentionally depends on the framework-neutral core contracts.
 * It does not import a web framework or force a vendor SDK into applications.
 */
export {
  createCommunityModelRegistry,
  createHuggingFaceProvider,
  createOpenAICompatibleProvider,
  providerConfigFromEnv,
} from "./providers.js";

export type {
  CommunityModelProfile,
  CommunityRegistryOptions,
  EnvReader,
  HuggingFaceProfile,
  OpenAICompatibleProfile,
  ProviderEnvironment,
} from "./providers.js";
