import { z } from "zod";
import { db, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { addLogSink } from "@/server/core/logger";
import type { ProcessApp } from "@/server/core/observability";
import { scrub } from "@/server/core/telemetry";
import { canPlatform, requireAnyPlatform } from "./access";
import { scrubText } from "./errors";

/**
 * Logs explorer (stream E) over the structured sources the platform already stores: audit events, worker job runs,
 * Stripe webhook events, email deliveries, integration request logs, captured error events and the optional
 * `app_log_entries` (warn and above from core/logger.ts, batched and rate limited). Each source is queried with the
 * same time window and keyset (newest first), merged, and cut to one page. Secrets and personal data are masked:
 * recipients show only their domain, URLs lose their query, free text passes through scrubText.
 */

export const LOGS_READ = ["platform.logs.read"];

export const LOG_SOURCES = ["audit", "jobs", "stripe", "email", "integrations", "errors", "app"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];
export const LOG_LEVELS = ["info", "warn", "error"] as const;
type Level = (typeof LOG_LEVELS)[number];

export interface LogLine {
  /** `<source>:<id>` (unique across sources). */
  key: string;
  source: LogSource;
  id: string;
  at: Date;
  level: Level;
  message: string;
  requestId: string | null;
  organizationId: string | null;
  /** Masked, secret-free attributes. */
  attrs: Record<string, string | number | boolean | null>;
  /** Locale-relative console link to the record, when one exists. */
  href: string | null;
}

const iso = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/));

export const logFilters = z.object({
  source: z.enum(LOG_SOURCES).optional(),
  level: z.enum(LOG_LEVELS).optional(),
  q: z.string().trim().max(200).optional(),
  requestId: z.string().trim().max(100).optional(),
  organizationId: z.string().uuid().optional(),
  from: iso.optional(),
  to: iso.optional(),
  /** Keyset cursor: ISO time of the last line of the previous page. */
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(10).max(200).default(50),
});

const maskEmail = (e: string) => {
  const at = e.indexOf("@");
  return at > 0 ? `•••@${e.slice(at + 1)}` : "•••";
};
const hostPath = (u: string) => u.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").slice(0, 160);

interface Window {
  gte?: Date;
  lt: Date;
  take: number;
  q?: string;
  requestId?: string;
  organizationId?: string;
  level?: Level;
}

type Fetcher = (w: Window) => Promise<LogLine[]>;

const contains = (q?: string) => (q ? { contains: q, mode: "insensitive" as const } : undefined);

