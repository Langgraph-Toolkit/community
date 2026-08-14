import type {
  Checkpoint,
  Checkpointer,
  JsonObject,
  JsonValue,
  LLMProvider,
} from "@langgraph-toolkit/core";
import {
  createModelRegistry,
  type CommunityRegistryOptions,
  type EnvReader,
  type ProviderEnvironment,
} from "./providers.js";

/** Options for the environment-inferred default model. */
export interface AutoModelOptions extends CommunityRegistryOptions {
  readonly tier?: string;
}

/** A small model pool facade that preserves tier aliases for graph bindings. */
export interface ModelPool {
  readonly registry: ReturnType<typeof createModelRegistry>;
  get(tier?: string): LLMProvider;
}

/** Construct the first available provider from environment and fallback settings. */
export function autoModel(options: AutoModelOptions = {}): LLMProvider {
  const registry = createModelRegistry(options);
  return registry.tier(options.tier ?? "strong");
}

/** Construct a tier-aware model pool with inferred cheap and strong defaults. */
export function createModelPool(options: CommunityRegistryOptions = {}): ModelPool {
  const registry = createModelRegistry(options);
  return {
    registry,
    get: (tier = "strong") => registry.tier(tier),
  };
}

/** A typed process-local memory store for development and small workers. */
export interface AutoMemory {
  get<T extends JsonObject>(key: string): Promise<T | null>;
  set<T extends JsonObject>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Create a zero-config memory store without selecting a vendor database. */
export function autoMemory(): AutoMemory {
  const values = new Map<string, JsonObject>();
  return {
    get: async <T extends JsonObject>(key: string): Promise<T | null> => {
      const value = values.get(key);
      return value === undefined ? null : value as T;
    },
    set: async <T extends JsonObject>(key: string, value: T): Promise<void> => {
      values.set(key, value);
    },
    delete: async (key: string): Promise<void> => {
      values.delete(key);
    },
  };
}

/** Create a process-local checkpointer for development and contributor tests. */
export function autoCheckpoint(): Checkpointer {
  const values = new Map<string, Checkpoint>();
  return {
    get: async (threadId) => values.get(threadId) ?? null,
    put: async (checkpoint) => {
      values.set(checkpoint.threadId, checkpoint);
    },
    list: async (threadId) => {
      const checkpoint = values.get(threadId);
      return checkpoint === undefined ? [] : [checkpoint];
    },
  };
}

/** Result of a default guardrail check. */
export interface GuardrailResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/** Zero-config guardrail contract; the default policy allows typed values. */
export interface Guardrails {
  check(value: JsonValue): Promise<GuardrailResult>;
}

/** Create permissive guardrails that applications can wrap with policy-specific checks. */
export function autoGuardrails(): Guardrails {
  return { check: async () => ({ allowed: true }) };
}

/** Retry settings used by the default reliability facade. */
export interface Reliability {
  readonly attempts: number;
  readonly backoffMs: number;
  retry<T>(operation: () => Promise<T>): Promise<T>;
}

/** Create bounded retry behavior without requiring a queue or vendor SDK. */
export function autoReliability(options: { readonly attempts?: number; readonly backoffMs?: number } = {}): Reliability {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoffMs = Math.max(0, options.backoffMs ?? 50);
  return {
    attempts,
    backoffMs,
    retry: async <T>(operation: () => Promise<T>): Promise<T> => {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await operation();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt + 1 < attempts && backoffMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)));
        }
      }
      throw lastError ?? new Error("Operation failed.");
    },
  };
}

/** In-memory observability sink suitable for tests and local development. */
export interface Observability {
  record(event: JsonObject): void;
  events(): readonly JsonObject[];
}

/** Create a no-dependency observability sink that can be bridged to a vendor later. */
export function autoObservability(): Observability {
  const values: JsonObject[] = [];
  return {
    record: (event) => values.push(event),
    events: () => [...values],
  };
}

/** Typed evaluation result for a deterministic local comparison. */
export interface EvaluationResult {
  readonly score: number;
  readonly pass: boolean;
}

/** Create a deterministic evaluator for fixtures and contributor tests. */
export function autoEvaluation(): { score(actual: JsonValue, expected: JsonValue): EvaluationResult } {
  return {
    score: (actual, expected) => {
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { score: pass ? 1 : 0, pass };
    },
  };
}

/** Minimal retriever contract for adding a real vector or keyword backend later. */
export interface Rag {
  retrieve(query: string): Promise<readonly JsonObject[]>;
}

/** Create an empty typed RAG boundary; retrieval backends can be composed explicitly. */
export function autoRag(): Rag {
  return { retrieve: async () => [] };
}

/** Typed process-local cache with JSON-safe values. */
export interface Cache {
  get<T extends JsonValue>(key: string): T | null;
  set<T extends JsonValue>(key: string, value: T): void;
  delete(key: string): void;
}

/** Create a JSON-safe local cache for development and deterministic tests. */
export function autoCache(): Cache {
  const values = new Map<string, JsonValue>();
  return {
    get: <T extends JsonValue>(key: string): T | null => {
      const value = values.get(key);
      return value === undefined ? null : value as T;
    },
    set: <T extends JsonValue>(key: string, value: T): void => {
      values.set(key, value);
    },
    delete: (key: string): void => {
      values.delete(key);
    },
  };
}

/** Re-exported here to keep zero-config option types discoverable from one file. */
export type { EnvReader, ProviderEnvironment };

