# @langgraph-toolkit/community

Optional provider presets for **Langgraph-Toolkit**. The package keeps the core graph contracts framework-neutral and adds small typed helpers for open-source model deployments.

## Supported deployment shapes

The initial package supports Hugging Face Inference Providers and any OpenAI-compatible endpoint, including common local or self-hosted deployments such as Ollama, vLLM, TGI, and LiteLLM. A LoRA or fine-tuned model is configured by changing the model identifier or compatible endpoint. Graph nodes and state contracts do not change.

```ts
import {
  createCommunityModelRegistry,
  type CommunityModelProfile,
} from "@langgraph-toolkit/community";

const profiles: Record<string, CommunityModelProfile> = {
  cheap: {
    driver: "huggingface",
    model: "Qwen/Qwen3-8B",
    tokenEnv: "HF_TOKEN",
    provider: "auto",
    maxTokens: 512,
  },
  local: {
    driver: "openai-compatible",
    model: "my-lora-adapter",
    baseUrlEnv: "LOCAL_LLM_BASE_URL",
    tokenEnv: "LOCAL_LLM_API_KEY",
    maxTokens: 1024,
  },
};

const registry = createCommunityModelRegistry({
  tiers: profiles,
  environment: process.env,
});

const provider = registry.tier("cheap");
const result = await provider.chat([{ role: "user", content: "Summarize the result." }]);
console.log(result.content);
```

No provider SDK is required by this package. Credentials are read from an injected environment object or an `EnvReader`, which makes configuration easy to test and compatible with a database-backed or secret-manager-backed loader.

## Scope boundary

This package does not put training orchestration, vendor credentials, or framework adapters into core. Training and fine-tuning pipelines can publish a model endpoint or model identifier, then reuse the same provider profile. Image generation providers such as fal.ai should be added as a separate typed capability rather than pretending that an image API is an `LLMProvider`.
