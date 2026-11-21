import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import type { CostCategory } from "@/generated/prisma/enums";
import { recordCost } from "./service";

/**
 * Mirrors spend that other modules already meter into the cost ledger (idempotent by source id):
 *  - integration usage (integrations/usage.ts → IntegrationUsage, written by providerFetch-based services) with a
 *    known estimated cost: images, video, research, SMS/WhatsApp, email providers, external AI text, contacts...
 *  - finished voice calls with a provider-reported cost (VoiceCall.costMinor, from the voice webhooks).
 * Business trigger: only rows that exist (real spend) are copied; nothing runs when there is nothing new.
 */

const log = logger.child({ component: "costs-sync" });
const BATCH = 1000;
const LOOKBACK_MS = 3 * 86_400_000;

function categoryOf(operation: string, unit: string): CostCategory {
  if (operation.startsWith("images.")) return "IMAGE";
  if (operation.startsWith("video.") || unit === "second") return "VIDEO";
  if (operation.startsWith("tts.")) return "TTS";
  if (operation.startsWith("stt.") || operation.startsWith("transcribe")) return "STT";
  if (operation.startsWith("voice.") || operation.startsWith("call.")) return "TELEPHONY";
  if (operation.startsWith("email.") || operation.includes("email")) return "EMAIL";
  if (operation.startsWith("sms.")) return "SMS";
  if (operation.startsWith("whatsapp.") || operation.startsWith("messaging.")) return "MESSAGING";
  if (operation.startsWith("ai.") || unit === "token") return "AI_TOKENS";
  return "EXTERNAL_API";
}

/** Copy new successful integration usage rows that carry a cost. Returns how many ledger rows were written. */
export async function syncIntegrationUsage(): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const rows = await db().integrationUsage.findMany({
    where: { createdAt: { gte: since }, status: "SUCCEEDED", estimatedCostMicros: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    take: BATCH * 5,
    select: { id: true, organizationId: true, companyId: true, provider: true, operation: true, units: true, unit: true, estimatedCostMicros: true, meta: true, createdAt: true },
  });
  if (!rows.length) return 0;
  const known = new Set(
    (await db().costLedgerEntry.findMany({ where: { sourceType: "integration_usage", sourceId: { in: rows.map((r) => r.id) } }, select: { sourceId: true } })).map((r) => r.sourceId),
  );
  let n = 0;
  for (const r of rows.filter((x) => !known.has(x.id)).slice(0, BATCH)) {
    const meta = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>;
    const model = typeof meta.model === "string" ? meta.model : null;
    const ok = await recordCost({
      organizationId: r.organizationId,
      companyId: r.companyId,
      category: categoryOf(r.operation, r.unit),
      provider: r.provider,
      model,
      operation: r.operation,
      sourceType: "integration_usage",
      sourceId: r.id,
      inputTokens: typeof meta.inputTokens === "number" ? meta.inputTokens : 0,
      outputTokens: typeof meta.outputTokens === "number" ? meta.outputTokens : 0,
      units: r.units,
      unit: r.unit,
      costMicros: r.estimatedCostMicros ?? 0,
      estimated: true,
      occurredAt: r.createdAt,
    });
    if (ok) n++;
  }
  if (n) log.info({ n }, "integration usage mirrored into the cost ledger");
  return n;
}

/** Copy ended voice calls with a provider-reported cost (USD only; other currencies are left out, never converted). */
export async function syncVoiceCalls(): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const calls = await db().voiceCall.findMany({
    where: { updatedAt: { gte: since }, costMinor: { gt: 0 }, costCurrency: "USD" },
    orderBy: { updatedAt: "desc" },
    take: BATCH,
    select: { id: true, organizationId: true, companyId: true, provider: true, durationSec: true, costMinor: true, endedAt: true, createdAt: true, direction: true },
  });
  if (!calls.length) return 0;
  const known = new Set((await db().costLedgerEntry.findMany({ where: { sourceType: "voice_call", sourceId: { in: calls.map((c) => c.id) } }, select: { sourceId: true } })).map((r) => r.sourceId));
  let n = 0;
  for (const c of calls) {
    if (known.has(c.id) || c.costMinor === null) continue;
    const ok = await recordCost({
      organizationId: c.organizationId,
      companyId: c.companyId,
      category: "TELEPHONY",
      provider: (c.provider ?? "voice").toLowerCase(),
      operation: `voice.call.${c.direction.toLowerCase()}`,
      sourceType: "voice_call",
      sourceId: c.id,
      units: Math.max(1, Math.ceil((c.durationSec ?? 0) / 60)),
      unit: "minute",
      // Cents → micro-USD.
      costMicros: c.costMinor * 10_000n,
      estimated: false,
      occurredAt: c.endedAt ?? c.createdAt,
    });
    if (ok) n++;
  }
  return n;
}

/** Expired dedup cache rows are removed. */
export async function pruneRequestCache(): Promise<number> {
  const r = await db().agentRequestCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}
