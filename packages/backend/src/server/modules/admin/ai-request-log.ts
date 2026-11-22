import { db } from "@/server/core/db";
import { logger } from "@/server/core/logger";
import type { AiRequestStatus } from "@/generated/prisma/enums";

/**
 * AI request log writer (stream C). Every model call attempt of the agents runtime (agent turns, quick calls,
 * platform calls) and the Voice OS stream is recorded as one `ai_request_logs` row: who (org, company, user, AI
 * employee, task), what (operation, profile, tier, requested and served model, provider), the outcome (status, error
 * code, latency) and the spend (tokens, micro-USD). **Never prompt or reply content.** Error messages are the
 * runtime's own safe messages, truncated.
 *
 * Writes are fire-and-forget and batched: rows are buffered and flushed with one INSERT (createMany) per second or
 * per 50 rows, so a model call never waits on the log and a failing log never fails the call. Kept 30 days
 * (`purgeAiRequestLogs`, run by the admin-c retention job).
 *
 * Deliberately tiny imports (db, logger) so the agents runtime can import it without load-time cycles.
 */

export interface AiRequestLogEntry {
  organizationId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  taskId?: string | null;
  aiEmployeeId?: string | null;
  traceId?: string | null;
  operation: string;
  profile?: string | null;
  department?: string | null;
  tier?: string | null;
  provider: string;
  requestedModel: string;
  servedModel?: string | null;
  status: AiRequestStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costMicros?: number | bigint;
  attempt?: number;
  streamed?: boolean;
}

/** Days the log is kept. */
export const AI_REQUEST_LOG_RETENTION_DAYS = 30;
const FLUSH_MS = 1_000;
const FLUSH_AT = 50;
/** Hard cap on buffered rows (a DB outage must not grow memory without bound): older rows are dropped, counted. */
const MAX_BUFFER = 2_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);
const clip = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);
const int = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(2_147_483_647, Math.round(v))) : 0);
/** Strip anything that looks like a credential from an error message before it is stored. */
export const scrubSecret = (s: string) =>
  s
    .replace(/\b(sk|pk|rk|key|xai|AIza)[-_A-Za-z0-9]{12,}\b/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]");

let buffer: ReturnType<typeof toRow>[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let dropped = 0;
let disabled = false;

function toRow(e: AiRequestLogEntry) {
  return {
    organizationId: uuidOrNull(e.organizationId),
    companyId: uuidOrNull(e.companyId),
    userId: uuidOrNull(e.userId),
    taskId: uuidOrNull(e.taskId),
    aiEmployeeId: uuidOrNull(e.aiEmployeeId),
    traceId: clip(e.traceId, 200),
    operation: clip(e.operation, 80) ?? "unknown",
    profile: clip(e.profile, 80),
    department: clip(e.department, 60),
    tier: clip(e.tier, 30),
    provider: clip(e.provider, 40) ?? "unknown",
    requestedModel: clip(e.requestedModel, 120) ?? "unknown",
    servedModel: clip(e.servedModel, 120),
    status: e.status,
    errorCode: clip(e.errorCode, 80),
    errorMessage: e.errorMessage ? scrubSecret(e.errorMessage).slice(0, 300) : null,
    latencyMs: e.latencyMs == null ? null : int(e.latencyMs),
    inputTokens: int(e.inputTokens),
    outputTokens: int(e.outputTokens),
    cachedTokens: int(e.cachedTokens),
    costMicros: typeof e.costMicros === "bigint" ? e.costMicros : BigInt(int(Number(e.costMicros ?? 0))),
    attempt: Math.max(1, int(e.attempt ?? 1)),
    streamed: e.streamed ?? false,
  };
}

/** Record one model call attempt (never throws, never awaits the database). */
export function logAiRequest(e: AiRequestLogEntry): void {
  if (disabled) return;
  try {
    buffer.push(toRow(e));
    if (buffer.length > MAX_BUFFER) {
      dropped += buffer.length - MAX_BUFFER;
      buffer = buffer.slice(-MAX_BUFFER);
    }
    if (buffer.length >= FLUSH_AT) void flushAiRequestLogs();
    else if (!timer) {
      timer = setTimeout(() => void flushAiRequestLogs(), FLUSH_MS);
      timer.unref?.();
    }
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, "AI request log entry skipped");
  }
}

/** Write buffered rows now (also used by tests and on shutdown). */
export async function flushAiRequestLogs(): Promise<number> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!buffer.length) return 0;
  const rows = buffer;
  buffer = [];
  try {
    const r = await db().aiRequestLog.createMany({ data: rows });
    if (dropped) {
      logger.warn({ dropped }, "AI request log rows dropped while the database was unavailable");
      dropped = 0;
    }
    return r.count;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), rows: rows.length }, "AI request log not written");
    return 0;
  }
}

/** Test seam: turn the writer off (e.g. for tests that count queries). */
export function setAiRequestLogEnabled(on: boolean) {
  disabled = !on;
}

/** Retention: delete rows older than AI_REQUEST_LOG_RETENTION_DAYS, in bounded batches. Returns rows deleted. */
export async function purgeAiRequestLogs(now = Date.now(), batch = 5_000, maxBatches = 20): Promise<number> {
  const cutoff = new Date(now - AI_REQUEST_LOG_RETENTION_DAYS * 86_400_000);
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = await db().$executeRaw`DELETE FROM ai_request_logs WHERE id IN (SELECT id FROM ai_request_logs WHERE created_at < ${cutoff} LIMIT ${batch})`;
    total += n;
    if (n < batch) break;
  }
  return total;
}

if (typeof process !== "undefined" && typeof process.once === "function") {
  process.once("beforeExit", () => void flushAiRequestLogs());
}