const SOURCES: Record<LogSource, Fetcher> = {
  async audit(w) {
    if (w.level && w.level !== "info" && w.level !== "warn") return [];
    const rows = await db().auditLog.findMany({
      where: { createdAt: { gte: w.gte, lt: w.lt }, ...(w.requestId ? { requestId: w.requestId } : {}), ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { action: contains(w.q) } : {}), ...(w.level === "warn" ? { category: "SECURITY" } : {}) },
      orderBy: { createdAt: "desc" },
      take: w.take,
      select: { id: true, category: true, action: true, actorType: true, resourceType: true, resourceId: true, requestId: true, organizationId: true, createdAt: true },
    });
    return rows.map((r) => ({ key: `audit:${r.id}`, source: "audit", id: r.id, at: r.createdAt, level: r.category === "SECURITY" ? "warn" : "info", message: r.action, requestId: r.requestId, organizationId: r.organizationId, attrs: { category: r.category, actor: r.actorType, resource: r.resourceType, resourceId: r.resourceId }, href: `/audit?action=${encodeURIComponent(r.action)}` }));
  },
  async jobs(w) {
    if (w.requestId) return [];
    const status = w.level === "error" ? { in: ["FAILED", "DEAD"] as ("FAILED" | "DEAD")[] } : w.level === "warn" ? { in: ["RETRYING"] as "RETRYING"[] } : w.level === "info" ? { in: ["ACTIVE", "SUCCEEDED", "REQUEUED"] as ("ACTIVE" | "SUCCEEDED" | "REQUEUED")[] } : undefined;
    const rows = await db().workerJobRun.findMany({
      where: { updatedAt: { gte: w.gte, lt: w.lt }, ...(status ? { status } : {}), ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { OR: [{ jobName: contains(w.q) }, { lastError: contains(w.q) }] } : {}) },
      orderBy: { updatedAt: "desc" },
      take: w.take,
      select: { id: true, queue: true, jobName: true, status: true, attempts: true, maxAttempts: true, lastError: true, durationMs: true, organizationId: true, updatedAt: true },
    });
    return rows.map((r) => ({ key: `jobs:${r.id}`, source: "jobs", id: r.id, at: r.updatedAt, level: r.status === "FAILED" || r.status === "DEAD" ? "error" : r.status === "RETRYING" ? "warn" : "info", message: `${r.queue}/${r.jobName} ${r.status}${r.lastError && r.status !== "SUCCEEDED" ? `: ${scrubText(r.lastError, 200)}` : ""}`, requestId: null, organizationId: r.organizationId, attrs: { queue: r.queue, status: r.status, attempts: `${r.attempts}/${r.maxAttempts}`, durationMs: r.durationMs }, href: `/system/jobs?run=${r.id}` }));
  },
  async stripe(w) {
    if (w.requestId) return [];
    const warnOutcomes = ["unknown_organization", "unknown_price", "customer_mismatch", "duplicate_subscription"];
    if (w.level === "error") return [];
    const rows = await db().stripeEvent.findMany({
      where: { processedAt: { gte: w.gte, lt: w.lt }, ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { type: contains(w.q) } : {}), ...(w.level === "warn" ? { OR: [{ outcome: { in: warnOutcomes } }, { type: "invoice.payment_failed" }] } : w.level === "info" ? { outcome: { notIn: warnOutcomes }, type: { not: "invoice.payment_failed" } } : {}) },
      orderBy: { processedAt: "desc" },
      take: w.take,
    });
    return rows.map((r) => ({ key: `stripe:${r.id}`, source: "stripe", id: r.id, at: r.processedAt, level: warnOutcomes.includes(r.outcome) || r.type === "invoice.payment_failed" ? "warn" : "info", message: `${r.type} → ${r.outcome}`, requestId: null, organizationId: r.organizationId, attrs: { type: r.type, outcome: r.outcome, livemode: r.livemode }, href: null }));
  },
  async email(w) {
    if (w.requestId) return [];
    const status = w.level === "error" ? "FAILED" : w.level === "warn" ? "NOT_CONFIGURED" : w.level === "info" ? "SENT" : undefined;
    const rows = await db().emailMessage.findMany({
      where: { createdAt: { gte: w.gte, lt: w.lt }, ...(status ? { status } : {}), ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { template: contains(w.q) } : {}) },
      orderBy: { createdAt: "desc" },
      take: w.take,
      select: { id: true, toEmail: true, template: true, locale: true, status: true, provider: true, error: true, organizationId: true, createdAt: true },
    });
    return rows.map((r) => ({ key: `email:${r.id}`, source: "email", id: r.id, at: r.createdAt, level: r.status === "FAILED" ? "error" : r.status === "NOT_CONFIGURED" ? "warn" : "info", message: `${r.template} ${r.status}${r.error ? `: ${scrubText(r.error, 200)}` : ""}`, requestId: null, organizationId: r.organizationId, attrs: { to: maskEmail(r.toEmail), template: r.template, locale: r.locale, provider: r.provider }, href: null }));
  },
  async integrations(w) {
    if (w.requestId) return [];
    const statusFilter: Prisma.IntegrationRequestLogWhereInput = w.level === "error" ? { OR: [{ status: null }, { status: { gte: 500 } }] } : w.level === "warn" ? { status: { gte: 400, lt: 500 } } : w.level === "info" ? { status: { lt: 400 } } : {};
    const rows = await db().integrationRequestLog.findMany({
      where: { createdAt: { gte: w.gte, lt: w.lt }, ...statusFilter, ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { OR: [{ provider: contains(w.q) }, { url: contains(w.q) }] } : {}) },
      orderBy: { createdAt: "desc" },
      take: w.take,
      select: { id: true, provider: true, method: true, url: true, status: true, durationMs: true, attempts: true, error: true, organizationId: true, createdAt: true },
    });
    return rows.map((r) => ({ key: `integrations:${r.id}`, source: "integrations", id: r.id, at: r.createdAt, level: r.status === null || r.status >= 500 ? "error" : r.status >= 400 ? "warn" : "info", message: `${r.provider} ${r.method} ${hostPath(r.url)} → ${r.status ?? "network error"}${r.error ? `: ${scrubText(r.error, 160)}` : ""}`, requestId: null, organizationId: r.organizationId, attrs: { provider: r.provider, status: r.status, durationMs: r.durationMs, attempts: r.attempts }, href: `/organizations/${r.organizationId}/integrations` }));
  },
  async errors(w) {
    if (w.level && w.level !== "error") return [];
    const rows = await db().errorEvent.findMany({
      where: { createdAt: { gte: w.gte, lt: w.lt }, ...(w.requestId ? { requestId: w.requestId } : {}), ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { OR: [{ route: contains(w.q) }, { stack: contains(w.q) }] } : {}) },
      orderBy: { createdAt: "desc" },
      take: w.take,
      select: { id: true, groupId: true, route: true, method: true, statusCode: true, release: true, requestId: true, organizationId: true, stack: true, createdAt: true },
    });
    return rows.map((r) => ({ key: `errors:${r.id}`, source: "errors", id: r.id, at: r.createdAt, level: "error", message: (r.stack?.split("\n")[0] ?? "Error").slice(0, 300), requestId: r.requestId, organizationId: r.organizationId, attrs: { route: r.route, method: r.method, status: r.statusCode, release: r.release }, href: `/errors/${r.groupId}` }));
  },
  async app(w) {
    if (w.level === "info") return [];
    const rows = await db().appLogEntry.findMany({
      where: { createdAt: { gte: w.gte, lt: w.lt }, ...(w.level ? { level: w.level === "error" ? { in: ["error", "fatal"] } : "warn" } : {}), ...(w.requestId ? { requestId: w.requestId } : {}), ...(w.organizationId ? { organizationId: w.organizationId } : {}), ...(w.q ? { message: contains(w.q) } : {}) },
      orderBy: { createdAt: "desc" },
      take: w.take,
    });
    return rows.map((r) => ({ key: `app:${r.id}`, source: "app", id: r.id, at: r.createdAt, level: r.level === "warn" ? "warn" : "error", message: r.message, requestId: r.requestId, organizationId: r.organizationId, attrs: { source: r.source, ...((r.data ?? {}) as Record<string, string | number | boolean | null>) }, href: null }));
  },
};

