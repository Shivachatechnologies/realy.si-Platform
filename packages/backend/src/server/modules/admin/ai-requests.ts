import { z } from "zod";
import { db, transaction, Prisma } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { prismaPage, toPage } from "@/server/core/pagination";
import { getControls } from "@/server/core/platform-controls";
import { AI_PROVIDER_KEYS, AI_PROVIDERS, providerKeyConfigured, providerOf, type AiProviderKey } from "@/server/modules/agents/providers/catalog";
import { writeAudit } from "@/server/modules/audit/service";
import { modelPrice } from "@/server/modules/costs/prices";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { capabilitiesFor, daysAgo, isUuid, reasonSchema, requireAnyPlatform, requirePlatform } from "./access";
import { AI_REQUEST_LOG_RETENTION_DAYS } from "./ai-request-log";

/**
 * AI request explorer and provider detail (stream C). Source: `ai_request_logs` (one row per model call attempt,
 * metadata only, 30 days). Rows hold no prompt or reply content. The error message and the requesting user are
 * shown only to holders of `platform.data.read` (sensitive data); others see the error code.
 */

const AI_READ = ["platform.ai.read", "platform.ai.manage"];
export const AI_REQUEST_STATUSES = ["SUCCESS", "ERROR", "FALLBACK", "REFUSED", "BUDGET_BLOCKED", "CACHED"] as const;
export const WINDOWS = { "1h": 1, "24h": 24, "7d": 168, "30d": 720 } as const;
type WindowKey = keyof typeof WINDOWS;

export const aiRequestFilters = z.object({
  org: z.string().uuid().optional().catch(undefined),
  provider: z.enum(AI_PROVIDER_KEYS).optional().catch(undefined),
  model: z.string().regex(/^[A-Za-z0-9._:@/-]{2,120}$/).optional().catch(undefined),
  status: z.enum(AI_REQUEST_STATUSES).optional().catch(undefined),
  tier: z.string().regex(/^[a-z]{2,20}$/).optional().catch(undefined),
  operation: z.string().regex(/^[a-z0-9_.:-]{2,80}$/).optional().catch(undefined),
  task: z.string().uuid().optional().catch(undefined),
  employee: z.string().uuid().optional().catch(undefined),
  trace: z.string().max(200).optional().catch(undefined),
  minLatency: z.coerce.number().int().min(0).max(3_600_000).optional().catch(undefined),
  window: z.enum(Object.keys(WINDOWS) as [WindowKey, ...WindowKey[]]).default("24h").catch("24h"),
  limit: z.coerce.number().int().min(10).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});
export type AiRequestFilters = z.infer<typeof aiRequestFilters>;

function whereOf(f: AiRequestFilters): Prisma.AiRequestLogWhereInput {
  return {
    createdAt: { gte: new Date(Date.now() - WINDOWS[f.window] * 3_600_000) },
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.model ? { OR: [{ servedModel: f.model }, { requestedModel: f.model }] } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.tier ? { tier: f.tier } : {}),
    ...(f.operation ? { operation: f.operation } : {}),
    ...(f.task ? { taskId: f.task } : {}),
    ...(f.employee ? { aiEmployeeId: f.employee } : {}),
    ...(f.trace ? { traceId: f.trace } : {}),
    ...(f.minLatency ? { latencyMs: { gte: f.minLatency } } : {}),
  };
}

const LIST_SELECT = {
  id: true,
  organizationId: true,
  taskId: true,
  aiEmployeeId: true,
  operation: true,
  profile: true,
  tier: true,
  provider: true,
  requestedModel: true,
  servedModel: true,
  status: true,
  errorCode: true,
  latencyMs: true,
  inputTokens: true,
  outputTokens: true,
  cachedTokens: true,
  costMicros: true,
  attempt: true,
  streamed: true,
  createdAt: true,
} as const;

