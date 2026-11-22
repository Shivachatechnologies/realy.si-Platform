/**
 * Cost estimation for AI tasks. Prices are the providers' list prices (Anthropic, OpenAI, Google Gemini) in USD per
 * million tokens (input / output); platform admins override them in Admin → AI (costs/prices.ts). Since $ per 1M tokens equals micro-dollars per token, cost in micro-USD is tokens × price.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-2": { input: 8, output: 40 },
  "claude-mythos-5-2": { input: 8, output: 40 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-mythos-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI and Google Gemini (agent runtime adapters, agents/providers).
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
};

/** Fallback when a task ran on a model missing from the table (priced like the default Opus tier). */
const DEFAULT_PRICE = { input: 5, output: 25 };

/** Price for a model id; tolerates date / region suffixes and provider prefixes. */
export function priceFor(model: string | null | undefined) {
  if (!model) return DEFAULT_PRICE;
  const bare = model.replace(/^(?:[a-z]+\.)?anthropic\./, "").replace(/@.*$/, "");
  if (MODEL_PRICES[bare]) return MODEL_PRICES[bare];
  const key = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => bare.startsWith(k));
  return key ? MODEL_PRICES[key]! : DEFAULT_PRICE;
}

/** Estimated cost in micro-USD (1e-6 USD). */
export function costMicros(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return Math.round(inputTokens * p.input + outputTokens * p.output);
}

/** Micro-USD → USD cents (minor units), for formatMoney. */
export const microsToCents = (micros: number) => BigInt(Math.round(micros / 10_000));
