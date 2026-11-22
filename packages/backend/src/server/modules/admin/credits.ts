/**
 * Control Center → Credits & usage (stream D): the credit ledger explorer, balances per organization, admin
 * adjustments, usage by category from the existing meters and tables, quota events, reconciliation and budget alerts.
 * Every figure is counted from real rows; categories without a source say so.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, Prisma, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { LIMITS, METER_LIMIT, isMeterKey, type MeterKey } from "@/server/modules/entitlements/catalog";
import { ADMIN_LEDGER_KINDS, LEDGER_KINDS, LEDGER_METERS, writeLedgerEntry } from "@/server/modules/entitlements/ledger";
import { effectiveLimit, getEntitlements, invalidateEntitlements, monthlyWindow, usageOf, usageSummary } from "@/server/modules/entitlements/service";
import { reasonSchema, requireAnyPlatform, requirePlatform } from "./access";

const READ = ["platform.subscriptions.read", "pricing.read"];
const DAY = 86_400_000;

// ───────────── Ledger explorer ─────────────

export const ledgerFilters = z.object({
  org: z.string().uuid().optional().catch(undefined),
  meter: z.string().max(40).optional().catch(undefined),
  kind: z.enum(LEDGER_KINDS).optional().catch(undefined),
  from: z.coerce.date().optional().catch(undefined),
  to: z.coerce.date().optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});

/** Ledger entries, newest first (UUIDv7 ids are time-ordered: entries are written when they happen). */
export async function creditLedger(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = ledgerFilters.parse(raw);
  const where: Prisma.CreditLedgerEntryWhereInput = {
    ...(f.org ? { organizationId: f.org } : {}),
    ...(f.meter ? { meter: f.meter } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
  };
  const [rows, byKind] = await Promise.all([
    db().creditLedgerEntry.findMany({ where: { AND: [where, f.cursor ? { id: { lt: f.cursor } } : {}] }, orderBy: { id: "desc" }, take: f.limit + 1 }),
    db().creditLedgerEntry.groupBy({ by: ["kind"], where, _sum: { delta: true }, _count: { _all: true } }),
  ]);
  const hasMore = rows.length > f.limit;
  const data = hasMore ? rows.slice(0, f.limit) : rows;
  const orgIds = [...new Set(data.map((r) => r.organizationId))];
  const actorIds = [...new Set(data.map((r) => r.actorId).filter((x): x is string => !!x))];
  const [orgs, actors] = await Promise.all([
    orgIds.length ? db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    actorIds.length ? db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    filters: f,
    page: {
      data: data.map((r) => ({ ...r, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? null, actorName: actors.find((a) => a.id === r.actorId)?.name ?? null })),
      nextCursor: hasMore ? data[data.length - 1]!.id : null,
    },
    byKind: byKind.map((k) => ({ kind: k.kind, count: k._count._all, delta: k._sum.delta ?? 0n })),
  };
}

/** One organization's metered allowances in the current window, with the ledger totals per kind. */
export async function creditBalances(ctx: RequestContext, organizationId: string) {
  await requireAnyPlatform(ctx, READ);
  const org = await db().organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } });
  if (!org) throw notFound("Organization");
  const summary = await usageSummary(organizationId);
  const w = summary.entitlements.window;
  const kinds = await db().creditLedgerEntry.groupBy({ by: ["meter", "kind"], where: { organizationId, periodStart: { lte: new Date() }, periodEnd: { gt: new Date() } }, _sum: { delta: true } });
  const meters = LEDGER_METERS.map((meter) => {
    const row = summary.rows.find((r) => r.key === METER_LIMIT[meter])!;
    const byKind = Object.fromEntries(kinds.filter((k) => k.meter === meter).map((k) => [k.kind, k._sum.delta ?? 0n])) as Record<string, bigint>;
    return { meter, limitKey: row.key, unit: row.unit, used: row.used, planLimit: row.planLimit, addon: row.addon, ledger: row.ledger, limit: row.limit, remaining: row.limit === null ? null : Math.max(0, row.limit - row.used), ratio: row.ratio, byKind };
  });
  return { org, window: w, plan: summary.entitlements.planName, state: summary.entitlements.state, enforced: summary.entitlements.enforced, meters };
}

// ───────────── Admin adjustments ─────────────