/** One page of merged log lines, newest first. Audit lines need platform.audit.read in addition. */
export async function searchLogs(ctx: RequestContext, raw: z.input<typeof logFilters> = {}) {
  await requireAnyPlatform(ctx, LOGS_READ);
  const f = logFilters.parse(raw);
  const canAudit = await canPlatform(ctx, "platform.audit.read");
  const to = f.to ? new Date(f.to) : null;
  const before = f.before ? new Date(f.before) : null;
  const lt = new Date(Math.min(to?.getTime() ?? Date.now() + 60_000, before?.getTime() ?? Infinity));
  // Default window: 7 days (bounded scans on every source).
  const gte = f.from ? new Date(f.from) : new Date(lt.getTime() - 7 * 86_400_000);
  const sources = (f.source ? [f.source] : [...LOG_SOURCES]).filter((s) => s !== "audit" || canAudit);
  const w: Window = { gte, lt, take: f.limit, q: f.q, requestId: f.requestId, organizationId: f.organizationId, level: f.level };
  const parts = await Promise.all(sources.map((s) => SOURCES[s](w).catch(() => [] as LogLine[])));
  const merged = parts.flat().sort((a, b) => b.at.getTime() - a.at.getTime() || b.key.localeCompare(a.key));
  const data = merged.slice(0, f.limit);
  const more = merged.length > f.limit || parts.some((p) => p.length >= f.limit);
  return { data, nextBefore: more && data.length ? data[data.length - 1]!.at.toISOString() : null, window: { from: gte, to: lt }, sources, auditHidden: !canAudit && (!f.source || f.source === "audit") };
}