async function orgNames(ids: (string | null)[]) {
  const uniq = [...new Set(ids.filter((v): v is string => !!v))];
  if (!uniq.length) return new Map<string, string>();
  const rows = await db().organization.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Request explorer: keyset-paginated (id desc = time desc, uuid v7), bounded to the chosen window. */
export async function listAiRequests(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const f = aiRequestFilters.parse(raw);
  const rows = await db().aiRequestLog.findMany({ where: whereOf(f), orderBy: { id: "desc" }, ...prismaPage({ limit: f.limit, cursor: f.cursor }), select: LIST_SELECT });
  const page = toPage(rows, { limit: f.limit, cursor: f.cursor });
  const names = await orgNames(page.data.map((r) => r.organizationId));
  return { ...page, filters: f, data: page.data.map((r) => ({ ...r, costMicros: Number(r.costMicros), organizationName: r.organizationId ? (names.get(r.organizationId) ?? r.organizationId.slice(0, 8)) : null })) };
}

/** One request with its sibling attempts (same trace). Sensitive fields need `platform.data.read`. */
export async function getAiRequest(ctx: RequestContext, id: string) {
  await requireAnyPlatform(ctx, AI_READ);
  if (!isUuid(id)) throw notFound("AI request");
  const row = await db().aiRequestLog.findUnique({ where: { id } });
  if (!row) throw notFound("AI request");
  const caps = await capabilitiesFor(ctx, ["platform.data.read"]);
  const sensitive = caps["platform.data.read"];
  const siblings = row.traceId ? await db().aiRequestLog.findMany({ where: { traceId: row.traceId, createdAt: { gte: new Date(row.createdAt.getTime() - 3_600_000), lte: new Date(row.createdAt.getTime() + 3_600_000) } }, orderBy: { id: "asc" }, take: 20, select: LIST_SELECT }) : [];
  const names = await orgNames([row.organizationId]);
  const [employee, task] = await Promise.all([
    row.aiEmployeeId ? db().aiEmployee.findUnique({ where: { id: row.aiEmployeeId }, select: { id: true, name: true } }) : null,
    row.taskId ? db().agentTask.findUnique({ where: { id: row.taskId }, select: { id: true, title: true, status: true } }) : null,
  ]);
  return {
    ...row,
    costMicros: Number(row.costMicros),
    errorMessage: sensitive ? row.errorMessage : null,
    errorMessageHidden: !sensitive && !!row.errorMessage,
    userId: sensitive ? row.userId : null,
    userHidden: !sensitive && !!row.userId,
    organizationName: row.organizationId ? (names.get(row.organizationId) ?? null) : null,
    employee,
    task,
    siblings: siblings.map((s) => ({ ...s, costMicros: Number(s.costMicros) })),
    sensitive,
  };
}

/** CSV of the filtered requests (max 10 000 rows; no sensitive columns). Audited. */
export async function exportAiRequestsCsv(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, ["platform.ai.manage", "platform.data.export"]);
  const f = aiRequestFilters.parse(raw);
  const rows = await db().aiRequestLog.findMany({ where: whereOf(f), orderBy: { id: "desc" }, take: 10_000, select: LIST_SELECT });
  const head = ["id", "created_at", "organization_id", "task_id", "ai_employee_id", "operation", "profile", "tier", "provider", "requested_model", "served_model", "status", "error_code", "latency_ms", "input_tokens", "output_tokens", "cached_tokens", "cost_usd", "attempt", "streamed"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = rows.map((r) => [r.id, r.createdAt, r.organizationId, r.taskId, r.aiEmployeeId, r.operation, r.profile, r.tier, r.provider, r.requestedModel, r.servedModel, r.status, r.errorCode, r.latencyMs, r.inputTokens, r.outputTokens, r.cachedTokens, (Number(r.costMicros) / 1e6).toFixed(6), r.attempt, r.streamed].map(esc).join(","));
  await transaction((tx) => writeAudit(tx, ctx, { category: "ADMIN", action: "platform.ai.requests_exported", resourceType: "ai_request_log", newValue: { filters: f, rows: rows.length } }));
  return { filename: `ai-requests-${new Date().toISOString().slice(0, 10)}.csv`, csv: [head.join(","), ...lines].join("\n") + "\n", rows: rows.length };
}

// ───────────── Aggregates (cached) ─────────────

interface StatRow {
  key: string | null;
  total: bigint;
  ok: bigint;
  errors: bigint;
  fallbacks: bigint;
  blocked: bigint;
  p50: number | null;
  p95: number | null;
  tokens: bigint | null;
  cost: bigint | null;
}

const statsCache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>, ttl = 60_000): Promise<T> {
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await fn();
  statsCache.set(key, { at: Date.now(), value });
  if (statsCache.size > 200) statsCache.clear();
  return value;
}

