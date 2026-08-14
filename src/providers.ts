import {
  HuggingFaceProvider,
  OpenAiCompatibleProvider,
  ToolkitModelRegistry,
} from "./provider-drivers.js";
import type {
  LLMProvider,
} from "@langgraph-toolkit/core";
import type { LLMProviderConfig } from "@langgraph-toolkit/core";

/** A minimal environment reader that is safe to inject in tests and workers. */
export interface EnvReader {
  readonly get: (name: string) => string | undefined;
}

/** Environment lookup input accepted by configFromEnv(). */
export type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

/** A provider profile that resolves to the built-in Hugging Face driver. */
export interface HuggingFaceProfile {
  readonly driver: "huggingface";
  readonly model: string;
  readonly tokenEnv?: string;
  readonly provider?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** A provider profile for Ollama, vLLM, TGI, LiteLLM, or another compatible endpoint. */
export interface OpenAICompatibleProfile {
  readonly driver: "openai-compatible";
  readonly model: string;
  readonly baseUrlEnv?: string;
  readonly tokenEnv?: string;
  readonly baseURL?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly reasoningEffort?: LLMProviderConfig["reasoningEffort"];
}

/** Union of provider profiles supported without installing a vendor SDK. */
export type CommunityModelProfile = HuggingFaceProfile | OpenAICompatibleProfile;

/** Tier configuration plus the optional usage meter accepted by core. */
export interface CommunityRegistryOptions {
  readonly tiers?: Readonly<Record<string, CommunityModelProfile | LLMProviderConfig>>;
  readonly meter?: (tier: string, usage: { input: number; output: number }) => void;
  readonly environment?: ProviderEnvironment | EnvReader;
  readonly fallback?: LLMProviderConfig;
}

function readEnvironment(environment: ProviderEnvironment | EnvReader | undefined, name: string): string | undefined {
  if (!environment) return undefined;
  if ("get" in environment) {
    const reader = environment as EnvReader;
    return reader.get(name);
  }
  return environment[name];
}

function defaultEnvironment(): EnvReader {
  return { get: (name) => process.env[name] };
}

function isCommunityProfile(
  profile: CommunityModelProfile | LLMProviderConfig,
): profile is CommunityModelProfile {
  return profile.driver === "huggingface" || profile.driver === "openai-compatible";
}

function resolveConfig(profile: CommunityModelProfile, environment?: ProviderEnvironment | EnvReader): LLMProviderConfig {
  if (profile.driver === "huggingface") {
    return {
      driver: "huggingface",
      model: profile.model,
      apiKey: readEnvironment(environment, profile.tokenEnv ?? "HF_TOKEN"),
      provider: profile.provider ?? "auto",
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
    };
  }

  return {
    driver: "openai-compatible",
    model: profile.model,
    baseURL: profile.baseURL ?? readEnvironment(environment, profile.baseUrlEnv ?? "OPENAI_BASE_URL"),
    apiKey: readEnvironment(environment, profile.tokenEnv ?? "OPENAI_API_KEY"),
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
    reasoningEffort: profile.reasoningEffort,
  };
}

function defaultProfile(environment: ProviderEnvironment | EnvReader | undefined, fallback: LLMProviderConfig | undefined): CommunityModelProfile | LLMProviderConfig {
  const deepseekKey = readEnvironment(environment, "DEEPSEEK_API_KEY");
  if (deepseekKey) {
    return {
      driver: "openai-compatible",
      model: readEnvironment(environment, "DEEPSEEK_MODEL") ?? "deepseek-v4-flash",
      baseURL: readEnvironment(environment, "DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com/v1",
      tokenEnv: "DEEPSEEK_API_KEY",
      maxTokens: Number(readEnvironment(environment, "DEEPSEEK_MAX_TOKENS") ?? 512),
      temperature: Number(readEnvironment(environment, "DEEPSEEK_TEMPERATURE") ?? 0.1),
      reasoningEffort: readEnvironment(environment, "DEEPSEEK_REASONING_EFFORT") as LLMProviderConfig["reasoningEffort"],
    };
  }
  const huggingFaceToken = readEnvironment(environment, "HF_TOKEN");
  if (huggingFaceToken) {
    return {
      driver: "huggingface",
      model: readEnvironment(environment, "HF_MODEL") ?? "Qwen/Qwen2.5-7B-Instruct",
      tokenEnv: "HF_TOKEN",
      provider: readEnvironment(environment, "HF_PROVIDER") ?? "auto",
      maxTokens: Number(readEnvironment(environment, "HF_MAX_TOKENS") ?? 512),
      temperature: Number(readEnvironment(environment, "HF_TEMPERATURE") ?? 0.1),
    };
  }
  return fallback ?? { driver: "mock", model: "community-local" };
}

/** Convert a community profile into the exact core provider config. */
export function configFromEnv(
  profile: CommunityModelProfile,
  environment?: ProviderEnvironment | EnvReader,
): LLMProviderConfig {
  return resolveConfig(profile, environment);
}

/** Construct the built-in Hugging Face provider without importing an HF SDK. */
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

/** Create a core registry from community profiles while preserving tier aliases. */
export function createModelRegistry(options: CommunityRegistryOptions): ToolkitModelRegistry {
  const environment = options.environment ?? defaultEnvironment();
  const inferred = defaultProfile(environment, options.fallback);
  const configured: Readonly<Record<string, CommunityModelProfile | LLMProviderConfig>> = {
    cheap: inferred,
    strong: inferred,
    ...(options.tiers ?? {}),
  };
  const tiers: Record<string, LLMProviderConfig> = {};
  for (const [alias, profile] of Object.entries(configured)) {
    tiers[alias] = isCommunityProfile(profile)
      ? resolveConfig(profile, environment)
      : profile;
  }
  return new ToolkitModelRegistry({ tiers, meter: options.meter });
}
