import "server-only";
import { db, type Prisma } from "@/server/core/db";
import { logger } from "@/server/core/logger";

/**
 * Usage & cost tracking of the generic provider services. Costs are ESTIMATES from public list prices (micro-USD),
 * shown as such in the UI; null when the price is unknown. Never throws (metering must not break a feature).
 */

export interface UsageEntry {
  organizationId: string;
  companyId: string;
  connectionId?: string | null;
  provider: string;
  operation: string;
  units?: number;
  unit?: "request" | "token" | "image" | "second" | "byte" | "message";
  estimatedCostMicros?: number | null;
  status: "SUCCEEDED" | "FAILED";
  error?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordUsage(e: UsageEntry): Promise<void> {
  try {
    await db().integrationUsage.create({
      data: {
        organizationId: e.organizationId,
        companyId: e.companyId,
        connectionId: e.connectionId ?? null,
        provider: e.provider,
        operation: e.operation,
        units: Math.max(0, Math.round(e.units ?? 1)),
        unit: e.unit ?? "request",
        estimatedCostMicros: e.estimatedCostMicros == null ? null : Math.max(0, Math.round(e.estimatedCostMicros)),
        status: e.status,
        error: e.error?.slice(0, 300) ?? null,
        meta: (e.meta ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.warn({ provider: e.provider, operation: e.operation, err: err instanceof Error ? err.message : "usage write failed" }, "integration usage write failed");
  }
}

/** USD per 1M tokens [input, output] — public list prices; unknown models get no estimate. */
const TOKEN_PRICES: [RegExp, number, number][] = [
  [/^gpt-4\.1-nano/, 0.1, 0.4],
  [/^gpt-4\.1-mini/, 0.4, 1.6],
  [/^gpt-4\.1/, 2, 8],
  [/^gpt-4o-mini/, 0.15, 0.6],
  [/^gpt-4o/, 2.5, 10],
  [/^gpt-5-nano/, 0.05, 0.4],
  [/^gpt-5-mini/, 0.25, 2],
  [/^gpt-5/, 1.25, 10],
  [/^gemini-2\.5-flash-lite/, 0.1, 0.4],
  [/^gemini-2\.5-flash/, 0.3, 2.5],
  [/^gemini-2\.5-pro/, 1.25, 10],
  [/^gemini-2\.0-flash/, 0.1, 0.4],
];

export function estimateTokenCostMicros(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = TOKEN_PRICES.find(([re]) => re.test(model));
  if (!p) return null;
  // USD per 1M tokens == micro-USD per token.
  return inputTokens * p[1] + outputTokens * p[2];
}

/** Flat per-call estimates in micro-USD (list prices at the default settings). */
export const FLAT_COST_MICROS: Record<string, number> = {
  "tavily.search": 8_000,
  "exa.search": 5_000,
  "serpapi.search": 15_000,
  "openai.image": 42_000,
  "stability.image": 30_000,
  "replicate.image": 3_000,
  "runway.second": 50_000,
  "twilio.sms": 7_900,
  "twilio.whatsapp": 5_000,
  "sendgrid.email": 1_000,
  /** ElevenLabs: ~$0.18 per 1,000 characters on the Creator plan overage (per character). */
  "elevenlabs.character": 180,
  /** ElevenLabs Scribe: $0.40 per audio hour (per second). */
  "elevenlabs.stt_second": 111,
  /** Deepgram Nova-3 pre-recorded: $0.0043 per minute (per second). */
  "deepgram.stt_second": 72,
  /** Luma Ray 2: ~$0.32 per 5 s 720p clip (per second). */
  "luma.second": 64_000,
  /** Kling standard 5 s clip ≈ $0.14 (per second). */
  "kling.second": 28_000,
  /** Shotstack pay-as-you-go: $0.40 per rendered minute (per second). */
  "shotstack.second": 6_700,
  /** Creatomate: ~$0.015 per rendered second at entry tier. */
  "creatomate.second": 15_000,
  /** Twilio Voice US outbound: $0.014 per minute (per second). */
  "twilio.voice_second": 233,
  /** Plaid Transactions: billed per connected item per month — not per call; recorded as 0. */
  "plaid.sync": 0,
};