export const creditAdjustInput = z
  .object({
    organizationId: z.string().uuid(),
    meter: z.string().refine(isMeterKey, "Unknown meter"),
    kind: z.enum(ADMIN_LEDGER_KINDS),
    /** Signed, in the meter's unit. */
    delta: z.union([z.string().regex(/^-?\d{1,12}$/), z.number().int()]).transform((v) => BigInt(v)),
    reason: reasonSchema,
  })
  .refine((v) => v.delta !== 0n, { message: "The change cannot be zero", path: ["delta"] })
  .refine((v) => v.kind === "ADJUSTMENT" || v.delta > 0n, { message: "Refunds and promotions add credits", path: ["delta"] })
  .refine((v) => (v.delta < 0n ? -v.delta : v.delta) <= 1_000_000_000n, { message: "At most 1,000,000,000 per change", path: ["delta"] });

/**
 * Add or remove allowance for the organization's current usage window (enforced immediately by the entitlement
 * checks). Needs platform.subscriptions.manage (MFA) and a reason; the ledger row carries the admin and is audited.
 */
export async function adjustCredits(ctx: RequestContext, raw: z.input<typeof creditAdjustInput>) {
  const input = creditAdjustInput.parse(raw);
  await requirePlatform(ctx, "platform.subscriptions.manage");
  const meter = input.meter as MeterKey;
  const id = randomUUID();
  const row = await transaction(async (tx) => {
    if (!(await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } }))) throw notFound("Organization");
    const sub = await tx.subscription.findFirst({ where: { organizationId: input.organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, orderBy: { createdAt: "desc" }, select: { currentPeriodStart: true } });
    const window = monthlyWindow(sub?.currentPeriodStart ?? null);
    if (input.delta < 0n) {
      // Never remove more than the window holds in total (plan + add-ons + earlier changes).
      const ent = await getEntitlements(input.organizationId);
      const limit = effectiveLimit(ent, METER_LIMIT[meter]);
      if (limit !== null && -input.delta > BigInt(limit)) throw invalid("The removal exceeds the organization's allowance for this window", { field: "delta" });
    }
    await writeLedgerEntry(tx, { organizationId: input.organizationId, meter, kind: input.kind, delta: input.delta, period: window, sourceType: "admin_adjustment", sourceId: id, reason: input.reason, actorId: ctx.actor.id ?? null });
    const created = await tx.creditLedgerEntry.findUniqueOrThrow({ where: { sourceType_sourceId_kind: { sourceType: "admin_adjustment", sourceId: id, kind: input.kind } } });
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId: input.organizationId, action: "credits.adjusted", resourceType: "credit_ledger_entry", resourceId: created.id, newValue: { meter, kind: input.kind, delta: input.delta, periodKey: created.periodKey }, reason: input.reason });
    return created;
  });
  invalidateEntitlements(input.organizationId);
  return row;
}

// ───────────── Usage center ─────────────

export const USAGE_CATEGORIES = ["tokens", "requests", "agents", "voiceMinutes", "calls", "storage", "images", "video", "apiRequests", "workflowRuns", "credits", "emails"] as const;
export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

/** Where each category is counted from (shown as the data source on the page). */
export const USAGE_SOURCES: Record<UsageCategory, string> = {
  tokens: "cost_ledger_entries (input + output tokens)",
  requests: "cost_ledger_entries (model calls)",
  agents: "ai_employees (not archived)",
  voiceMinutes: "usage_records voice.minutes + voice.assistant.minutes",
  calls: "voice_calls",
  storage: "stored files (documents, assets, attachments)",
  images: "usage_records image.generations",
  video: "usage_records video.generations",
  apiRequests: "usage_records api.request",
  workflowRuns: "workflow_runs",
  credits: "usage_records ai.credits",
  emails: "usage_records email.sends",
};

const METER_CATEGORIES: Partial<Record<UsageCategory, string[]>> = {
  voiceMinutes: ["voice.minutes", "voice.assistant.minutes"],
  images: ["image.generations"],
  video: ["video.generations"],
  apiRequests: ["api.request"],
  credits: ["ai.credits"],
  emails: ["email.sends"],
};

export const usageInput = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30).catch(30), category: z.enum(USAGE_CATEGORIES).optional().catch(undefined) });

type DayN = { day: Date; n: bigint | number | null };
type OrgN = { organization_id: string; n: bigint | number | null };

