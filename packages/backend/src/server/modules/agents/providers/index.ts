import { providerOf, type AiProviderKey } from "./catalog";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { openAiProvider } from "./openai";
import type { ModelProvider } from "./types";

/** Provider registry of the agent runtime (G1, B13): Anthropic, OpenAI and Gemini adapters behind one interface. */
export const MODEL_PROVIDERS: Record<AiProviderKey, ModelProvider> = { anthropic: anthropicProvider, openai: openAiProvider, gemini: geminiProvider };

export const providerFor = (model: string): ModelProvider => MODEL_PROVIDERS[providerOf(model)];

/** Providers whose platform key is set. */
export const configuredProviders = (): AiProviderKey[] => (Object.keys(MODEL_PROVIDERS) as AiProviderKey[]).filter((k) => MODEL_PROVIDERS[k].configured());

export { providerOf, AI_PROVIDERS, AI_PROVIDER_KEYS, providerInfo, type AiProviderKey } from "./catalog";
export { ProviderHttpError, ProviderNotConfigured, setProviderFetchForTests, type ModelProvider, type ModelRequest, type ModelResponse } from "./types";
