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
};
