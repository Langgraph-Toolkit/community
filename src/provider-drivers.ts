/**
 * Model registry + LLM provider drivers.
 *
 * Rule T3: nodes bind a tier alias, never a vendor. Switching from a hosted
 * vendor to an open-source model on Hugging Face is a config change.
 *
 * Built-in drivers:
 * - openai-compatible: OpenAI API, HF router (router.huggingface.co/v1),
 *   Ollama, vLLM, TGI, LiteLLM proxies
 * - huggingface: @huggingface/inference Inference Providers (serverless),
 *   with provider routing (auto/fastest/cheapest)
 * - mock: deterministic test double
 */
import { createModel } from "@langgraph-toolkit/core";
import type {
	Actor,
	ChatMessage,
	ChatResult,
	ChatStreamOptions,
	ChatStreamChunk,
	JsonObject,
	JsonValue,
	LLMProvider,
	LLMProviderConfig,
	ModelToolCall,
	ModelToolChoice,
	ModelToolSpec,
	ModelRegistry,
  ResponseFormat,
  Model,
} from "@langgraph-toolkit/core";

/** Community policy contract used by rolePolicy() and combinePolicies(). */
export type CommunityRunPolicy = (
  actor: Actor,
  graphName: string,
  opts: { readonly threadId?: string },
) => "allow" | "deny" | "interrupt" | Promise<"allow" | "deny" | "interrupt">;

function messagePayload(message: ChatMessage): JsonObject {
	const body: Record<string, JsonValue> = { role: message.role, content: message.content };
	if (message.name !== undefined) body.name = message.name;
	if (message.toolCallId !== undefined) body.tool_call_id = message.toolCallId;
	if (message.toolCalls !== undefined) {
		body.tool_calls = message.toolCalls.map((call) => ({
			id: call.id,
			type: "function",
			function: { name: call.name, arguments: JSON.stringify(call.arguments) },
		}));
	}
	return body;
}

function toolChoicePayload(choice: ModelToolChoice): JsonValue {
	return typeof choice === "string" ? choice : { type: "function", function: { name: choice.name } };
}

function responseFormatPayload(format: ResponseFormat): JsonObject {
	const body: Record<string, JsonValue> = { type: format.type };
	if (format.name !== undefined) body.name = format.name;
	if (format.schema !== undefined) body.schema = format.schema;
	if (format.strict !== undefined) body.strict = format.strict;
	return format.type === "json_schema" ? { type: "json_schema", json_schema: body } : body;
}

function isJsonObject(value: JsonValue): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestOptions(opts?: ChatStreamOptions): JsonObject {
	const body: Record<string, JsonValue> = {};
	if (opts?.tools !== undefined) {
		body.tools = opts.tools.map((tool: ModelToolSpec) => ({
			type: "function",
			function: { name: tool.name, description: tool.description, parameters: tool.parameters },
		}));
	}
	if (opts?.toolChoice !== undefined) body.tool_choice = toolChoicePayload(opts.toolChoice);
	if (opts?.responseFormat !== undefined) body.response_format = responseFormatPayload(opts.responseFormat);
	return body;
}

interface ProviderToolCall {
	readonly id?: string;
	readonly function?: { readonly name?: string; readonly arguments?: string };
}

function parseToolCalls(calls: readonly ProviderToolCall[] | undefined): readonly ModelToolCall[] {
	if (calls === undefined) return [];
	return calls.map((call, index) => {
		const name = call.function?.name ?? `tool_${index}`;
		const raw = call.function?.arguments ?? "{}";
		let parsed: JsonValue = {};
		try {
			parsed = JSON.parse(raw) as JsonValue;
		} catch {
			parsed = {};
		}
		const args: JsonObject = isJsonObject(parsed) ? parsed : {};
		return { id: call.id ?? `call_${index}`, name, arguments: args };
	});
}

/** Options for ToolkitModelRegistry: tier map plus optional usage meter (Rule T4). */
export interface ModelRegistryOptions {
  /** Tier alias -> vendor config. E.g. { cheap: { driver: "huggingface", model: "..." } }. */
  tiers: Record<string, LLMProviderConfig>;
  /** Token usage meter (Rule T4): cost measured per node before shipping topology. */
  meter?: (tier: string, usage: { input: number; output: number }) => void;
}

