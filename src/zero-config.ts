import {
  ChatMessage,
  ChatResult,
  ChatStreamOptions,
  JsonObject,
  LLMProvider,
} from "@langgraph-toolkit/core";
import {
  createModelRegistry,
  type CommunityRegistryOptions,
  type EnvReader,
  type ProviderEnvironment,
} from "./providers.js";

/** A small model pool facade that preserves tier aliases for graph bindings. */
export interface ModelPool {
  readonly registry: ReturnType<typeof createModelRegistry>;
  get(tier?: string): LLMProvider;
  routing(policy: (tiers: readonly string[], input: JsonObject) => string): LLMProvider;
  fallback(tiers: readonly string[]): LLMProvider;
  loadBalance(tiers: readonly string[]): LLMProvider;
  ensemble(tiers: readonly string[], judge?: (responses: readonly ChatResult[]) => ChatResult | Promise<ChatResult>): LLMProvider;
}

/** Construct a tier-aware model pool with inferred cheap and strong defaults. */
export function createModelPool(options: CommunityRegistryOptions = {}): ModelPool {
  const registry = createModelRegistry(options);
  const provider = (tier: string): LLMProvider => registry.tier(tier);
  return {
    registry,
    get: (tier = "strong") => provider(tier),
    routing: (policy) => {
      const select = (messages: readonly ChatMessage[]): LLMProvider => {
        const input: JsonObject = {
          messages: messages.map((message): JsonObject => ({ role: message.role, content: message.content })),
        };
        return provider(policy(registry.tiers(), input));
      };
      return wrapProvider("routing", (messages, opts) => select(messages).chat(messages, opts), (messages, opts) => select(messages).stream(messages, opts));
    },
    fallback: (tiers) => {
      const names = requireTiers(tiers);
      const chat = async (messages: readonly ChatMessage[], opts?: ChatStreamOptions): Promise<ChatResult> => {
        let lastError: Error | undefined;
        for (const tier of names) {
          try {
            return await provider(tier).chat(messages, opts);
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
          }
        }
        throw lastError ?? new Error("Model fallback failed.");
      };
      return wrapProvider("fallback", chat);
    },
    loadBalance: (tiers) => {
      const names = requireTiers(tiers);
      let cursor = 0;
      const select = (): LLMProvider => {
        const tier = names[cursor % names.length];
        cursor += 1;
        return provider(tier);
      };
      return wrapProvider("load-balance", (messages, opts) => select().chat(messages, opts), (messages, opts) => select().stream(messages, opts));
    },
    ensemble: (tiers, judge) => {
      const names = requireTiers(tiers);
      const chat = async (messages: readonly ChatMessage[], opts?: ChatStreamOptions): Promise<ChatResult> => {
        const responses = await Promise.all(names.map((tier) => provider(tier).chat(messages, opts)));
        if (judge) return judge(responses);
        return responses.reduce((best, response) => response.content.length > best.content.length ? response : best);
      };
      return wrapProvider("ensemble", chat);
    },
  };
}

function requireTiers(tiers: readonly string[]): readonly string[] {
  if (tiers.length === 0) throw new Error("A model pool policy requires at least one tier.");
  return tiers;
}

function wrapProvider(
  name: string,
  chat: (messages: readonly ChatMessage[], opts?: ChatStreamOptions) => Promise<ChatResult>,
  stream?: (messages: readonly ChatMessage[], opts?: ChatStreamOptions) => AsyncIterable<string>,
): LLMProvider {
  return {
    name: `community:${name}`,
    chat,
    stream: stream ?? (async function* (messages, opts): AsyncIterable<string> {
      const response = await chat(messages, opts);
      if (response.content.length > 0) yield response.content;
    }),
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

/** Re-exported here to keep provider option types discoverable from one file. */
export type { EnvReader, ProviderEnvironment };
