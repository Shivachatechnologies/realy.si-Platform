/**
 * AI providers the agent runtime can call (G1, B13). Pure data: no imports, so admin/ai-models.ts, costs and the
 * runtime can all use it without load-time cycles. Every key is Realy's own platform key (Admin → Platform keys);
 * customers never enter AI provider keys.
 */

export type AiProviderKey = "anthropic" | "openai" | "gemini";

export interface AiProviderInfo {
  key: AiProviderKey;
  label: string;
  /** Platform key holding the provider's API key (core/platform-secrets overlays it onto process.env). */
  envKey: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY";
  match: (model: string) => boolean;
  /**
   * Models used when another provider's model fails and this provider takes over (cross-provider fallback), per
   * complexity tier. Admins override routing per tier in Admin → AI → Models; these are only the built-in defaults.
   */
  fallbackModels: { simple: string; standard: string; complex: string };
}

const OPENAI_RE = /^(gpt-|o\d|chatgpt-)/;
const GEMINI_RE = /^gemini-/;

export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    key: "anthropic",
    label: "Anthropic API",
    envKey: "ANTHROPIC_API_KEY",
    match: (m) => !OPENAI_RE.test(m) && !GEMINI_RE.test(m),
    fallbackModels: { simple: "claude-haiku-5-5", standard: "claude-sonnet-5-5", complex: "claude-opus-5-5" },
  },
  { key: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY", match: (m) => OPENAI_RE.test(m), fallbackModels: { simple: "gpt-5-mini", standard: "gpt-5", complex: "gpt-5" } },
  { key: "gemini", label: "Google Gemini", envKey: "GEMINI_API_KEY", match: (m) => GEMINI_RE.test(m), fallbackModels: { simple: "gemini-2.5-flash", standard: "gemini-2.5-pro", complex: "gemini-2.5-pro" } },
];

export const AI_PROVIDER_KEYS = AI_PROVIDERS.map((p) => p.key) as [AiProviderKey, ...AiProviderKey[]];

/** The provider serving a model id (unknown ids are Anthropic's, the platform default). */
export const providerOf = (model: string | null | undefined): AiProviderKey => (model ? (AI_PROVIDERS.find((p) => p.match(model))?.key ?? "anthropic") : "anthropic");

export const providerInfo = (key: AiProviderKey) => AI_PROVIDERS.find((p) => p.key === key)!;

/** True when the platform key of the provider is set (never reads the value into a result). */
export function providerKeyConfigured(key: AiProviderKey): boolean {
  const v = process.env[providerInfo(key).envKey];
  return !!v && v.trim().length > 0;
}