const GROUPS = { provider: Prisma.sql`provider`, model: Prisma.sql`COALESCE(served_model, requested_model)`, operation: Prisma.sql`operation`, tier: Prisma.sql`tier`, status: Prisma.sql`status::text`, errorCode: Prisma.sql`error_code` } as const;
type GroupKey = keyof typeof GROUPS;

async function groupStats(group: GroupKey, since: Date, extra: Prisma.Sql = Prisma.empty) {
  const rows = await db().$queryRaw<StatRow[]>(Prisma.sql`
    SELECT ${GROUPS[group]} AS key,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE status IN ('SUCCESS','CACHED'))::bigint AS ok,
      COUNT(*) FILTER (WHERE status IN ('ERROR','REFUSED'))::bigint AS errors,
      COUNT(*) FILTER (WHERE status = 'FALLBACK')::bigint AS fallbacks,
      COUNT(*) FILTER (WHERE status = 'BUDGET_BLOCKED')::bigint AS blocked,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'SUCCESS' AND latency_ms IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'SUCCESS' AND latency_ms IS NOT NULL) AS p95,
      SUM(input_tokens + output_tokens)::bigint AS tokens,
      SUM(cost_micros)::bigint AS cost
    FROM ai_request_logs WHERE created_at >= ${since} ${extra}
    GROUP BY 1 ORDER BY total DESC LIMIT 50`);
  return rows.map((r) => {
    const total = Number(r.total);
    const attempts = total - Number(r.blocked);
    return {
      key: r.key ?? "—",
      total,
      ok: Number(r.ok),
      errors: Number(r.errors),
      fallbacks: Number(r.fallbacks),
      blocked: Number(r.blocked),
      errorRate: attempts > 0 ? (Number(r.errors) + Number(r.fallbacks)) / attempts : null,
      p50: r.p50 === null ? null : Math.round(Number(r.p50)),
      p95: r.p95 === null ? null : Math.round(Number(r.p95)),
      tokens: Number(r.tokens ?? 0),
      costMicros: Number(r.cost ?? 0),
    };
  });
}