async function categorySeries(cat: UsageCategory, from: Date): Promise<{ days: DayN[]; top: OrgN[]; total: number } | null> {
  const meters = METER_CATEGORIES[cat];
  if (meters) {
    const [days, top] = await Promise.all([
      db().$queryRaw<DayN[]>(Prisma.sql`SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, SUM(quantity)::bigint AS n FROM usage_records WHERE meter IN (${Prisma.join(meters)}) AND occurred_at >= ${from} GROUP BY 1`),
      db().$queryRaw<OrgN[]>(Prisma.sql`SELECT organization_id, SUM(quantity)::bigint AS n FROM usage_records WHERE meter IN (${Prisma.join(meters)}) AND occurred_at >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    return { days, top, total: days.reduce((a, d) => a + Number(d.n ?? 0), 0) };
  }
  if (cat === "tokens" || cat === "requests") {
    const expr = cat === "tokens" ? Prisma.sql`SUM(input_tokens + output_tokens)::bigint` : Prisma.sql`COUNT(*)::bigint`;
    const [days, top] = await Promise.all([
      db().$queryRaw<DayN[]>(Prisma.sql`SELECT date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, ${expr} AS n FROM cost_ledger_entries WHERE occurred_at >= ${from} AND category = 'AI_TOKENS' GROUP BY 1`),
      db().$queryRaw<OrgN[]>(Prisma.sql`SELECT organization_id, ${expr} AS n FROM cost_ledger_entries WHERE occurred_at >= ${from} AND category = 'AI_TOKENS' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    return { days, top, total: days.reduce((a, d) => a + Number(d.n ?? 0), 0) };
  }
  if (cat === "calls") {
    const [days, top] = await Promise.all([
      db().$queryRaw<DayN[]>(Prisma.sql`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM voice_calls WHERE created_at >= ${from} GROUP BY 1`),
      db().$queryRaw<OrgN[]>(Prisma.sql`SELECT organization_id, COUNT(*)::bigint AS n FROM voice_calls WHERE created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    return { days, top, total: days.reduce((a, d) => a + Number(d.n ?? 0), 0) };
  }
  if (cat === "workflowRuns") {
    const [days, top] = await Promise.all([
      db().$queryRaw<DayN[]>(Prisma.sql`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS n FROM workflow_runs WHERE created_at >= ${from} AND is_test = false GROUP BY 1`),
      db().$queryRaw<OrgN[]>(Prisma.sql`SELECT organization_id, COUNT(*)::bigint AS n FROM workflow_runs WHERE created_at >= ${from} AND is_test = false GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    ]);
    return { days, top, total: days.reduce((a, d) => a + Number(d.n ?? 0), 0) };
  }
  if (cat === "agents") {
    const top = await db().$queryRaw<OrgN[]>(Prisma.sql`SELECT organization_id, COUNT(*)::bigint AS n FROM ai_employees WHERE archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
    const total = await db().aiEmployee.count({ where: { archivedAt: null } });
    return { days: [], top, total };
  }
  if (cat === "storage") {
    // Point-in-time bytes from the main file tables (no daily history exists for storage).
    const top = await db().$queryRaw<OrgN[]>(Prisma.sql`
      SELECT organization_id, SUM(b)::bigint AS n FROM (
        SELECT organization_id, size_bytes::bigint AS b FROM brain_documents
        UNION ALL SELECT organization_id, size_bytes::bigint FROM visual_assets
        UNION ALL SELECT organization_id, size::bigint FROM integration_stored_objects
        UNION ALL SELECT organization_id, size_bytes::bigint FROM marketing_assets WHERE size_bytes IS NOT NULL
      ) s GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
    const totals = await db().$queryRaw<{ n: bigint | null }[]>(Prisma.sql`
      SELECT (COALESCE((SELECT SUM(size_bytes)::bigint FROM brain_documents), 0) + COALESCE((SELECT SUM(size_bytes)::bigint FROM visual_assets), 0)
            + COALESCE((SELECT SUM(size)::bigint FROM integration_stored_objects), 0) + COALESCE((SELECT SUM(size_bytes)::bigint FROM marketing_assets), 0))::bigint AS n`);
    return { days: [], top, total: Number(totals[0]?.n ?? 0) };
  }
  return null;
}

const usageCache = new Map<string, { at: number; value: unknown }>();
const USAGE_TTL_MS = 60_000;

/** Totals for every category in the range, plus the daily series and top organizations of the selected one. */
export async function usageCenter(ctx: RequestContext, raw: { days?: unknown; category?: unknown } = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = usageInput.parse(raw);
  const cacheKey = `${f.days}:${f.category ?? ""}`;
  const hit = usageCache.get(cacheKey);
  if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.value as Awaited<ReturnType<typeof computeUsage>>;
  const value = await computeUsage(f.days, f.category ?? "credits");
  usageCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function computeUsage(days: number, selected: UsageCategory) {
  const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - (days - 1) * DAY);
  const results = await Promise.all(USAGE_CATEGORIES.map((c) => categorySeries(c, from).catch(() => null)));
  const sel = results[USAGE_CATEGORIES.indexOf(selected)] ?? null;
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * DAY).toISOString().slice(0, 10));
  const orgIds = sel?.top.map((t) => t.organization_id) ?? [];
  const orgs = orgIds.length ? await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  return {
    days,
    selected,
    computedAt: new Date(),
    categories: USAGE_CATEGORIES.map((c, i) => ({ key: c, total: results[i]?.total ?? null, source: USAGE_SOURCES[c], pointInTime: c === "agents" || c === "storage" })),
    series: sel && sel.days.length ? { days: dayKeys, values: dayKeys.map((d) => Number(sel.days.find((x) => x.day.toISOString().slice(0, 10) === d)?.n ?? 0)) } : null,
    top: (sel?.top ?? []).map((t) => ({ organizationId: t.organization_id, name: orgs.find((o) => o.id === t.organization_id)?.name ?? t.organization_id, value: Number(t.n ?? 0) })),
  };
}

// ───────────── Quota events ─────────────

export const quotaFilters = z.object({
  org: z.string().uuid().optional().catch(undefined),
  limitKey: z.string().max(60).optional().catch(undefined),
  limit: z.coerce.number().int().min(10).max(200).default(50).catch(50),
  cursor: z.string().uuid().optional().catch(undefined),
});

export async function quotaEvents(ctx: RequestContext, raw: Record<string, unknown> = {}) {
  await requireAnyPlatform(ctx, READ);
  const f = quotaFilters.parse(raw);
  const where: Prisma.QuotaEventWhereInput = { ...(f.org ? { organizationId: f.org } : {}), ...(f.limitKey ? { limitKey: f.limitKey } : {}) };
  const since = new Date(Date.now() - 7 * DAY);
  const [rows, byLimit] = await Promise.all([
    db().quotaEvent.findMany({ where: { AND: [where, f.cursor ? { id: { lt: f.cursor } } : {}] }, orderBy: { id: "desc" }, take: f.limit + 1 }),
    db().quotaEvent.groupBy({ by: ["limitKey"], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { limitKey: "desc" } }, take: 20 }),
  ]);
  const hasMore = rows.length > f.limit;
  const data = hasMore ? rows.slice(0, f.limit) : rows;
  const orgs = data.length ? await db().organization.findMany({ where: { id: { in: [...new Set(data.map((r) => r.organizationId))] } }, select: { id: true, name: true } }) : [];
  return {
    filters: f,
    page: { data: data.map((r) => ({ ...r, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? null })), nextCursor: hasMore ? data[data.length - 1]!.id : null },
    byLimit7d: byLimit.map((b) => ({ limitKey: b.limitKey, count: b._count._all })),
  };
}

// ───────────── Reconciliation and budget alerts ─────────────

/**
 * Checks that the ledger matches its sources: USAGE rows of the last 7 closed days against usage_records, and paid
 * add-ons against their PURCHASE / GRANT rows. Returns only mismatches (bounded).
 */
export async function creditReconciliation(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const from = new Date(today.getTime() - 7 * DAY);
  const [usage, missingAddons, lastUsageRow] = await Promise.all([
    db().$queryRaw<{ organization_id: string; meter: string; day: Date; recorded: bigint; ledgered: bigint | null }[]>(Prisma.sql`
      WITH u AS (
        SELECT organization_id, meter, date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS day, SUM(quantity)::bigint AS recorded
        FROM usage_records WHERE occurred_at >= ${from} AND occurred_at < ${today} AND meter IN (${Prisma.join(LEDGER_METERS)}) GROUP BY 1, 2, 3)
      SELECT u.organization_id, u.meter, u.day, u.recorded, (-l.delta)::bigint AS ledgered
      FROM u LEFT JOIN credit_ledger_entries l
        ON l.source_type = 'usage_day' AND l.kind = 'USAGE' AND l.source_id = u.organization_id::text || ':' || u.meter || ':' || to_char(u.day, 'YYYY-MM-DD')
      WHERE l.id IS NULL OR -l.delta <> u.recorded
      ORDER BY u.day DESC LIMIT 100`),
    db().$queryRaw<{ id: string; organization_id: string; addon_key: string; quantity: bigint; paid_at: Date | null; source: string }[]>(Prisma.sql`
      SELECT a.id, a.organization_id, a.addon_key, a.quantity, a.paid_at, a.source FROM entitlement_addon_purchases a
      WHERE a.status = 'PAID' AND a.paid_at >= ${new Date(today.getTime() - 90 * DAY)}
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries l WHERE l.source_type = 'addon_purchase' AND l.source_id = a.id::text)
      ORDER BY a.paid_at DESC LIMIT 100`),
    db().creditLedgerEntry.findFirst({ where: { kind: "USAGE" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const orgIds = [...new Set([...usage.map((u) => u.organization_id), ...missingAddons.map((a) => a.organization_id)])];
  const orgs = orgIds.length ? await db().organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;
  return {
    checkedFrom: from,
    checkedTo: today,
    lastUsageAggregation: lastUsageRow?.createdAt ?? null,
    usage: usage.map((u) => ({ organizationId: u.organization_id, organizationName: name(u.organization_id), meter: u.meter, day: u.day, recorded: u.recorded, ledgered: u.ledgered })),
    addons: missingAddons.map((a) => ({ id: a.id, organizationId: a.organization_id, organizationName: name(a.organization_id), addonKey: a.addon_key, quantity: a.quantity, paidAt: a.paid_at, source: a.source })),
  };
}

export const BUDGET_THRESHOLDS = { warning: 0.8, critical: 1 } as const;
let budgetCache: { at: number; value: Awaited<ReturnType<typeof computeBudgetAlerts>> } | null = null;

async function computeBudgetAlerts() {
  const since = new Date(Date.now() - 31 * DAY);
  // Candidates: the 10 heaviest organizations per metered limit over the last 31 days (bounded work).
  const top = await db().$queryRaw<{ organization_id: string; meter: string }[]>(Prisma.sql`
    SELECT organization_id, meter FROM (
      SELECT organization_id, meter, ROW_NUMBER() OVER (PARTITION BY meter ORDER BY SUM(quantity) DESC) AS r
      FROM usage_records WHERE occurred_at >= ${since} AND meter IN (${Prisma.join(LEDGER_METERS)}) GROUP BY 1, 2) t
    WHERE r <= 10`);
  const alerts: { organizationId: string; limitKey: string; meter: string; used: number; limit: number; ratio: number; level: "warning" | "critical"; unit: string }[] = [];
  for (const c of top) {
    if (!isMeterKey(c.meter)) continue;
    const key = METER_LIMIT[c.meter];
    const ent = await getEntitlements(c.organization_id).catch(() => null);
    if (!ent) continue;
    const limit = effectiveLimit(ent, key);
    if (limit === null || limit <= 0) continue;
    const used = await usageOf(c.organization_id, key, ent);
    const ratio = used / limit;
    if (ratio < BUDGET_THRESHOLDS.warning) continue;
    alerts.push({ organizationId: c.organization_id, limitKey: key, meter: c.meter, used, limit, ratio, level: ratio >= BUDGET_THRESHOLDS.critical ? "critical" : "warning", unit: LIMITS[key].unit });
  }
  const orgs = alerts.length ? await db().organization.findMany({ where: { id: { in: [...new Set(alerts.map((a) => a.organizationId))] } }, select: { id: true, name: true } }) : [];
  return { computedAt: new Date(), alerts: alerts.sort((a, b) => b.ratio - a.ratio).map((a) => ({ ...a, organizationName: orgs.find((o) => o.id === a.organizationId)?.name ?? a.organizationId })) };
}

/**
 * Organizations at ≥ 80 % (warning) or ≥ 100 % (critical) of a metered allowance in their current window. Computed
 * on demand for the heaviest users only and cached for 5 minutes per process.
 */
export async function budgetAlerts(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  if (budgetCache && Date.now() - budgetCache.at < 5 * 60_000) return budgetCache.value;
  const value = await computeBudgetAlerts();
  budgetCache = { at: Date.now(), value };
  return value;
}