/**
 * Build a role-based RunPolicy (Rule A1). Roles are matched against
 * actor.roles; graphs with an empty allow-list deny everyone. Combine
 * multiple policies with combinePolicies().
 */
export function rolePolicy(allowedByGraph: Record<string, string[]>): CommunityRunPolicy {
  return (actor, graphName) => {
    const roles = actor.roles ?? [];
    const allowed = allowedByGraph[graphName] ?? [];
    if (allowed.length === 0) return "deny";
    return roles.some((r) => allowed.includes(r)) ? "allow" : "deny";
  };
}

/**
 * Combine policies: all must return "allow"; a "deny" denies; "interrupt"
 * (dangerous action awaiting approval) is preserved when no deny.
 */
export function combinePolicies(...policies: CommunityRunPolicy[]): CommunityRunPolicy {
  return async (actor, graphName, opts) => {
    let interrupted = false;
    for (const p of policies) {
      const d = await p(actor, graphName, opts);
      if (d === "deny") return "deny";
      if (d === "interrupt") interrupted = true;
    }
    return interrupted ? "interrupt" : "allow";
  };
}

/**
 * Build a plan-based TierResolver (Rule A2): downgrades node bindings for
 * actors on a cheaper plan. E.g. { free: { strong: "cheap" } } routes free
 * users to "cheap" whenever a node asks for "strong".
 */
export function planTierResolver(planMap: Record<string, Record<string, string>>) {
  return (
    actor: Actor,
    binding: { tier: string },
    _graphName: string,
  ): string => {
    const plan = String(actor.claims?.plan ?? "free");
    return planMap[plan]?.[binding.tier] ?? binding.tier;
  };
}

/**
 * Tier-to-provider registry (Rule T3): nodes bind tier aliases, hosts map
 * each alias to a vendor config. recordUsage() feeds the meter; reconfigure()
 * swaps models live without restart (e.g. promote a fine-tuned model).
 */
export class ToolkitModelRegistry implements ModelRegistry {
  /** Cumulative token usage per tier alias. */
  tokenUsage = new Map<string, { input: number; output: number }>();
  private providersByTier: Map<string, LLMProvider>;
  private configByTier = new Map<string, LLMProviderConfig>();
  private factory: (cfg: LLMProviderConfig) => LLMProvider;
  private meter?: ModelRegistryOptions["meter"];

  constructor(opts: ModelRegistryOptions) {
    this.factory = defaultProviderFactory;
    this.meter = opts.meter;
    this.providersByTier = new Map();
    for (const [alias, cfg] of Object.entries(opts.tiers)) {
      this.configByTier.set(alias, cfg);
      this.providersByTier.set(alias, this.factory(cfg));
    }
  }

  tier(alias: string): LLMProvider {
    const provider = this.providersByTier.get(alias);
    if (!provider) {
      throw new Error(`Unregistered model tier "${alias}". Declare it in the registry (Rule T3).`);
    }
    return provider;
  }

  /** Return the Core model facade for an already explicit, configured tier. */
  model(alias: string): Model {
    return createModel({ name: alias, provider: this.tier(alias) });
  }

  /** Return configured tier aliases in deterministic insertion order. */
  tiers(): readonly string[] {
    return [...this.providersByTier.keys()];
  }

  reconfigure(
    tiers: Record<string, LLMProviderConfig>,
    factory: (cfg: LLMProviderConfig) => LLMProvider = defaultProviderFactory,
  ): void {
    this.factory = factory;
    this.providersByTier.clear();
    this.configByTier.clear();
    for (const [alias, cfg] of Object.entries(tiers)) {
      this.configByTier.set(alias, cfg);
      this.providersByTier.set(alias, factory(cfg));
    }
  }

  /** Called by executor after each LLM call. */
  recordUsage(tier: string, usage: { input: number; output: number }): void {
    const current = this.tokenUsage.get(tier) ?? { input: 0, output: 0 };
    current.input += usage.input;
    current.output += usage.output;
    this.tokenUsage.set(tier, current);
    this.meter?.(tier, usage);
  }
}

/**
 * Default provider factory (Rule T3): dispatches on driver name to the
 * built-in implementations (openai-compatible, huggingface, mock).
 */