/** Request-log aggregates for a window: totals, success / failure, latency, tokens, cost; by provider, model, operation, tier. */
export async function aiRequestStats(ctx: RequestContext, raw: { window?: unknown } = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const window = aiRequestFilters.shape.window.parse(raw.window);
  return cached(`stats:${window}`, async () => {
    const since = new Date(Date.now() - WINDOWS[window] * 3_600_000);
    const [byStatus, byProvider, byModel, byOperation, byTier, byError, totals, hourly] = await Promise.all([
      groupStats("status", since),
      groupStats("provider", since),
      groupStats("model", since),
      groupStats("operation", since),
      groupStats("tier", since),
      groupStats("errorCode", since, Prisma.sql`AND error_code IS NOT NULL`),
      db().$queryRaw<StatRow[]>(Prisma.sql`
        SELECT NULL AS key, COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status IN ('SUCCESS','CACHED'))::bigint AS ok,
          COUNT(*) FILTER (WHERE status IN ('ERROR','REFUSED'))::bigint AS errors,
          COUNT(*) FILTER (WHERE status = 'FALLBACK')::bigint AS fallbacks,
          COUNT(*) FILTER (WHERE status = 'BUDGET_BLOCKED')::bigint AS blocked,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'SUCCESS' AND latency_ms IS NOT NULL) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 'SUCCESS' AND latency_ms IS NOT NULL) AS p95,
          SUM(input_tokens + output_tokens)::bigint AS tokens, SUM(cost_micros)::bigint AS cost
        FROM ai_request_logs WHERE created_at >= ${since}`),
      db().$queryRaw<{ bucket: Date; total: bigint; errors: bigint }[]>(Prisma.sql`
        SELECT date_trunc(${WINDOWS[window] <= 24 ? "hour" : "day"}, created_at AT TIME ZONE 'UTC') AS bucket, COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status IN ('ERROR','REFUSED','FALLBACK'))::bigint AS errors
        FROM ai_request_logs WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`),
    ]);
    const t = totals[0];
    const total = Number(t?.total ?? 0);
    const attempts = total - Number(t?.blocked ?? 0);
    return {
      window,
      computedAt: new Date().toISOString(),
      retentionDays: AI_REQUEST_LOG_RETENTION_DAYS,
      totals: {
        total,
        ok: Number(t?.ok ?? 0),
        errors: Number(t?.errors ?? 0),
        fallbacks: Number(t?.fallbacks ?? 0),
        blocked: Number(t?.blocked ?? 0),
        successRate: attempts > 0 ? Number(t?.ok ?? 0) / attempts : null,
        p50: t?.p50 == null ? null : Math.round(Number(t.p50)),
        p95: t?.p95 == null ? null : Math.round(Number(t.p95)),
        tokens: Number(t?.tokens ?? 0),
        costMicros: Number(t?.cost ?? 0),
      },
      byStatus,
      byProvider,
      byModel,
      byOperation,
      byTier,
      byError,
      series: hourly.map((h) => ({ at: h.bucket.toISOString(), total: Number(h.total), errors: Number(h.errors) })),
    };
  });
}

// ───────────── Providers ─────────────

const isProvider = (k: string): k is AiProviderKey => (AI_PROVIDER_KEYS as readonly string[]).includes(k);