// ───────────── app_log_entries sink (warn and above) ─────────────

const FLUSH_MS = 5_000;
const MAX_BUFFER = 200;
const MAX_PER_MIN = 300;

interface Buffered {
  level: string;
  source: string;
  message: string;
  requestId: string | null;
  organizationId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

const sinkState = globalThis as unknown as { realyAppLog?: { buffer: Buffered[]; timer: NodeJS.Timeout | null; window: { start: number; n: number; dropped: number }; flushing: boolean } };
const LEVEL_NAME: Record<number, string> = { 40: "warn", 50: "error", 60: "fatal" };
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function flush() {
  const s = sinkState.realyAppLog;
  if (!s || s.flushing || !s.buffer.length) return;
  s.flushing = true;
  const batch = s.buffer.splice(0, s.buffer.length);
  try {
    await db().appLogEntry.createMany({ data: batch.map((b) => ({ ...b, data: b.data as Prisma.InputJsonValue })) });
  } catch {
    // Database unavailable: drop the batch (logs still go to stdout); never log from here.
  } finally {
    s.flushing = false;
  }
}

/** Install the warn+ sink for this process (called by core/request-hooks/e.ts and the worker). Idempotent. */
export function installAppLogSink(app: ProcessApp) {
  if (sinkState.realyAppLog) return;
  const state = (sinkState.realyAppLog = { buffer: [] as Buffered[], timer: null as NodeJS.Timeout | null, window: { start: Date.now(), n: 0, dropped: 0 }, flushing: false });
  addLogSink((level, record, message) => {
    if (process.env.NODE_ENV === "test" && process.env.REALY_TEST_APP_LOG !== "1") return;
    const now = Date.now();
    if (now - state.window.start > 60_000) state.window = { start: now, n: 0, dropped: 0 };
    if (state.window.n >= MAX_PER_MIN || state.buffer.length >= MAX_BUFFER) {
      state.window.dropped++;
      return;
    }
    state.window.n++;
    const err = record.err instanceof Error ? record.err : null;
    const attrs = scrub(Object.fromEntries(Object.entries(record).filter(([k]) => k !== "err" && k !== "msg")));
    state.buffer.push({
      level: LEVEL_NAME[level] ?? (level >= 50 ? "error" : "warn"),
      source: app,
      message: scrubText(`${message}${err ? `: ${err.name}: ${err.message}` : typeof record.err === "string" ? `: ${record.err}` : ""}`, 500),
      requestId: typeof record.requestId === "string" ? record.requestId.slice(0, 100) : null,
      organizationId: typeof record.organizationId === "string" && uuidRe.test(record.organizationId) ? record.organizationId : null,
      data: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, typeof v === "string" ? scrubText(v, 200) : v])),
      createdAt: new Date(),
    });
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        void flush();
      }, FLUSH_MS);
      state.timer.unref?.();
    }
  });
}

/** Test seam: flush the buffer now. */
export const flushAppLogsForTests = flush;

/** Retention: app logs 7 days, error events 30 days. */
export async function purgeLogs(): Promise<number> {
  const [logs, events] = await Promise.all([
    db().appLogEntry.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } }),
    db().errorEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  return logs.count + events.count;
}