export function defaultProviderFactory(cfg: LLMProviderConfig): LLMProvider {
  switch (cfg.driver) {
    case "openai-compatible":
      return new OpenAiCompatibleProvider(cfg);
    case "huggingface":
      return new HuggingFaceProvider(cfg);
    case "mock":
      return new MockProvider(cfg);
    default:
      throw new Error(`Unregistered LLM driver "${(cfg as LLMProviderConfig).driver}"`);
  }
}

/**
 * OpenAI-compatible driver: covers OpenAI, HF router (https://router.huggingface.co/v1),
 * Ollama (http://localhost:11434/v1), vLLM, TGI, LiteLLM proxies.
 */
export class OpenAiCompatibleProvider implements LLMProvider {
  readonly name: string;
  constructor(private cfg: LLMProviderConfig) {
    this.name = `openai-compatible:${cfg.model}`;
  }

  private async fetchJson(messages: ChatMessage[], opts?: ChatStreamOptions & { stream?: boolean }): Promise<JsonObject | Response> {
    const url = `${(this.cfg.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
    const body = {
      model: this.cfg.model,
      messages: messages.map(messagePayload),
      ...((opts?.maxTokens ?? this.cfg.maxTokens) === undefined ? {} : { max_tokens: opts?.maxTokens ?? this.cfg.maxTokens }),
      ...((opts?.temperature ?? this.cfg.temperature) === undefined ? {} : { temperature: opts?.temperature ?? this.cfg.temperature }),
      ...((opts?.reasoningEffort ?? this.cfg.reasoningEffort) === undefined ? {} : { reasoning_effort: opts?.reasoningEffort ?? this.cfg.reasoningEffort }),
      ...requestOptions(opts),
      stream: opts?.stream ?? false,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey ?? ""}`,
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}): ${text}`);
    }
    if (opts?.stream) return res;
    return (await res.json()) as JsonObject;
  }

  async chat(messages: ChatMessage[], opts?: ChatStreamOptions): Promise<ChatResult> {
    const json = (await this.fetchJson(messages, opts)) as JsonObject & {
      choices: Array<{ message: { content?: string; tool_calls?: readonly ProviderToolCall[] }; finish_reason?: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: json.choices[0]?.message?.content ?? "",
      finishReason: json.choices[0]?.finish_reason,
      toolCalls: parseToolCalls(json.choices[0]?.message?.tool_calls),
      usage: json.usage
        ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
        : undefined,
    };
  }

  async *streamDetailed(messages: ChatMessage[], opts?: ChatStreamOptions): AsyncIterable<ChatStreamChunk> {
    const res = (await this.fetchJson(messages, { ...opts, stream: true })) as Response;
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: ReadonlyArray<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const reasoning = parsed.choices?.[0]?.delta?.reasoning_content ?? parsed.choices?.[0]?.delta?.reasoning;
          if (reasoning) yield { type: "reasoning", value: reasoning };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { type: "token", value: delta };
          for (const call of parsed.choices?.[0]?.delta?.tool_calls ?? []) {
            yield { type: "tool_call", value: { id: call.id, index: call.index ?? 0, name: call.function?.name, arguments: call.function?.arguments ?? "" } };
          }
          if (parsed.usage?.prompt_tokens !== undefined && parsed.usage?.completion_tokens !== undefined) {
            yield { type: "usage", value: { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens } };
          }
        } catch {
          // Ignore malformed vendor chunks while keeping the stream alive.
        }
      }
    }
  }

  async *stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string> {
    for await (const chunk of this.streamDetailed(messages, opts)) {
      if (chunk.type === "token") yield chunk.value;
    }
  }
}

/**
 * Hugging Face Inference Providers driver (serverless): one HF token,
 * 18+ providers routed automatically (auto/fastest/cheapest), open-source
 * models like Qwen3, Llama, DeepSeek, Mistral, Gemma, Phi.
 */
export class HuggingFaceProvider implements LLMProvider {
  readonly name: string;
  constructor(private cfg: LLMProviderConfig) {
    this.name = `huggingface:${cfg.model}`;
  }

  private async post(path: string, body: JsonObject, opts?: { signal?: AbortSignal }): Promise<JsonValue> {
    const url = `https://router.huggingface.co${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey ?? ""}`,
        "X-Provider": this.cfg.provider ?? "auto",
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HF Inference failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  async chat(messages: ChatMessage[], opts?: ChatStreamOptions): Promise<ChatResult> {
    const json = (await this.post("/v1/chat/completions", {
      model: this.cfg.model,
      messages: messages.map(messagePayload),
      ...((opts?.maxTokens ?? this.cfg.maxTokens) === undefined ? {} : { max_tokens: opts?.maxTokens ?? this.cfg.maxTokens }),
      ...((opts?.temperature ?? this.cfg.temperature) === undefined ? {} : { temperature: opts?.temperature ?? this.cfg.temperature }),
      ...((opts?.reasoningEffort ?? this.cfg.reasoningEffort) === undefined ? {} : { reasoning_effort: opts?.reasoningEffort ?? this.cfg.reasoningEffort }),
      ...requestOptions(opts),
      stream: false,
    }, opts)) as JsonObject & {
      choices: Array<{ message: { content?: string; tool_calls?: readonly ProviderToolCall[] }; finish_reason?: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: json.choices[0]?.message?.content ?? "",
      finishReason: json.choices[0]?.finish_reason,
      toolCalls: parseToolCalls(json.choices[0]?.message?.tool_calls),
      usage: json.usage
        ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
        : undefined,
    };
  }

  async *streamDetailed(messages: ChatMessage[], opts?: ChatStreamOptions): AsyncIterable<ChatStreamChunk> {
    const res = await fetch(`https://router.huggingface.co/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey ?? ""}`,
        "X-Provider": this.cfg.provider ?? "auto",
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: messages.map(messagePayload),
        ...((opts?.maxTokens ?? this.cfg.maxTokens) === undefined ? {} : { max_tokens: opts?.maxTokens ?? this.cfg.maxTokens }),
        ...((opts?.temperature ?? this.cfg.temperature) === undefined ? {} : { temperature: opts?.temperature ?? this.cfg.temperature }),
        ...((opts?.reasoningEffort ?? this.cfg.reasoningEffort) === undefined ? {} : { reasoning_effort: opts?.reasoningEffort ?? this.cfg.reasoningEffort }),
        ...requestOptions(opts),
        stream: true,
      }),
      signal: opts?.signal,
    });
    if (!res.ok) {
      throw new Error(`HF Inference stream failed (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: ReadonlyArray<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const reasoning = parsed.choices?.[0]?.delta?.reasoning_content ?? parsed.choices?.[0]?.delta?.reasoning;
          if (reasoning) yield { type: "reasoning", value: reasoning };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { type: "token", value: delta };
          for (const call of parsed.choices?.[0]?.delta?.tool_calls ?? []) {
            yield { type: "tool_call", value: { id: call.id, index: call.index ?? 0, name: call.function?.name, arguments: call.function?.arguments ?? "" } };
          }
          if (parsed.usage?.prompt_tokens !== undefined && parsed.usage?.completion_tokens !== undefined) {
            yield { type: "usage", value: { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens } };
          }
        } catch {
          // Ignore malformed vendor chunks while keeping the stream alive.
        }
      }
    }
  }

  async *stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string> {
    for await (const chunk of this.streamDetailed(messages, opts)) {
      if (chunk.type === "token") yield chunk.value;
    }
  }
}

/** Mock provider for tests: deterministic, no network. */
export class MockProvider implements LLMProvider {
  readonly name: string;
  constructor(private cfg: LLMProviderConfig) {
    this.name = `mock:${cfg.model}`;
  }

  private response(): string {
    return this.cfg.mockResponse ?? `mock:${this.cfg.model}:${1}`;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    return { content: this.cfg.mockResponse ?? `mock:${this.cfg.model}:${messages.length}`, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  async *streamDetailed(): AsyncIterable<ChatStreamChunk> {
    yield { type: "token", value: this.response() };
    yield { type: "usage", value: { inputTokens: 0, outputTokens: this.response().length } };
  }
  async *stream(): AsyncIterable<string> {
    for await (const chunk of this.streamDetailed()) {
      if (chunk.type === "token") yield chunk.value;
    }
  }
}