/** Provider detail: health (log + breakers), models with pricing and state, limits, fallback priority, usage, errors. */
export async function aiProviderDetail(ctx: RequestContext, key: string) {
  await requireAnyPlatform(ctx, AI_READ);
  if (!isProvider(key)) throw notFound("Provider");
  const info = AI_PROVIDERS.find((p) => p.key === key)!;
  const { breakerSnapshot } = await import("@/server/modules/agents/router");
  const { fallbackModels } = await import("./ai-ops");
  const since24 = daysAgo(1);
  const since7 = daysAgo(7);
  const [controls, breakers, h24, h7, models7, errors7, recentErrors, ledger30, chain] = await Promise.all([
    getControls(),
    breakerSnapshot().catch(() => []),
    groupStats("provider", since24, Prisma.sql`AND provider = ${key}`),
    groupStats("provider", since7, Prisma.sql`AND provider = ${key}`),
    groupStats("model", since7, Prisma.sql`AND provider = ${key}`),
    groupStats("errorCode", since7, Prisma.sql`AND provider = ${key} AND error_code IS NOT NULL`),
    db().aiRequestLog.findMany({ where: { provider: key, status: { in: ["ERROR", "FALLBACK", "REFUSED"] }, createdAt: { gte: since7 } }, orderBy: { id: "desc" }, take: 20, select: LIST_SELECT }),
    db().costLedgerEntry.groupBy({ by: ["model"], where: { provider: key, category: "AI_TOKENS", occurredAt: { gte: daysAgo(30) } }, _sum: { costMicros: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    fallbackModels("").catch(() => [] as string[]),
  ]);
  const ids = [...new Set([...Object.keys(MODEL_PRICES).filter((m) => info.match(m)), ...models7.map((m) => m.key).filter((m) => m !== "—" && info.match(m))])].sort();
  const prices = await Promise.all(ids.map((m) => modelPrice(m)));
  const ledgerByModel = new Map(ledger30.map((l) => [l.model ?? "unknown", l]));
  const allowed = (m: string) => !controls.aiDisabledModels.includes(m) && (controls.aiAllowedModels.length === 0 || controls.aiAllowedModels.includes(m));
  return {
    key,
    label: info.label,
    envKey: info.envKey,
    configured: providerKeyConfigured(key),
    enabled: ids.some(allowed),
    builtInFallback: info.fallbackModels,
    /** Position in the cross-provider order (agents/router.ts walks AI_PROVIDERS in this order). */
    priority: AI_PROVIDERS.findIndex((p) => p.key === key) + 1,
    adminFallbackChain: chain.map((m) => ({ model: m, provider: providerOf(m), own: info.match(m) })),
    breakers: breakers.filter((b) => b.provider === key),
    health: { h24: h24[0] ?? null, d7: h7[0] ?? null },
    models: ids.map((m, i) => {
      const l = ledgerByModel.get(m);
      return {
        id: m,
        allowed: allowed(m),
        disabled: controls.aiDisabledModels.includes(m),
        price: prices[i]!,
        stats7d: models7.find((x) => x.key === m) ?? null,
        ledger30d: l ? { calls: l._count._all, costMicros: Number(l._sum.costMicros ?? 0n), tokens: (l._sum.inputTokens ?? 0) + (l._sum.outputTokens ?? 0) } : null,
        breakerOpen: breakers.some((b) => b.model === m && b.open),
      };
    }),
    errors7d: errors7,
    recentErrors: recentErrors.map((r) => ({ ...r, costMicros: Number(r.costMicros) })),
    usage30d: { costMicros: ledger30.reduce((a, l) => a + Number(l._sum.costMicros ?? 0n), 0), calls: ledger30.reduce((a, l) => a + l._count._all, 0) },
  };
}

export const resetBreakersInput = z.object({ reason: reasonSchema });

/** Close every circuit breaker of one provider (shared across replicas), audited. */
export async function resetProviderBreakersAdmin(ctx: RequestContext, key: string, raw: z.input<typeof resetBreakersInput>) {
  const { reason } = resetBreakersInput.parse(raw);
  await requirePlatform(ctx, "platform.ai.manage");
  if (!isProvider(key)) throw notFound("Provider");
  const { resetProviderBreakers } = await import("@/server/modules/agents/router");
  const n = await resetProviderBreakers(key);
  await transaction((tx) => writeAudit(tx, ctx, { category: "SECURITY", action: "platform.ai.breakers_reset", resourceType: "ai_provider", resourceId: key, newValue: { reset: n }, reason }));
  statsCache.clear();
  return { reset: n };
}

/** Routing observability: tier → served model counts and fallback share (window). */
export async function routingObservability(ctx: RequestContext, raw: { window?: unknown } = {}) {
  await requireAnyPlatform(ctx, AI_READ);
  const window = aiRequestFilters.shape.window.parse(raw.window);
  return cached(`routing:${window}`, async () => {
    const since = new Date(Date.now() - WINDOWS[window] * 3_600_000);
    const rows = await db().$queryRaw<{ tier: string | null; requested: string; served: string | null; status: string; n: bigint }[]>(Prisma.sql`
      SELECT tier, requested_model AS requested, served_model AS served, status::text AS status, COUNT(*)::bigint AS n
      FROM ai_request_logs WHERE created_at >= ${since} AND status <> 'BUDGET_BLOCKED'
      GROUP BY 1, 2, 3, 4 ORDER BY n DESC LIMIT 200`);
    return rows.map((r) => ({ tier: r.tier ?? "—", requested: r.requested, served: r.served, status: r.status, count: Number(r.n), rerouted: !!r.served && r.served !== r.requested && r.status === "SUCCESS" }));
  });
}
