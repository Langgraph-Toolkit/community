import {
  HuggingFaceProvider,
  OpenAiCompatibleProvider,
  ToolkitModelRegistry,
} from "./provider-drivers.js";
import type { LLMProvider, LLMProviderConfig } from "@langgraph-toolkit/core";

/** A minimal environment reader that is safe to inject in tests and workers. */
export interface EnvReader {
  readonly get: (name: string) => string | undefined;
}

/** Environment lookup input accepted by configFromEnv(). */
export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

/** An explicitly configured Hugging Face provider profile. */
export interface HuggingFaceProfile {
  readonly driver: "huggingface";
  readonly model: string;
  readonly tokenEnv: string;
  readonly provider?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** An explicitly configured OpenAI-compatible provider profile. */
export interface OpenAICompatibleProfile {
  readonly driver: "openai-compatible";
  readonly model: string;
  readonly baseUrlEnv?: string;
  readonly tokenEnv: string;
  readonly baseURL?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly reasoningEffort?: LLMProviderConfig["reasoningEffort"];
}

/** Union of provider profiles supported without installing a vendor SDK. */
export type CommunityModelProfile = HuggingFaceProfile | OpenAICompatibleProfile;

/** Explicitly resolve one provider profile from required environment variables. */
export interface EnvironmentModelProfile {
  readonly fromEnvironment: true;
  readonly driverEnv?: string;
  readonly modelEnv?: string;
  readonly tokenEnv?: string;
  readonly baseUrlEnv?: string;
  readonly temperature?: number;
  readonly reasoningEffort?: LLMProviderConfig["reasoningEffort"];
}

type RegistryProfile = CommunityModelProfile | EnvironmentModelProfile | LLMProviderConfig;

/** A caller-owned model tier map and the optional usage meter accepted by Core. */
export interface CommunityRegistryOptions {
  readonly tiers: Readonly<Record<string, RegistryProfile>>;
  readonly meter?: (tier: string, usage: { input: number; output: number }) => void;
  readonly environment?: ProviderEnvironment | EnvReader;
}

function readEnvironment(environment: ProviderEnvironment | EnvReader | undefined, name: string): string | undefined {
  if (!environment) return process.env[name];
  if ("get" in environment) return (environment as EnvReader).get(name);
  return environment[name];
}

function isEnvironmentProfile(profile: RegistryProfile): profile is EnvironmentModelProfile {
  return "fromEnvironment" in profile && profile.fromEnvironment === true;
}

function isCommunityProfile(profile: RegistryProfile): profile is CommunityModelProfile {
  return "driver" in profile && (profile.driver === "huggingface" || profile.driver === "openai-compatible");
}

function requireText(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Community model configuration requires ${label}.`);
  }
  return value;
}

function resolveConfig(profile: CommunityModelProfile, environment?: ProviderEnvironment | EnvReader): LLMProviderConfig {
  requireText(profile.model, "a model name");
  const apiKey = readEnvironment(environment, profile.tokenEnv);
  requireText(apiKey, `environment variable ${profile.tokenEnv}`);

  if (profile.driver === "huggingface") {
    return {
      driver: "huggingface",
      model: profile.model,
      apiKey,
      provider: profile.provider ?? "auto",
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
    };
  }

  const baseURL = profile.baseURL ?? (profile.baseUrlEnv ? readEnvironment(environment, profile.baseUrlEnv) : undefined);
  requireText(baseURL, "an OpenAI-compatible base URL or baseUrlEnv");
  return {
    driver: "openai-compatible",
    model: profile.model,
    baseURL,
    apiKey,
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
    reasoningEffort: profile.reasoningEffort,
  };
}

function resolveEnvironmentProfile(profile: EnvironmentModelProfile, environment?: ProviderEnvironment | EnvReader): LLMProviderConfig {
  const driverEnv = profile.driverEnv ?? "MODEL_DRIVER";
  const modelEnv = profile.modelEnv ?? "MODEL_NAME";
  const tokenEnv = profile.tokenEnv ?? "MODEL_API_KEY";
  const driver = requireText(readEnvironment(environment, driverEnv), driverEnv);
  const model = requireText(readEnvironment(environment, modelEnv), modelEnv);

  if (driver === "huggingface") {
    return resolveConfig({ driver, model, tokenEnv, temperature: profile.temperature }, environment);
  }
  if (driver === "openai-compatible") {
    return resolveConfig({
      driver,
      model,
      tokenEnv,
      baseUrlEnv: profile.baseUrlEnv ?? "MODEL_BASE_URL",
      temperature: profile.temperature,
      reasoningEffort: profile.reasoningEffort,
    }, environment);
  }
  throw new Error('MODEL_DRIVER must be "huggingface" or "openai-compatible".');
}

/** Convert an explicitly declared community profile into the exact Core provider config. */
export function configFromEnv(
  profile: CommunityModelProfile,
  environment?: ProviderEnvironment | EnvReader,
): LLMProviderConfig {
  return resolveConfig(profile, environment);
}

/** Construct the built-in Hugging Face provider from an explicit profile. */
export function createHuggingFace(
  profile: HuggingFaceProfile,
  environment?: ProviderEnvironment | EnvReader,
): LLMProvider {
  return new HuggingFaceProvider(resolveConfig(profile, environment));
}

/** Construct a provider for Ollama, vLLM, TGI, LiteLLM, or another compatible endpoint. */
export function createOpenAICompatible(
  profile: OpenAICompatibleProfile,
  environment?: ProviderEnvironment | EnvReader,
): LLMProvider {
  return new OpenAiCompatibleProvider(resolveConfig(profile, environment));
}

/**
 * Create a Core registry from caller-owned model profiles.
 *
 * Community never guesses a provider, model, endpoint, token, or fallback. Supply each
 * tier deliberately in application configuration; an empty registry fails during bootstrap.
 */
export function createModelRegistry(options: CommunityRegistryOptions): ToolkitModelRegistry {
  const entries = Object.entries(options.tiers);
  if (entries.length === 0) {
    throw new Error("Community model configuration requires at least one named tier.");
  }

  const tiers: Record<string, LLMProviderConfig> = {};
  for (const [alias, profile] of entries) {
    requireText(alias, "a non-empty tier name");
    tiers[alias] = isEnvironmentProfile(profile)
      ? resolveEnvironmentProfile(profile, options.environment)
      : isCommunityProfile(profile)
        ? resolveConfig(profile, options.environment)
        : profile;
  }
  return new ToolkitModelRegistry({ tiers, meter: options.meter });
}
